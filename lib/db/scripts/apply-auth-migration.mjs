import { readFile } from "node:fs/promises";
import pg from "pg";

const { Pool } = pg;
const migrationUrl = new URL("../migrations/0001_add_auth_sessions.sql", import.meta.url);
const databaseUrl = process.env.DATABASE_URL;
const safeCodePattern = /^(?:[0-9A-Z]{5}|E[A-Z0-9_]{1,31})$/;

function errorChain(error) {
  const chain = [];
  const seen = new Set();
  const pending = [error];
  while (pending.length && chain.length < 6) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    chain.push(current);
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors.slice(0, 2));
  }
  return chain;
}

function safeMigrationDiagnostic(error, phase) {
  const chain = errorChain(error);
  const coded = chain.find((item) => typeof item.code === "string" && safeCodePattern.test(item.code));
  const code = coded?.code;
  const name = [coded?.name, ...chain.map((item) => item.name)]
    .find((value) => typeof value === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(value)) ?? "UnknownError";
  const categoryByCode = {
    "42P01": ["missing_table", "Required database table does not exist."],
    "42703": ["missing_column", "Required database column does not exist."],
    "23505": ["duplicate_email_or_index_conflict", "Unique constraint conflict; check for duplicate email values or index conflicts."],
    "42P07": ["duplicate_table_or_index", "A table or index with the required name already exists."],
    "42710": ["duplicate_database_object", "A database object with the required name already exists."],
    "3D000": ["missing_database", "The configured PostgreSQL database does not exist."],
    "3F000": ["missing_schema", "The required PostgreSQL schema does not exist."],
    "42501": ["permission_denied", "The database role lacks a required migration permission."],
    "28P01": ["connection_authentication_failed", "PostgreSQL rejected the configured connection credentials."],
    "P0001": ["schema_validation_failed", "The migration rejected an incompatible existing schema object."],
    "57014": ["query_cancelled", "PostgreSQL cancelled the migration operation."],
    "55P03": ["lock_unavailable", "A required database lock was unavailable."],
    ECONNREFUSED: ["connection_refused", "The PostgreSQL server refused the connection."],
    ECONNRESET: ["connection_reset", "The PostgreSQL connection was reset."],
    ETIMEDOUT: ["connection_timeout", "The PostgreSQL connection timed out."],
    ENOTFOUND: ["connection_host_not_found", "The PostgreSQL host could not be resolved."],
    EAI_AGAIN: ["connection_dns_temporary_failure", "Temporary DNS failure while locating PostgreSQL."],
    EHOSTUNREACH: ["connection_host_unreachable", "The PostgreSQL host could not be reached."],
  };
  let [category, message] = categoryByCode[code] ?? [];
  if (!category && typeof code === "string" && code.startsWith("08")) {
    category = "connection_failure";
    message = "PostgreSQL reported a connection failure.";
  } else if (!category && typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
    category = "postgresql_error";
    message = "PostgreSQL rejected the migration or schema verification query.";
  } else if (!category) {
    category = "migration_runner_error";
    message = `Migration runner failed during ${phase}.`;
  }

  const identifiers = {};
  for (const key of ["schema", "table", "column", "constraint"]) {
    const value = coded?.[key];
    if (typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_$]{0,127}$/.test(value)) identifiers[key] = value;
  }
  return { phase, category, errorName: name, ...(code ? { errorCode: code } : {}), message, ...identifiers };
}

if (!databaseUrl) {
  console.error("Authentication schema migration failed: DATABASE_URL is not configured.");
  process.exit(1);
}

let pool;
let client;
let lockAcquired = false;
let phase = "reading the migration file";
let migrationVerified = false;

try {
  const migration = await readFile(migrationUrl, "utf8");
  phase = "connecting to PostgreSQL";
  pool = new Pool({ connectionString: databaseUrl, max: 1 });
  client = await pool.connect();
  phase = "acquiring the migration lock";
  await client.query("SELECT pg_advisory_lock(1347176521, 1)");
  lockAcquired = true;
  phase = "applying migration 0001";
  await client.query(migration);
  phase = "verifying the pathpilot_users schema";
  await client.query(
    "SELECT id, name, email, password_hash, available_hours, preferred_start, preferred_end " +
      "FROM public.pathpilot_users WHERE lower(email) = $1 LIMIT $2",
    ["", 0],
  );
  phase = "verifying the pathpilot_sessions schema";
  await client.query(
    "SELECT id, user_id, token_hash, expires_at, remember_me, created_at, last_used_at " +
      "FROM public.pathpilot_sessions LIMIT 0",
  );
  migrationVerified = true;
} catch (error) {
  console.error("Authentication schema migration failed:", JSON.stringify(safeMigrationDiagnostic(error, phase)));
  process.exitCode = 1;
} finally {
  if (client) {
    if (lockAcquired) {
      try {
        await client.query("SELECT pg_advisory_unlock(1347176521, 1)");
      } catch (error) {
        console.error("Authentication migration cleanup failed:", JSON.stringify(safeMigrationDiagnostic(error, "releasing the migration lock")));
        process.exitCode = 1;
      }
    }
    client.release();
  }
  if (pool) {
    try {
      await pool.end();
    } catch (error) {
      console.error("Authentication migration cleanup failed:", JSON.stringify(safeMigrationDiagnostic(error, "closing the PostgreSQL connection")));
      process.exitCode = 1;
    }
  }
}

if (migrationVerified && !process.exitCode) {
  console.info("Authentication schema migration 0001 completed successfully.");
}
