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
 * materials.watch_alerted_at / reorder_alerted_at record what has been sent.
 *
 * checkMaterialStockAlerts() runs after anything that changes stock, usage, lead
 * time or a material's active state, and once each morning (usage is measured
 * over sliding windows, so levels drift without anyone touching stock). The thresholds
 * are worked out in code, then every claim and re-arm is one UPDATE whose stock
 * and flag conditions are checked on the row itself, so two checks running at
 * once can't announce the same drop twice. It never throws: a failed email must
 * not fail the stock change that triggered it.
 */
import cron from "node-cron";
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { recordEvent } from "./ops-events";
import { sendMaterialStockAlert, type MaterialStockAlertItem } from "./email";
import { PICKUP_POLICY } from "@shared/pickup-policy";
import { materialLevel } from "@shared/material-health";

type Claimed = { id: string; title: string; unit: string; stock: string; supplierName: string | null; supplierWebsite: string | null };
const RETURNING = sql`RETURNING m.id, m.title, m.unit, m.stock,
  (SELECT s.name FROM suppliers s WHERE s.id = m.supplier_id) AS "supplierName",
  (SELECT s.website FROM suppliers s WHERE s.id = m.supplier_id) AS "supplierWebsite"`;

/**
 * @param opts.notify false = record levels without emailing or logging events —
 *   for marking what's already low as announced when the rule changes.
 */
