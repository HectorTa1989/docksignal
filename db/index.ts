import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Driver-agnostic database handle. Production uses postgres-js; automated tests use PGlite. */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

let cached: { db: PostgresJsDatabase<Schema>; sql: ReturnType<typeof postgres> } | null = null;

export function getDb(): Db {
  if (cached) return cached.db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. DockSignal cannot run without PostgreSQL.");
  // DATABASE_POOL_MAX=1 keeps the PGlite dev server (npm run dev:db) happy; production defaults to 5.
  const max = Math.max(1, Number(process.env.DATABASE_POOL_MAX ?? 5) || 5);
  const sql = postgres(url, { max, idle_timeout: 20, prepare: false });
  cached = { db: drizzle(sql, { schema }), sql };
  return cached.db;
}

export { schema };
