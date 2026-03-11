import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { v4 as uuidv4 } from "uuid";
import { mkdir, writeFile, unlink, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const IS_VERCEL = Boolean(process.env.VERCEL);
const WRITABLE_BASE = IS_VERCEL ? "/tmp/orthoref" : __dirname;
const UPLOADS_DIR = join(WRITABLE_BASE, "uploads");
const DATA_DIR = join(WRITABLE_BASE, "data");
const DB_PATH = join(DATA_DIR, "orthoref.db");
const SEED_MANIFEST_PATH = join(__dirname, "seed-data", "seed-manifest.json");
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

let appPromise;

async function buildApp() {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(DATA_DIR, { recursive: true });

  const SQL = await initSqlJs();

  let db;
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
      asset_url TEXT DEFAULT '',
      thumb_url TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  async function saveDatabase() {
    const data = db.export();
    await writeFile(DB_PATH, Buffer.from(data));
  }

  function runQuery(sql, params = []) {
    db.run(sql, params);
    return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] };
  }

  function getAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
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

  function ensureColumn(table, name, definition) {
    const columns = getAll(`PRAGMA table_info(${table})`);
    if (columns.some((column) => column.name === name)) {
      return;
    }
    db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  }

  ensureColumn("images", "asset_url", "asset_url TEXT DEFAULT ''");
  ensureColumn("images", "thumb_url", "thumb_url TEXT DEFAULT ''");

  function resolveImage(image) {
    const url = image.asset_url || (image.filename ? `/uploads/${image.filename}` : "");
    return {
      ...image,
      url,
      thumb_url: image.thumb_url || url,
    };
  }

  async function seedDatabaseIfEmpty() {
    const conditionCount = getOne("SELECT COUNT(*) AS count FROM conditions");
    if (Number(conditionCount?.count || 0) > 0) {
      return;
    }

    if (!existsSync(SEED_MANIFEST_PATH)) {
      return;
    }

    const raw = await readFile(SEED_MANIFEST_PATH, "utf8");
    const seedConditions = JSON.parse(raw);

    for (const condition of seedConditions) {
      const conditionId = runQuery(
        "INSERT INTO conditions (name, aliases, body_region) VALUES (?, ?, ?)",
        [condition.name, "", condition.region]
      ).lastInsertRowid;

      condition.images.forEach((image, index) => {
        runQuery(
          "INSERT INTO images (condition_id, filename, original_name, view_label, sort_order, asset_url, thumb_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [
            conditionId,
            "",
            image.title,
            image.view_label || "",
            index,
            image.asset_url,
            image.thumb_url || "",
          ]
        );
      });
    }

    await saveDatabase();
  }

  await seedDatabaseIfEmpty();

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

  app.get("/", (req, reply) => reply.sendFile("index.html"));
  app.get("/admin", (req, reply) => reply.sendFile("admin.html"));

  app.get("/api/conditions", () => {
    const conditions = getAll("SELECT * FROM conditions ORDER BY body_region, name");
    return conditions.map((condition) => ({
      ...condition,
      images: getAll(
        "SELECT * FROM images WHERE condition_id = ? ORDER BY sort_order, id",
        [condition.id]
      ).map(resolveImage),
    }));
  });

  app.post("/api/conditions", async (req) => {
    const { name, aliases = "", body_region = "" } = req.body;
    if (!name?.trim()) {
      throw { statusCode: 400, message: "Name is required" };
    }

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
    if (!existing) {
      throw { statusCode: 404, message: "Condition not found" };
    }

    const { name, aliases = "", body_region = "" } = req.body;
    if (!name?.trim()) {
      throw { statusCode: 400, message: "Name is required" };
    }

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
    for (const image of images) {
      if (!image.asset_url && image.filename) {
        try {
          await unlink(join(UPLOADS_DIR, image.filename));
        } catch {
          // Ignore missing files during cleanup.
        }
      }
    }
    runQuery("DELETE FROM images WHERE condition_id = ?", [id]);
    runQuery("DELETE FROM conditions WHERE id = ?", [id]);
    await saveDatabase();
    return { ok: true };
  });

  app.post("/api/conditions/:id/images", async (req) => {
    const conditionId = Number(req.params.id);
    const existing = getOne("SELECT * FROM conditions WHERE id = ?", [conditionId]);
    if (!existing) {
      throw { statusCode: 404, message: "Condition not found" };
    }

    const parts = req.parts();
    const uploaded = [];
    let viewLabel = "";

    for await (const part of parts) {
      if (part.type === "field" && part.fieldname === "view_label") {
        viewLabel = part.value?.toString() || "";
        continue;
      }

      if (part.type !== "file") {
        continue;
      }

      const ext = extname(part.filename || "").toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) {
        continue;
      }

      const newFilename = `${uuidv4()}${ext}`;
      const buffer = await part.toBuffer();
      await writeFile(join(UPLOADS_DIR, newFilename), buffer);

      const maxSortResult = getOne(
        "SELECT COALESCE(MAX(sort_order), 0) as max_sort FROM images WHERE condition_id = ?",
        [conditionId]
      );
      const maxSort = maxSortResult?.max_sort || 0;
      const result = runQuery(
        "INSERT INTO images (condition_id, filename, original_name, view_label, sort_order, asset_url, thumb_url) VALUES (?, ?, ?, ?, ?, '', '')",
        [conditionId, newFilename, part.filename, viewLabel, maxSort + 1]
      );

      uploaded.push({
        id: result.lastInsertRowid,
        filename: newFilename,
        original_name: part.filename,
        view_label: viewLabel,
        url: `/uploads/${newFilename}`,
        thumb_url: `/uploads/${newFilename}`,
      });
    }

    await saveDatabase();
    return uploaded;
  });

  app.put("/api/images/:id", async (req) => {
    const id = Number(req.params.id);
    const existing = getOne("SELECT * FROM images WHERE id = ?", [id]);
    if (!existing) {
      throw { statusCode: 404, message: "Image not found" };
    }

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
    if (!existing) {
      throw { statusCode: 404, message: "Image not found" };
    }

    if (!existing.asset_url && existing.filename) {
      try {
        await unlink(join(UPLOADS_DIR, existing.filename));
      } catch {
        // Ignore missing files during cleanup.
      }
    }
    runQuery("DELETE FROM images WHERE id = ?", [id]);
    await saveDatabase();
    return { ok: true };
  });

  return app;
}

export function getApp() {
  appPromise ??= buildApp();
  return appPromise;
}