export async function checkMaterialStockAlerts(opts: { notify?: boolean } = {}): Promise<{ orderNow: string[]; watch: string[] }> {
  const notify = opts.notify !== false;
  try {
    const materials = await storage.getMaterialLevels();
    if (materials.length === 0) return { orderNow: [], watch: [] };
    const byId = new Map(materials.map((m) => [m.id, m]));

    // Each material's thresholds, as a VALUES list the UPDATEs join against.
    // No recent use → no thresholds (NULL), which re-arms and never alerts.
    const levels: SQL = sql`(VALUES ${sql.join(
      materials.map((m) => sql`(${m.id}::varchar, ${m.level.orderNowAt}::numeric, ${m.level.watchAt}::numeric)`),
      sql`, `,
    )}) AS lv(id, order_now_at, watch_at)`;

    // Above every alert level (restocked, counted up, usage fell, lead time
    // shortened, switched off): both levels re-arm. "Every level" is the higher
    // of Watch and Order now: the reorder-size check can put Order now above
    // Watch, or give a material with no recent use an Order now level and no
    // Watch level at all (GREATEST skips NULLs).
    await db.execute(sql`
      UPDATE materials m SET watch_alerted_at = NULL, reorder_alerted_at = NULL
      FROM ${levels}
      WHERE m.id = lv.id
        AND (m.watch_alerted_at IS NOT NULL OR m.reorder_alerted_at IS NOT NULL)
        AND (NOT m.is_active OR m.deleted_at IS NOT NULL
          OR (lv.order_now_at IS NULL AND lv.watch_at IS NULL)
          OR m.stock > GREATEST(lv.order_now_at, lv.watch_at))`);
    // Back above Order now but still in Watch: Order now re-arms; climbing into
    // Watch from below isn't news, so no email.
    await db.execute(sql`
      UPDATE materials m SET reorder_alerted_at = NULL
      FROM ${levels}
      WHERE m.id = lv.id AND m.reorder_alerted_at IS NOT NULL
        AND m.stock > lv.order_now_at AND m.stock <= lv.watch_at`);

    // Newly at Order now — from Watch, or straight from healthy (which also
    // counts as Watch announced, so one big drop sends one email).
    const orderNow = (await db.execute(sql`
      UPDATE materials m SET reorder_alerted_at = now(), watch_alerted_at = coalesce(m.watch_alerted_at, now())
      FROM ${levels}
      WHERE m.id = lv.id AND m.reorder_alerted_at IS NULL
        AND m.is_active AND m.deleted_at IS NULL
        AND m.stock <= lv.order_now_at
      ${RETURNING}`)).rows as Claimed[];
    // Newly at Watch, from healthy.
    const watch = (await db.execute(sql`
      UPDATE materials m SET watch_alerted_at = now()
      FROM ${levels}
      WHERE m.id = lv.id AND m.watch_alerted_at IS NULL
        AND m.is_active AND m.deleted_at IS NULL
        AND m.stock <= lv.watch_at AND m.stock > lv.order_now_at
      ${RETURNING}`)).rows as Claimed[];

    const result = { orderNow: orderNow.map((m) => m.title), watch: watch.map((m) => m.title) };
    if (!notify || (orderNow.length === 0 && watch.length === 0)) return result;

    const toItem = (m: Claimed, level: MaterialStockAlertItem["level"]): MaterialStockAlertItem => {
      const lv = byId.get(m.id)!;
      const stock = Number(m.stock);
      // Reasons from the stock the claim just saw, by the same rule.
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
    };
    const items = [...orderNow.map((m) => toItem(m, "order-now")), ...watch.map((m) => toItem(m, "watch"))]
      .sort((a, b) => (a.level === b.level ? (a.daysOfCover ?? 0) - (b.daysOfCover ?? 0) : a.level === "order-now" ? -1 : 1));
    const describe = (i: MaterialStockAlertItem) => {
      const parts = [
        i.daysOfCover === null ? "no recent use" : `${Math.floor(i.daysOfCover)} days left`,
        `${i.leadTimeDays}-day lead time`,
      ];
      if (i.orderNowReasons.includes("reorder-size") && i.orderSize > 0) {
        parts.push(`${Math.round((100 * i.stock) / i.orderSize)}% of reorder size`);
      }
      return `${i.title} (${parts.join(", ")})`;
    };
    const list = (level: MaterialStockAlertItem["level"]) => items
      .filter((i) => i.level === level)
      .map(describe)
      .join(", ");

    const admins = [...(await storage.getUsersByRole("admin")), ...(await storage.getUsersByRole("super_admin"))];
    const adminEmails = Array.from(new Set(admins.map((u) => u.email).filter((e): e is string => !!e)));

    try {
      if (adminEmails.length > 0) {
        await sendMaterialStockAlert({ adminEmails, items });
      }
      const sentNote = adminEmails.length ? `emailed ${adminEmails.length} admin(s)` : "no admin email on file";
      if (orderNow.length > 0) {
        console.log(`[INVENTORY] Order now: ${list("order-now")} — ${sentNote}`);
        void recordEvent({ severity: "info", kind: "inventory.order_now", message: `Order now: ${list("order-now")}`, detail: { materialIds: orderNow.map((m) => m.id), emailedTo: adminEmails.length } });
      }
      if (watch.length > 0) {
        console.log(`[INVENTORY] Watch: ${list("watch")} — ${sentNote}`);
        void recordEvent({ severity: "info", kind: "inventory.watch", message: `Watch: ${list("watch")}`, detail: { materialIds: watch.map((m) => m.id), emailedTo: adminEmails.length } });
      }
    } catch (emailError: any) {
      // Un-claim, so the next check tries again instead of this drop going
      // unannounced. (An Order now claim's Watch mark can stay: the retried
      // Order now email covers it.)
      const ids = (rows: Claimed[]) => sql.join(rows.map((m) => sql`${m.id}`), sql`, `);
      if (orderNow.length > 0) {
        await db.execute(sql`UPDATE materials SET reorder_alerted_at = NULL WHERE id IN (${ids(orderNow)})`).catch(() => {});
      }
      if (watch.length > 0) {
        await db.execute(sql`UPDATE materials SET watch_alerted_at = NULL WHERE id IN (${ids(watch)})`).catch(() => {});
      }
      const what = [list("order-now"), list("watch")].filter(Boolean).join("; ");
      console.error(`[INVENTORY] Stock alert email failed for ${what}: ${emailError?.message}`);
      void recordEvent({
        severity: "warn",
        kind: "inventory.stock_alert_email_failed",
        message: `Stock alert email failed for ${what} — will retry on the next check: ${emailError?.message ?? "unknown error"}`,
      });
    }
    return result;
  } catch (error: any) {
    console.error(`[INVENTORY] Stock alert check failed: ${error?.message}`);
    return { orderNow: [], watch: [] };
  }
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
