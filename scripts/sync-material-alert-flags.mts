// Mark materials that are already at Watch or Order now as announced, WITHOUT
// emailing anyone. Run it whenever the stock-level rule changes
// (shared/material-health.ts), so the first check after the deploy doesn't email
// everything that was already low under the new rule. Also re-arms anything the
// new rule no longer considers low.
//
//   npx tsx --env-file=.env scripts/sync-material-alert-flags.mts                (dev)
//   npx tsx --env-file=.env scripts/sync-material-alert-flags.mts --prod         (prod)
//   add --dry-run to print the levels without changing anything
const prod = process.argv.includes("--prod");
const dryRun = process.argv.includes("--dry-run");
if (prod) {
  const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_URL_PROD;
  if (!url) {
    console.error("PROD_DATABASE_URL not set");
    process.exit(1);
  }
  // The server modules read DATABASE_URL when they load, so set it before importing them.
  process.env.DATABASE_URL = url;
}

const { storage } = await import("../server/storage");
const { db } = await import("../server/db");
const { sql } = await import("drizzle-orm");
const { checkMaterialStockAlerts } = await import("../server/material-alerts");
const { MATERIAL_LEVEL_LABELS } = await import("../shared/material-health");

const report = await storage.getReorderReport();
const byLevel = (key: string) => report.filter((r) => r.status === key);
console.log(`${prod ? "PROD" : "dev"}: ${report.length} active materials`);
for (const key of ["order-now", "watch", "healthy", "no-usage"] as const) {
  const rows = byLevel(key);
  console.log(`  ${MATERIAL_LEVEL_LABELS[key]}: ${rows.length}`);
  if (key === "order-now" || key === "watch") {
    for (const r of rows) {
      const days = r.daysOfCover === null ? "?" : Math.floor(r.daysOfCover);
      console.log(`    - ${r.title}: ${Number(r.stock.toFixed(2))} ${r.unit}, ${days} days left, ${r.leadTimeDays}-day lead time`);
    }
  }
}

if (dryRun) {
  console.log("dry run: nothing changed");
  process.exit(0);
}

const marked = await checkMaterialStockAlerts({ notify: false });
const [flags] = (await db.execute(sql`
  SELECT count(*) FILTER (WHERE reorder_alerted_at IS NOT NULL)::int AS order_now,
         count(*) FILTER (WHERE watch_alerted_at IS NOT NULL AND reorder_alerted_at IS NULL)::int AS watch
  FROM materials WHERE is_active AND deleted_at IS NULL`)).rows as Array<{ order_now: number; watch: number }>;
console.log(`newly marked as announced: Order now ${marked.orderNow.length}, Watch ${marked.watch.length}`);
console.log(`flags now: Order now ${flags.order_now}, Watch ${flags.watch} (should match the counts above)`);
process.exit(0);
