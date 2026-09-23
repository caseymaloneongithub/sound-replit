/**
 * Stock emails for raw materials (owner, 2026-09-23: "notify the admins by email
 * when an item goes to reorder status" … "let's have the email alert when moved
 * to watch as well" … levels from usage and lead time, "consistent throughout
 * dashboard, table, and email notification").
 *
 * Levels come from storage.getMaterialLevels() — the same numbers the dashboard
 * and the Materials table show (rule: shared/material-health.ts). Admins are
 * emailed on the way DOWN, once per level per dip:
 *
 *   healthy   → watch       one Watch email
 *   watch     → order now   one Order now email
 *   healthy   → order now   one Order now email (a single big drop isn't two emails)
 *   order now → watch       no email; Order now re-arms for the next drop
 *   anything  → healthy     no email; both re-arm
 *
 * materials.watch_alerted_at / reorder_alerted_at ("marks") record what has been
 * announced. checkMaterialStockAlerts() runs after anything that changes stock,
 * usage, lead time or a material's active state, and once each morning (usage is
 * measured over sliding windows, so levels drift without anyone touching stock).
 * It never throws: a failed email must not fail the stock change that triggered it.
 *
 * Under load and failure (review, 2026-09-23):
 *   - One check at a time. Checks in this process queue behind the running one
 *     (everyone who asks meanwhile shares the next run), and each check holds a
 *     database lock while it works out levels and writes marks — across
 *     processes too, e.g. the flag-sync script. So an older check can't
 *     overwrite a newer one's marks with levels from before the newer change.
 *   - Nothing is marked until the admins have been looked up, and every mark is
 *     written by one UPDATE, so a failure before the email leaves nothing marked.
 *   - A failed email hands back exactly the marks this check wrote (matched by
 *     the time it wrote them), never a newer check's.
 */
import cron from "node-cron";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { recordEvent } from "./ops-events";
import { sendMaterialStockAlert, type MaterialStockAlertItem } from "./email";
import { PICKUP_POLICY } from "@shared/pickup-policy";
import { materialLevel } from "@shared/material-health";

type CheckResult = { orderNow: string[]; watch: string[] };
type MaterialWithLevel = Awaited<ReturnType<typeof storage.getMaterialLevels>>[number];
/** A material whose marks this check changed. */
type Marked = {
  id: string;
  title: string;
  unit: string;
  stock: string;
  supplierName: string | null;
  supplierWebsite: string | null;
  /** When this check wrote its marks, as Postgres stored it (text keeps the microseconds). */
  markedAt: string;
  /** Newly at Order now: announce it. */
  orderNow: boolean;
  /** Newly at Watch, and not at Order now: announce it. */
  watch: boolean;
};

let running: Promise<CheckResult> | null = null;
let queued: Promise<CheckResult> | null = null;

/**
 * @param opts.notify false = record levels without emailing or logging events —
 *   for marking what's already low as announced when the rule changes.
 */
export function checkMaterialStockAlerts(opts: { notify?: boolean } = {}): Promise<CheckResult> {
  if (opts.notify === false) return runCheck(false);
  if (!running) return start();
  // One is running and may have read the levels before this caller's change:
  // run once more after it, one run for everyone who asks in the meantime.
  if (!queued) {
    queued = running.then(() => {
      queued = null;
      return start();
    });
  }
  return queued;
}

function start(): Promise<CheckResult> {
  running = runCheck(true).finally(() => {
    running = null;
  });
  return running;
}

