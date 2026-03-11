import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import pg from "pg";

const { Pool } = pg;
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST_PATH = join(ROOT, "seed-data", "seed-manifest.json");
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "ortho-images";
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;
const SKIP_UPLOAD = process.env.SUPABASE_SKIP_UPLOAD === "1";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_DB_URL) {
  throw new Error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_DB_URL");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const pool = new Pool({
  connectionString: SUPABASE_DB_URL,
  max: 3,
  ssl: { rejectUnauthorized: false },
});

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function getMimeType(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function resolveLocalPath(assetUrl) {
  return join(ROOT, "public", assetUrl.replace(/^\//, ""));
}

function toStoragePath(assetUrl) {
  return assetUrl.replace(/^\//, "");
}

function getPublicUrl(storagePath) {
  return supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}

const rawManifest = await readFile(MANIFEST_PATH, "utf8");
const conditions = JSON.parse(rawManifest);

let uploadedCount = 0;
let conditionCount = 0;
let imageCount = 0;

for (const condition of conditions) {
  const slug = slugify(condition.name);
  const conditionResult = await pool.query(
    `insert into ortho.conditions (slug, name, aliases, body_region)
     values ($1, $2, $3, $4)
     on conflict (slug) do update
     set name = excluded.name,
         body_region = excluded.body_region
     returning id`,
    [slug, condition.name, "", condition.region || ""]
  );

  const conditionId = conditionResult.rows[0].id;
  conditionCount += 1;

  for (const [index, image] of condition.images.entries()) {
    const storagePath = toStoragePath(image.asset_url);
    const localPath = resolveLocalPath(image.asset_url);
    const buffer = await readFile(localPath);
    const originalName = storagePath.split("/").pop() || image.title || `image-${index + 1}`;

    if (!SKIP_UPLOAD) {
      const { error: uploadError } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(storagePath, buffer, {
          cacheControl: "31536000",
          contentType: getMimeType(localPath),
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }
    }

    uploadedCount += 1;

    const assetUrl = getPublicUrl(storagePath);
    const thumbPath = image.thumb_url ? toStoragePath(image.thumb_url) : storagePath;
    const thumbUrl = getPublicUrl(thumbPath);

    await pool.query(
      `insert into ortho.images
        (condition_id, storage_path, original_name, view_label, sort_order, asset_url, thumb_url, source)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (storage_path) do update
       set condition_id = excluded.condition_id,
           original_name = excluded.original_name,
           view_label = excluded.view_label,
           sort_order = excluded.sort_order,
           asset_url = excluded.asset_url,
           thumb_url = excluded.thumb_url,
           source = excluded.source`,
      [
        conditionId,
        storagePath,
        originalName,
        image.view_label || "",
        index,
        assetUrl,
        thumbUrl,
        image.source || "seed",
      ]
    );

    imageCount += 1;
  }
}

await pool.end();

console.log(
  JSON.stringify(
    {
      conditions: conditionCount,
      images: imageCount,
      uploaded: uploadedCount,
      bucket: SUPABASE_BUCKET,
    },
    null,
    2
  )
);
