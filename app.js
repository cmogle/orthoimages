import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { v4 as uuidv4 } from "uuid";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDb } from "./lib/db.js";
import { buildPublicUrl, getSupabaseConfig, getSupabaseAdmin } from "./lib/supabase.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ALLOWED_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

let appPromise;

function fail(statusCode, message) {
  return { statusCode, message };
}

function normalizeImage(image) {
  const url = image.asset_url || buildPublicUrl(image.storage_path);
  return {
    ...image,
    filename: image.original_name || "",
    original_name: image.original_name || "",
    url,
    thumb_url: image.thumb_url || url,
  };
}

function requireName(name) {
  const value = name?.trim();
  if (!value) {
    throw fail(400, "Name is required");
  }
  return value;
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

async function buildApp() {
  const app = Fastify({ logger: false });
  const db = getDb();
  const supabase = getSupabaseAdmin();
  const { bucket } = getSupabaseConfig();

  await app.register(fastifyMultipart, {
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  await app.register(fastifyStatic, {
    root: join(__dirname, "public"),
    prefix: "/",
  });

  app.get("/", (req, reply) => reply.sendFile("index.html"));
  app.get("/admin", (req, reply) => reply.sendFile("admin.html"));

  app.get("/api/conditions", async () => {
    const [conditionsResult, imagesResult] = await Promise.all([
      db.query("select * from ortho.conditions order by body_region, name"),
      db.query("select * from ortho.images order by sort_order, id"),
    ]);

    const imagesByCondition = new Map();
    for (const image of imagesResult.rows) {
      const group = imagesByCondition.get(image.condition_id) || [];
      group.push(normalizeImage(image));
      imagesByCondition.set(image.condition_id, group);
    }

    return conditionsResult.rows.map((condition) => ({
      ...condition,
      images: imagesByCondition.get(condition.id) || [],
    }));
  });

  app.post("/api/conditions", async (req) => {
    const { name, aliases = "", body_region = "" } = req.body;
    const safeName = requireName(name);
    const slugBase = slugify(safeName);
    const slug = `${slugBase}-${Date.now()}`;
    const result = await db.query(
      `insert into ortho.conditions (slug, name, aliases, body_region)
       values ($1, $2, $3, $4)
       returning *`,
      [slug, safeName, aliases.trim(), body_region.trim()]
    );
    return result.rows[0];
  });

  app.put("/api/conditions/:id", async (req) => {
    const id = Number(req.params.id);
    const { name, aliases = "", body_region = "" } = req.body;
    const safeName = requireName(name);
    const result = await db.query(
      `update ortho.conditions
       set name = $1, aliases = $2, body_region = $3
       where id = $4
       returning *`,
      [safeName, aliases.trim(), body_region.trim(), id]
    );

    if (!result.rowCount) {
      throw fail(404, "Condition not found");
    }

    return result.rows[0];
  });

  app.delete("/api/conditions/:id", async (req) => {
    const id = Number(req.params.id);
    const imageResult = await db.query(
      "select storage_path from ortho.images where condition_id = $1",
      [id]
    );

    const storagePaths = imageResult.rows.map((image) => image.storage_path).filter(Boolean);
    if (storagePaths.length) {
      const { error: removeError } = await supabase.storage.from(bucket).remove(storagePaths);
      if (removeError) {
        throw fail(500, removeError.message || "Failed to delete image assets");
      }
    }

    await db.query("delete from ortho.conditions where id = $1", [id]);
    return { ok: true };
  });

  app.post("/api/conditions/:id/images", async (req) => {
    const conditionId = Number(req.params.id);
    const conditionResult = await db.query("select id from ortho.conditions where id = $1", [conditionId]);
    if (!conditionResult.rowCount) {
      throw fail(404, "Condition not found");
    }

    const maxSortResult = await db.query(
      "select coalesce(max(sort_order), 0) as max_sort from ortho.images where condition_id = $1",
      [conditionId]
    );
    let nextSort = Number(maxSortResult.rows[0]?.max_sort || 0);

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

      const storagePath = `conditions/${conditionId}/${uuidv4()}${ext}`;
      const buffer = await part.toBuffer();
      const { error: uploadError } = await supabase.storage.from(bucket).upload(storagePath, buffer, {
        cacheControl: "31536000",
        contentType: part.mimetype || "application/octet-stream",
        upsert: false,
      });

      if (uploadError) {
        throw fail(500, uploadError.message || "Failed to upload image");
      }

      nextSort += 1;
      const assetUrl = buildPublicUrl(storagePath);
      const insertResult = await db.query(
        `insert into ortho.images
          (condition_id, storage_path, original_name, view_label, sort_order, asset_url, thumb_url, source)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning *`,
        [
          conditionId,
          storagePath,
          part.filename || storagePath.split("/").pop() || "",
          viewLabel,
          nextSort,
          assetUrl,
          assetUrl,
          "upload",
        ]
      );

      uploaded.push(normalizeImage(insertResult.rows[0]));
    }

    return uploaded;
  });

  app.put("/api/images/:id", async (req) => {
    const id = Number(req.params.id);
    const { view_label = "", sort_order } = req.body;
    const result = await db.query(
      `update ortho.images
       set view_label = $1,
           sort_order = coalesce($2, sort_order)
       where id = $3
       returning id`,
      [view_label, typeof sort_order === "undefined" ? null : Number(sort_order), id]
    );

    if (!result.rowCount) {
      throw fail(404, "Image not found");
    }

    return { ok: true };
  });

  app.delete("/api/images/:id", async (req) => {
    const id = Number(req.params.id);
    const imageResult = await db.query("select * from ortho.images where id = $1", [id]);
    const image = imageResult.rows[0];

    if (!image) {
      throw fail(404, "Image not found");
    }

    if (image.storage_path) {
      const { error: removeError } = await supabase.storage.from(bucket).remove([image.storage_path]);
      if (removeError) {
        throw fail(500, removeError.message || "Failed to delete image asset");
      }
    }

    await db.query("delete from ortho.images where id = $1", [id]);
    return { ok: true };
  });

  return app;
}

export function getApp() {
  appPromise ??= buildApp();
  return appPromise;
}