/** Never rejects. */
async function runCheck(notify: boolean): Promise<CheckResult> {
  const none: CheckResult = { orderNow: [], watch: [] };
  const prepared = await (async () => {
    // Who to tell comes first: if this lookup fails, nothing has been marked
    // and the next check tries again.
    const adminEmails = notify ? await lookUpAdminEmails() : [];
    return { adminEmails, ...(await writeMarks()) };
  })().catch((error: any) => {
    console.error(`[INVENTORY] Stock alert check failed: ${error?.message}`);
    return null;
  });
  if (!prepared) return none;
  const { adminEmails, marked, byId } = prepared;

  const orderNow = marked.filter((m) => m.orderNow);
  const watch = marked.filter((m) => m.watch);
  const result: CheckResult = { orderNow: orderNow.map((m) => m.title), watch: watch.map((m) => m.title) };
  if (!notify || (orderNow.length === 0 && watch.length === 0)) return result;

  let items: MaterialStockAlertItem[] = [];
  try {
    items = [...orderNow.map((m) => toItem(m, "order-now", byId)), ...watch.map((m) => toItem(m, "watch", byId))]
      .sort((a, b) => (a.level === b.level ? (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0) : a.level === "order-now" ? -1 : 1));
    if (adminEmails.length > 0) {
      await sendMaterialStockAlert({ adminEmails, items });
    }
  } catch (error: any) {
    // Hand back this check's marks, so the next check tries again instead of
    // the drop going unannounced.
    await releaseMarks([...orderNow, ...watch]).catch((e: any) =>
      console.error(`[INVENTORY] Couldn't hand back stock alert marks: ${e?.message}`));
    const what = items.length > 0
      ? [list(items, "order-now"), list(items, "watch")].filter(Boolean).join("; ")
      : [...orderNow, ...watch].map((m) => m.title).join(", ");
    console.error(`[INVENTORY] Stock alert email failed for ${what}: ${error?.message}`);
    void recordEvent({
      severity: "warn",
      kind: "inventory.stock_alert_email_failed",
      message: `Stock alert email failed for ${what} — will retry on the next check: ${error?.message ?? "unknown error"}`,
    });
    return none;
  }

  const sentNote = adminEmails.length ? `emailed ${adminEmails.length} admin(s)` : "no admin email on file";
  if (orderNow.length > 0) {
    console.log(`[INVENTORY] Order now: ${list(items, "order-now")} — ${sentNote}`);
    void recordEvent({ severity: "info", kind: "inventory.order_now", message: `Order now: ${list(items, "order-now")}`, detail: { materialIds: orderNow.map((m) => m.id), emailedTo: adminEmails.length } });
  }
  if (watch.length > 0) {
    console.log(`[INVENTORY] Watch: ${list(items, "watch")} — ${sentNote}`);
    void recordEvent({ severity: "info", kind: "inventory.watch", message: `Watch: ${list(items, "watch")}`, detail: { materialIds: watch.map((m) => m.id), emailedTo: adminEmails.length } });
  }
  return result;
}

async function lookUpAdminEmails(): Promise<string[]> {
  const admins = [...(await storage.getUsersByRole("admin")), ...(await storage.getUsersByRole("super_admin"))];
  return Array.from(new Set(admins.map((u) => u.email).filter((e): e is string => !!e)));
}

/**
 * Works out every material's levels and brings its marks in line with them:
 * one transaction holding the stock-check lock, one UPDATE, all or nothing.
 */
