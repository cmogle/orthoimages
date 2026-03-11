import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyMultipart from "@fastify/multipart";
import { v4 as uuidv4 } from "uuid";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    const [{ data: conditions, error: conditionsError }, { data: images, error: imagesError }] =
      await Promise.all([
        supabase.from("ortho_conditions").select("*").order("body_region").order("name"),
        supabase.from("ortho_images").select("*").order("sort_order").order("id"),
      ]);

    if (conditionsError || imagesError) {
      throw fail(500, conditionsError?.message || imagesError?.message || "Failed to load conditions");
    }

    const imagesByCondition = new Map();
    for (const image of images || []) {
      const group = imagesByCondition.get(image.condition_id) || [];
      group.push(normalizeImage(image));
      imagesByCondition.set(image.condition_id, group);
    }

    return (conditions || []).map((condition) => ({
      ...condition,
      images: imagesByCondition.get(condition.id) || [],
    }));
  });

  app.post("/api/conditions", async (req) => {
    const { name, aliases = "", body_region = "" } = req.body;
    const safeName = requireName(name);
    const slugBase = slugify(safeName);
    const slug = `${slugBase}-${Date.now()}`;
    const { data, error } = await supabase
      .from("ortho_conditions")
      .insert({
        slug,
        name: safeName,
        aliases: aliases.trim(),
        body_region: body_region.trim(),
      })
      .select()
      .single();

    if (error) {
      throw fail(500, error.message || "Failed to create condition");
    }

    return data;
  });

  app.put("/api/conditions/:id", async (req) => {
    const id = Number(req.params.id);
    const { name, aliases = "", body_region = "" } = req.body;
    const safeName = requireName(name);
    const { data, error } = await supabase
      .from("ortho_conditions")
      .update({
        name: safeName,
        aliases: aliases.trim(),
        body_region: body_region.trim(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw fail(error?.code === "PGRST116" ? 404 : 500, error?.message || "Condition not found");
    }

    return data;
  });

  app.delete("/api/conditions/:id", async (req) => {
    const id = Number(req.params.id);
    const { data: images, error: imagesError } = await supabase
      .from("ortho_images")
      .select("storage_path")
      .eq("condition_id", id);

    if (imagesError) {
      throw fail(500, imagesError.message || "Failed to load condition images");
    }

    const storagePaths = (images || []).map((image) => image.storage_path).filter(Boolean);
    if (storagePaths.length) {
      const { error: removeError } = await supabase.storage.from(bucket).remove(storagePaths);
      if (removeError) {
        throw fail(500, removeError.message || "Failed to delete image assets");
      }
    }

    const { error } = await supabase.from("ortho_conditions").delete().eq("id", id);
    if (error) {
      throw fail(500, error.message || "Failed to delete condition");
    }

    return { ok: true };
  });

  app.post("/api/conditions/:id/images", async (req) => {
    const conditionId = Number(req.params.id);
    const { data: condition, error: conditionError } = await supabase
      .from("ortho_conditions")
      .select("id")
      .eq("id", conditionId)
      .single();

    if (conditionError || !condition) {
      throw fail(404, "Condition not found");
    }

    const { data: lastImageRows, error: lastImageError } = await supabase
      .from("ortho_images")
      .select("sort_order")
      .eq("condition_id", conditionId)
      .order("sort_order", { ascending: false })
      .limit(1);

    if (lastImageError) {
      throw fail(500, lastImageError.message || "Failed to read image order");
    }

    let nextSort = Number(lastImageRows?.[0]?.sort_order || 0);

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
      const { data: imageRow, error: imageError } = await supabase
        .from("ortho_images")
        .insert({
          condition_id: conditionId,
          storage_path: storagePath,
          original_name: part.filename || storagePath.split("/").pop() || "",
          view_label: viewLabel,
          sort_order: nextSort,
          asset_url: assetUrl,
          thumb_url: assetUrl,
          source: "upload",
        })
        .select()
        .single();

      if (imageError) {
        await supabase.storage.from(bucket).remove([storagePath]);
        throw fail(500, imageError.message || "Failed to save image record");
      }

      uploaded.push(normalizeImage(imageRow));
    }

    return uploaded;
  });

  app.put("/api/images/:id", async (req) => {
    const id = Number(req.params.id);
    const { view_label = "", sort_order } = req.body;
    const updates = { view_label };
    if (typeof sort_order !== "undefined") {
      updates.sort_order = Number(sort_order);
    }

    const { data, error } = await supabase
      .from("ortho_images")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error || !data) {
      throw fail(error?.code === "PGRST116" ? 404 : 500, error?.message || "Image not found");
    }

    return { ok: true };
  });

  app.delete("/api/images/:id", async (req) => {
    const id = Number(req.params.id);
    const { data: image, error: imageError } = await supabase
      .from("ortho_images")
      .select("*")
      .eq("id", id)
      .single();

    if (imageError || !image) {
      throw fail(404, "Image not found");
    }

    if (image.storage_path) {
      const { error: removeError } = await supabase.storage.from(bucket).remove([image.storage_path]);
      if (removeError) {
        throw fail(500, removeError.message || "Failed to delete image asset");
      }
    }

    const { error } = await supabase.from("ortho_images").delete().eq("id", id);
    if (error) {
      throw fail(500, error.message || "Failed to delete image");
    }

    return { ok: true };
  });

  return app;
}

export function getApp() {
  appPromise ??= buildApp();
  return appPromise;
}
