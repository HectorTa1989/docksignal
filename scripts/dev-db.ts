import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";

/**
 * Development-only PostgreSQL stand-in. Runs PGlite (real Postgres compiled to WASM) behind
 * the Postgres wire protocol so `next dev` can use a normal DATABASE_URL without installing
 * a server. Data lives in ./.pglite (git-ignored). This is not used by the deployed app and
 * it does not fake any CALL-E behaviour: calls still require a real CALLE_API_KEY.
 *
 *   npm run dev:db      # then set DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5499/postgres
 */
async function main() {
  const dataDir = path.resolve(process.cwd(), ".pglite");
  const db = new PGlite(dataDir);
  await db.waitReady;
  await migrate(drizzle(db), { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  const port = Number(process.env.DEV_DB_PORT ?? 5499);
  const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 8 });
  await server.start();
  console.log(`PGlite dev database listening on postgres://postgres:postgres@127.0.0.1:${port}/postgres (data: ${dataDir})`);
  const stop = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
