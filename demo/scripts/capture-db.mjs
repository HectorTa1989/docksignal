/**
 * Throwaway in-memory PostgreSQL (PGlite) for the walkthrough capture, with DockSignal's real
 * migrations applied. Started by scripts/capture.ts with the time-shift preload.
 */
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const root = path.resolve(import.meta.dirname, "..", "..");
const port = Number(process.env.CAPTURE_DB_PORT ?? 5510);
const db = new PGlite();
await db.waitReady;
await migrate(drizzle(db), { migrationsFolder: path.join(root, "drizzle") });
const server = new PGLiteSocketServer({ db, port, host: "127.0.0.1", maxConnections: 8 });
await server.start();
const { rows } = await db.query("select now() as now");
console.log(`capture-db ready on ${port} (db clock ${new Date(rows[0].now).toISOString()})`);
const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
