import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PORT = process.env.PORT || 3000;
const UPLOADS_DIR = join(__dirname, "uploads");
const DATA_DIR = join(__dirname, "data");
const DB_PATH = join(DATA_DIR, "orthoref.db");

// Ensure directories exist
await mkdir(UPLOADS_DIR, { recursive: true });
await mkdir(DATA_DIR, { recursive: true });

// --- Database Setup ---
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS conditions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    aliases TEXT DEFAULT '',
    body_region TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS images (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    condition_id INTEGER NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT,
    view_label TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// --- Prepared Statements ---
const stmts = {
  allConditions: db.prepare(`SELECT * FROM conditions ORDER BY body_region, name`),
  conditionById: db.prepare(`SELECT * FROM conditions WHERE id = ?`),
  insertCondition: db.prepare(`INSERT INTO conditions (name, aliases, body_region) VALUES (@name, @aliases, @body_region)`),
  updateCondition: db.prepare(`UPDATE conditions SET name = @name, aliases = @aliases, body_region = @body_region WHERE id = @id`),
  deleteCondition: db.prepare(`DELETE FROM conditions WHERE id = ?`),
  imagesByCondition: db.prepare(`SELECT * FROM images WHERE condition_id = ? ORDER BY sort_order, id`),
  imageById: db.prepare(`SELECT * FROM images WHERE id = ?`),
  insertImage: db.prepare(`INSERT INTO images (condition_id, filename, original_name, view_label, sort_order) VALUES (@condition_id, @filename, @original_name, @view_label, @sort_order)`),
  updateImage: db.prepare(`UPDATE images SET view_label = @view_label, sort_order = @sort_order WHERE id = @id`),
  deleteImage: db.prepare(`DELETE FROM images WHERE id = ?`),
  maxSortOrder: db.prepare(`SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM images WHERE condition_id = ?`),
};

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
  const conditions = stmts.allConditions.all();
  return conditions.map((c) => ({
    ...c,
    images: stmts.imagesByCondition.all(c.id),
  }));
});

app.post("/api/conditions", async (req) => {
  const { name, aliases = "", body_region = "" } = req.body;
  if (!name?.trim()) throw { statusCode: 400, message: "Name is required" };
  const result = stmts.insertCondition.run({ name: name.trim(), aliases: aliases.trim(), body_region: body_region.trim() });
  return { id: result.lastInsertRowid, name, aliases, body_region };
});

app.put("/api/conditions/:id", async (req) => {
  const id = Number(req.params.id);
  const existing = stmts.conditionById.get(id);
  if (!existing) throw { statusCode: 404, message: "Condition not found" };
  const { name, aliases = "", body_region = "" } = req.body;
  if (!name?.trim()) throw { statusCode: 400, message: "Name is required" };
  stmts.updateCondition.run({ id, name: name.trim(), aliases: aliases.trim(), body_region: body_region.trim() });
  return { id, name, aliases, body_region };
});

app.delete("/api/conditions/:id", async (req) => {
  const id = Number(req.params.id);
  const images = stmts.imagesByCondition.all(id);
  for (const img of images) {
    try { await unlink(join(UPLOADS_DIR, img.filename)); } catch {}
  }
  stmts.deleteCondition.run(id);
  return { ok: true };
});

// --- API: Images ---
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

app.post("/api/conditions/:id/images", async (req) => {
  const conditionId = Number(req.params.id);
  const existing = stmts.conditionById.get(conditionId);
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
      const maxSort = stmts.maxSortOrder.get(conditionId).max_sort;
      const result = stmts.insertImage.run({
        condition_id: conditionId,
        filename: newFilename,
        original_name: part.filename,
        view_label: viewLabel,
        sort_order: maxSort + 1,
      });
      uploaded.push({ id: result.lastInsertRowid, filename: newFilename, original_name: part.filename, view_label: viewLabel });
    }
  }
  return uploaded;
});

app.put("/api/images/:id", async (req) => {
  const id = Number(req.params.id);
  const existing = stmts.imageById.get(id);
  if (!existing) throw { statusCode: 404, message: "Image not found" };
  const { view_label = existing.view_label, sort_order = existing.sort_order } = req.body;
  stmts.updateImage.run({ id, view_label: view_label, sort_order: Number(sort_order) });
  return { ok: true };
});

app.delete("/api/images/:id", async (req) => {
  const id = Number(req.params.id);
  const existing = stmts.imageById.get(id);
  if (!existing) throw { statusCode: 404, message: "Image not found" };
  try { await unlink(join(UPLOADS_DIR, existing.filename)); } catch {}
  stmts.deleteImage.run(id);
  return { ok: true };
});

// --- Start ---
app.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`OrthoRef running on http://localhost:${PORT}`);
  console.log(`Admin panel: http://localhost:${PORT}/admin`);
});
