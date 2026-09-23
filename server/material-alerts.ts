/**
 * Stock emails for raw materials (owner, 2026-09-23: "notify the admins by email
 * when an item goes to reorder status" … "let's have the email alert when moved
 * to watch as well").
 *
 * Levels come from shared/material-health.ts: Watch at 50% or less of the
 * material's reorder size, Reorder at 25% or less. Admins are emailed on the way
 * DOWN, once per level per dip:
 *
 *   healthy → watch      one Watch email
 *   watch   → reorder    one Reorder email
 *   healthy → reorder    one Reorder email (a single big drop isn't two emails)
 *   reorder → watch      no email; Reorder re-arms for the next drop
 *   anything → healthy   no email; both re-arm
 *
 * materials.watch_alerted_at / reorder_alerted_at record what has been sent.
 *
 * checkMaterialStockAlerts() runs after anything that changes a material's stock,
 * reorder size or active state. It looks at every material (the table is small,
 * and purchase-order routes don't know which materials a delivery touched). Each
 * step is one UPDATE with the rule on the row itself, so two checks running at
 * once can't announce the same drop twice. It never throws: a failed email must
 * not fail the stock change that triggered it.
 */
import { sql, type SQL } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { recordEvent } from "./ops-events";
import { sendMaterialStockAlert, type MaterialStockAlertItem } from "./email";
import { MATERIAL_REORDER_RATIO, MATERIAL_WATCH_RATIO } from "@shared/material-health";

/** Active, not deleted, has a reorder size, and stock at or below `ratio` of it. */
const atOrBelow = (ratio: number): SQL =>
  sql`(is_active AND deleted_at IS NULL AND order_size > 0 AND stock <= order_size * ${ratio}::numeric)`;
const AT_WATCH = atOrBelow(MATERIAL_WATCH_RATIO); // Watch or worse
const AT_REORDER = atOrBelow(MATERIAL_REORDER_RATIO);

type Claimed = { id: string; title: string; unit: string; stock: string; orderSize: string; supplierName: string | null };
const RETURNING = sql`RETURNING id, title, unit, stock, order_size AS "orderSize",
  (SELECT s.name FROM suppliers s WHERE s.id = materials.supplier_id) AS "supplierName"`;

export async function checkMaterialStockAlerts(): Promise<void> {
  try {
    // Back above Watch (restocked, counted up, reorder size lowered, switched
    // off, deleted): both levels re-arm.
    await db.execute(sql`
      UPDATE materials SET watch_alerted_at = NULL, reorder_alerted_at = NULL
      WHERE (watch_alerted_at IS NOT NULL OR reorder_alerted_at IS NOT NULL) AND NOT ${AT_WATCH}`);
    // Back above Reorder but still in Watch: Reorder re-arms; climbing into Watch
    // from below isn't news, so no email.
    await db.execute(sql`
      UPDATE materials SET reorder_alerted_at = NULL
      WHERE reorder_alerted_at IS NOT NULL AND ${AT_WATCH} AND NOT ${AT_REORDER}`);

    // Newly at Reorder — from Watch, or straight from healthy (which also counts
    // as Watch announced, so one big drop sends one email).
    const reorder = (await db.execute(sql`
      UPDATE materials SET reorder_alerted_at = now(), watch_alerted_at = coalesce(watch_alerted_at, now())
      WHERE reorder_alerted_at IS NULL AND ${AT_REORDER}
      ${RETURNING}`)).rows as Claimed[];
    // Newly at Watch, from healthy.
    const watch = (await db.execute(sql`
      UPDATE materials SET watch_alerted_at = now()
      WHERE watch_alerted_at IS NULL AND ${AT_WATCH} AND NOT ${AT_REORDER}
      ${RETURNING}`)).rows as Claimed[];
    if (reorder.length === 0 && watch.length === 0) return;

    const toItem = (m: Claimed, level: MaterialStockAlertItem["level"]): MaterialStockAlertItem => ({
      level, title: m.title, unit: m.unit, stock: Number(m.stock), orderSize: Number(m.orderSize), supplierName: m.supplierName,
    });
    const items = [...reorder.map((m) => toItem(m, "reorder")), ...watch.map((m) => toItem(m, "watch"))]
      .sort((a, b) => (a.level === b.level ? a.stock / a.orderSize - b.stock / b.orderSize : a.level === "reorder" ? -1 : 1));
    const list = (level: MaterialStockAlertItem["level"]) => items
      .filter((i) => i.level === level)
      .map((i) => `${i.title} (${Math.round((100 * i.stock) / i.orderSize)}%)`)
      .join(", ");

    const admins = [...(await storage.getUsersByRole("admin")), ...(await storage.getUsersByRole("super_admin"))];
    const adminEmails = Array.from(new Set(admins.map((u) => u.email).filter((e): e is string => !!e)));

    try {
      if (adminEmails.length > 0) {
        await sendMaterialStockAlert({ adminEmails, items });
      }
      const sentNote = adminEmails.length ? `emailed ${adminEmails.length} admin(s)` : "no admin email on file";
      if (reorder.length > 0) {
        console.log(`[INVENTORY] Reorder level reached: ${list("reorder")} — ${sentNote}`);
        void recordEvent({ severity: "info", kind: "inventory.reorder", message: `Reorder level reached: ${list("reorder")}`, detail: { materialIds: reorder.map((m) => m.id), emailedTo: adminEmails.length } });
      }
      if (watch.length > 0) {
        console.log(`[INVENTORY] Watch level reached: ${list("watch")} — ${sentNote}`);
        void recordEvent({ severity: "info", kind: "inventory.watch", message: `Watch level reached: ${list("watch")}`, detail: { materialIds: watch.map((m) => m.id), emailedTo: adminEmails.length } });
      }
    } catch (emailError: any) {
      // Un-claim, so the next stock change tries again instead of this drop going
      // unannounced. (A Reorder claim's Watch mark can stay: the retried Reorder
      // email covers it.)
      const ids = (rows: Claimed[]) => sql.join(rows.map((m) => sql`${m.id}`), sql`, `);
      if (reorder.length > 0) {
        await db.execute(sql`UPDATE materials SET reorder_alerted_at = NULL WHERE id IN (${ids(reorder)})`).catch(() => {});
      }
      if (watch.length > 0) {
        await db.execute(sql`UPDATE materials SET watch_alerted_at = NULL WHERE id IN (${ids(watch)})`).catch(() => {});
      }
      const what = [list("reorder"), list("watch")].filter(Boolean).join("; ");
      console.error(`[INVENTORY] Stock alert email failed for ${what}: ${emailError?.message}`);
      void recordEvent({
        severity: "warn",
        kind: "inventory.stock_alert_email_failed",
        message: `Stock alert email failed for ${what} — will retry on the next stock change: ${emailError?.message ?? "unknown error"}`,
      });
    }
  } catch (error: any) {
    console.error(`[INVENTORY] Stock alert check failed: ${error?.message}`);
  }
}
