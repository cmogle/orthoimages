import { Pool } from "pg";

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL;

let pool;

export function getDb() {
  if (!SUPABASE_DB_URL) {
    throw new Error("Missing SUPABASE_DB_URL");
  }

  pool ??= new Pool({
    connectionString: SUPABASE_DB_URL,
    max: 5,
    ssl: { rejectUnauthorized: false },
  });

  return pool;
}