async function writeMarks(): Promise<{ marked: Marked[]; byId: Map<string, MaterialWithLevel> }> {
  return await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('material_stock_alerts'))`);
    // Read under the lock, so the levels include everything committed before
    // this check started writing.
    const materials = await storage.getMaterialLevels();
    const byId = new Map(materials.map((m) => [m.id, m]));
    if (materials.length === 0) return { marked: [], byId };

    // Each material's thresholds. None (NULL) = nothing to measure against:
    // its marks clear and it never alerts.
    const levels = sql`(VALUES ${sql.join(
      materials.map((m) => sql`(${m.id}::varchar, ${m.level.orderNowAt}::numeric, ${m.level.watchAt}::numeric)`),
      sql`, `,
    )}) AS lv(id, order_now_at, watch_at)`;

    // The table in the header as each material's next marks. Order now counts
    // as Watch announced too, so one big drop is one email. Above every level
    // both clear — and for a material at Order now only by the reorder-size
    // floor, "every level" can mean above Order now with no Watch level at all.
    const off = sql`(NOT m.is_active OR m.deleted_at IS NOT NULL OR lv.order_now_at IS NULL)`;
    const nextWatch = sql`(CASE WHEN ${off} THEN NULL
      WHEN m.stock <= lv.order_now_at OR m.stock <= lv.watch_at THEN coalesce(m.watch_alerted_at, now()::timestamp)
      ELSE NULL END)`;
    const nextReorder = sql`(CASE WHEN ${off} THEN NULL
      WHEN m.stock <= lv.order_now_at THEN coalesce(m.reorder_alerted_at, now()::timestamp)
      ELSE NULL END)`;

    // In RETURNING, m is the row as written: a mark equal to now() was written
    // by this statement, while an existing mark keeps its older time.
    return {
      marked: (await tx.execute(sql`
        UPDATE materials m SET watch_alerted_at = ${nextWatch}, reorder_alerted_at = ${nextReorder}
        FROM ${levels}
        WHERE m.id = lv.id
          AND (m.watch_alerted_at IS DISTINCT FROM ${nextWatch} OR m.reorder_alerted_at IS DISTINCT FROM ${nextReorder})
        RETURNING m.id, m.title, m.unit, m.stock,
          (SELECT s.name FROM suppliers s WHERE s.id = m.supplier_id) AS "supplierName",
          (SELECT s.website FROM suppliers s WHERE s.id = m.supplier_id) AS "supplierWebsite",
          now()::timestamp::text AS "markedAt",
          coalesce(m.reorder_alerted_at = now()::timestamp, false) AS "orderNow",
          coalesce(m.watch_alerted_at = now()::timestamp AND m.reorder_alerted_at IS NULL, false) AS "watch"`)).rows as Marked[],
      byId,
    };
  });
}

/** Undo this check's marks, and only this check's: the ones still carrying its time. */
async function releaseMarks(rows: Marked[]): Promise<void> {
  if (rows.length === 0) return;
  const at = rows[0].markedAt; // one UPDATE wrote them all
  const ids = sql.join(rows.map((m) => sql`${m.id}`), sql`, `);
  await db.execute(sql`
    UPDATE materials SET
      reorder_alerted_at = CASE WHEN reorder_alerted_at = ${at}::timestamp THEN NULL ELSE reorder_alerted_at END,
      watch_alerted_at = CASE WHEN watch_alerted_at = ${at}::timestamp THEN NULL ELSE watch_alerted_at END
    WHERE id IN (${ids})
      AND (reorder_alerted_at = ${at}::timestamp OR watch_alerted_at = ${at}::timestamp)`);
}

function toItem(m: Marked, level: MaterialStockAlertItem["level"], byId: Map<string, MaterialWithLevel>): MaterialStockAlertItem {
  const lv = byId.get(m.id)!;
  const stock = Number(m.stock);
  // Reasons from the stock the UPDATE saw, by the same rule.
  const now = materialLevel(stock, lv.level.dailyUsage, lv.level.leadTimeDays, Number(lv.orderSize));
  return {
    level,
    title: m.title,
    unit: m.unit,
    stock,
    dailyUsage: lv.level.dailyUsage,
    daysOfCover: now.daysOfCover,
    leadTimeDays: lv.level.leadTimeDays,
    suggestedQty: lv.suggestedQty,
    orderSize: Number(lv.orderSize),
    orderNowReasons: level === "order-now" ? now.orderNowReasons : [],
    supplierName: m.supplierName,
    supplierWebsite: m.supplierWebsite,
  };
}

function describe(i: MaterialStockAlertItem): string {
  const parts = [
    i.daysOfCover === null ? "no recent use" : `${Math.floor(i.daysOfCover)} days left`,
    `${i.leadTimeDays}-day lead time`,
  ];
  if (i.orderNowReasons.includes("reorder-size") && i.orderSize > 0) {
    parts.push(`${Math.round((100 * i.stock) / i.orderSize)}% of reorder size`);
  }
  return `${i.title} (${parts.join(", ")})`;
}

function list(items: MaterialStockAlertItem[], level: MaterialStockAlertItem["level"]): string {
  return items.filter((i) => i.level === level).map(describe).join(", ");
}

/**
 * Once a day as well, before the 7 a.m. digest: usage is measured over sliding
 * windows, so a material can drift into Watch or Order now without anyone
 * touching its stock. Gated by DISABLE_CRON in index.ts like the other jobs.
 */
export function startMaterialStockAlertCron(): void {
  cron.schedule("50 6 * * *", () => {
    void checkMaterialStockAlerts();
  }, { timezone: PICKUP_POLICY.timezone });
  console.log("[INVENTORY] daily stock-level check scheduled for 6:50 AM Pacific");
}
