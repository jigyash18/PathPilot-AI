import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const migrationUrl = new URL("../migrations/0001_add_auth_sessions.sql", import.meta.url);
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("Authentication schema migration failed: DATABASE_URL is not configured.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
let client;
let lockAcquired = false;

try {
  const migration = await readFile(migrationUrl, "utf8");
  client = await pool.connect();
  await client.query("SELECT pg_advisory_lock(1347176521, 1)");
  lockAcquired = true;
  await client.query(migration);
  await client.query(
    "SELECT id, name, email, password_hash, available_hours, preferred_start, preferred_end " +
      "FROM public.pathpilot_users WHERE lower(email) = $1 LIMIT $2",
    ["", 0],
  );
  await client.query(
    "SELECT id, user_id, token_hash, expires_at, remember_me, created_at, last_used_at " +
      "FROM public.pathpilot_sessions LIMIT 0",
  );
  console.info("Authentication schema migration 0001 completed successfully.");
} catch (error) {
  const value = error && typeof error === "object" ? error : {};
  const code = typeof value.code === "string" && /^[0-9A-Z]{5}$/.test(value.code) ? ` SQLSTATE ${value.code}.` : "";
  const identifiers = ["schema", "table", "column", "constraint"]
    .filter((key) => typeof value[key] === "string" && /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(value[key]))
    .map((key) => `${key}=${value[key]}`);
  console.error(`Authentication schema migration 0001 or verification failed.${code}${identifiers.length ? ` ${identifiers.join(" ")}.` : ""}`);
  process.exitCode = 1;
} finally {
  if (client) {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(1347176521, 1)");
      } catch {
        process.exitCode = 1;
      }
    }
    client.release();
  }
  await pool.end();
}
