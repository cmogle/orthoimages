import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET || "ortho-images";
const SUPABASE_SCHEMA = process.env.SUPABASE_SCHEMA || "ortho";

let client;

export function getSupabaseAdmin() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  client ??= createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return client;
}

export function getSupabaseConfig() {
  return {
    bucket: SUPABASE_BUCKET,
    schema: SUPABASE_SCHEMA,
    url: SUPABASE_URL,
  };
}

export function buildPublicUrl(storagePath) {
  if (!storagePath) return "";
  const supabase = getSupabaseAdmin();
  return supabase.storage.from(SUPABASE_BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
