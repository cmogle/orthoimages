import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import initSqlJs from "sql.js";
import { v4 as uuidv4 } from "uuid";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 3000;
const IS_VERCEL = Boolean(process.env.VERCEL);
const WRITABLE_BASE = IS_VERCEL ? "/tmp/orthoref" : __dirname;
const UPLOADS_DIR = join(WRITABLE_BASE, "uploads");
const DATA_DIR = join(WRITABLE_BASE, "data");
const DB_PATH = join(DATA_DIR, "orthoref.db");

// Ensure directories exist
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });

// --- Database Setup (sql.js - pure JS SQLite) ---
const SQL = await initSqlJs();

let db;
// Load existing database if it exists
if (existsSync(DB_PATH)) {
  try {
    const fileBuffer = await readFile(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } catch {
    db = new SQL.Database();
  }
} else {
  db = new SQL.Database();
}

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    aliases TEXT DEFAULT '',
    body_region TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

db.run(`
  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    condition_id INTEGER NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT,
    view_label TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Save database to file
async function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  await writeFile(DB_PATH, buffer);
}

// Helper functions for sql.js
function runQuery(sql, params = []) {
  db.run(sql, params);
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] };
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();
  return results;
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  let result = null;
  if (stmt.step()) {
    result = stmt.getAsObject();
  }
  stmt.free();
  return result;
}

// --- Fastify Setup ---
const app = Fastify({ logger: false });

await app.register(fastifyMultipart, {
  limits: { fileSize: 10 * 1024 * 1024 },
});

await app.register(fastifyStatic, {
  root: join(__dirname, "public"),
  prefix: "/",
});

await app.register(fastifyStatic, {
  root: UPLOADS_DIR,
  prefix: "/uploads/",
  decorateReply: false,
});

// --- Serve HTML pages ---
app.get("/", (req, reply) => reply.sendFile("index.html"));
app.get("/admin", (req, reply) => reply.sendFile("admin.html"));

// --- API: Conditions ---
app.get("/api/conditions", () => {
  const conditions = getAll("SELECT * FROM conditions ORDER BY body_region, name");
  return conditions.map((c) => ({
    ...c,
    images: getAll("SELECT * FROM images WHERE condition_id = ? ORDER BY sort_order, id", [c.id]),
  }));
});

app.post("/api/conditions", async (req) => {
  const { name, aliases = "", body_region = "" } = req.body;
  if (!name?.trim()) throw { statusCode: 400, message: "Name is required" };
  const result = runQuery(
    "INSERT INTO conditions (name, aliases, body_region) VALUES (?, ?, ?)",
    [name.trim(), aliases.trim(), body_region.trim()]
  );
  await saveDatabase();
  return { id: result.lastInsertRowid, name, aliases, body_region };
});

app.put("/api/conditions/:id", async (req) => {
  const id = Number(req.params.id);
  const existing = getOne("SELECT * FROM conditions WHERE id = ?", [id]);
  if (!existing) throw { statusCode: 404, message: "Condition not found" };
  const { name, aliases = "", body_region = "" } = req.body;
  if (!name?.trim()) throw { statusCode: 400, message: "Name is required" };
  runQuery(
    "UPDATE conditions SET name = ?, aliases = ?, body_region = ? WHERE id = ?",
    [name.trim(), aliases.trim(), body_region.trim(), id]
  );
  await saveDatabase();
  return { id, name, aliases, body_region };
});

app.delete("/api/conditions/:id", async (req) => {
  const id = Number(req.params.id);
  const images = getAll("SELECT * FROM images WHERE condition_id = ?", [id]);
  for (const img of images) {
    try { await unlink(join(UPLOADS_DIR, img.filename)); } catch {}
  }
  runQuery("DELETE FROM images WHERE condition_id = ?", [id]);
  runQuery("DELETE FROM conditions WHERE id = ?", [id]);
  await saveDatabase();
  return { ok: true };
});

// --- API: Images ---
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

app.post("/api/conditions/:id/images", async (req) => {
  const conditionId = Number(req.params.id);
  const existing = getOne("SELECT * FROM conditions WHERE id = ?", [conditionId]);
  if (!existing) throw { statusCode: 404, message: "Condition not found" };

  const parts = req.parts();
  const uploaded = [];
  let viewLabel = "";

  for await (const part of parts) {
    if (part.type === "field" && part.fieldname === "view_label") {
      viewLabel = part.value?.toString() || "";
      continue;
    }
    if (part.type === "file") {
      const ext = extname(part.filename || "").toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) continue;
      const newFilename = `${uuidv4()}${ext}`;
      const buffer = await part.toBuffer();
      await writeFile(join(UPLOADS_DIR, newFilename), buffer);
      const maxSortResult = getOne("SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM images WHERE condition_id = ?", [conditionId]);
      const maxSort = maxSortResult?.max_sort || 0;
      const result = runQuery(
        "INSERT INTO images (condition_id, filename, original_name, view_label, sort_order) VALUES (?, ?, ?, ?, ?)",
        [conditionId, newFilename, part.filename, viewLabel, maxSort + 1]
      );
      uploaded.push({ id: result.lastInsertRowid, filename: newFilename, original_name: part.filename, view_label: viewLabel });
    }
  }
  await saveDatabase();
  return uploaded;
});

app.put("/api/images/:id", async (req) => {
  const id = Number(req.params.id);
  const existing = getOne("SELECT * FROM images WHERE id = ?", [id]);
  if (!existing) throw { statusCode: 404, message: "Image not found" };
  const { view_label = existing.view_label, sort_order = existing.sort_order } = req.body;
  runQuery(
    "UPDATE images SET view_label = ?, sort_order = ? WHERE id = ?",
    [view_label, Number(sort_order), id]
  );
  await saveDatabase();
  return { ok: true };
});

app.delete("/api/images/:id", async (req) => {
  const id = Number(req.params.id);
  const existing = getOne("SELECT * FROM images WHERE id = ?", [id]);
  if (!existing) throw { statusCode: 404, message: "Image not found" };
  try { await unlink(join(UPLOADS_DIR, existing.filename)); } catch {}
  runQuery("DELETE FROM images WHERE id = ?", [id]);
  await saveDatabase();
  return { ok: true };
});

// --- Start ---
app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`OrthoRef running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
