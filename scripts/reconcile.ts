import "dotenv/config";
import { serverDeps } from "../lib/server";
import { reconcileOpenTasks } from "../lib/reconcile";

/**
 * Local reconciliation loop for development without a public webhook URL:
 *   npm run reconcile            # one pass
 *   npm run reconcile -- --watch # poll every 5 seconds
 */
async function main() {
  const deps = serverDeps();
  if (!deps.config.ok) {
    console.error(deps.config.reason);
    process.exit(1);
  }
  const watch = process.argv.includes("--watch");
  do {
    const report = await reconcileOpenTasks(deps, {});
    console.log(new Date().toISOString(), JSON.stringify(report));
    if (watch) await new Promise((r) => setTimeout(r, 5000));
  } while (watch);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
