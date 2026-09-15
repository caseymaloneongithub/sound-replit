/**
 * Operational events (owner, 2026-09-15: "events table and digest, super admin
 * consumption only").
 *
 * recordEvent() is called at the points that used to be a lone console line:
 * spam drops, receipts with nowhere to go, campaigns that gave up, refunds left
 * pending, webhook failures, billing runs. It never throws — an event write
 * failing must not break the thing it describes. 'alert' events are emailed to
 * super admins immediately; everything from the last day goes out in a digest
 * each morning. Reading the events is a super-admin page, nothing else.
 */
import cron from "node-cron";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import { opsEvents } from "@shared/schema";
import { storage } from "./storage";
import { PICKUP_POLICY } from "@shared/pickup-policy";

export type OpsSeverity = "info" | "warn" | "alert";

export type OpsEventInput = {
  severity: OpsSeverity;
  kind: string;
  message: string;
  detail?: Record<string, unknown>;
  ref?: { type: string; id: string };
};

const APP_URL = (process.env.APP_URL || "https://soundkombucha.com").replace(/\/+$/, "");

async function superAdminEmails(): Promise<string[]> {
  const admins = await storage.getUsersByRole("super_admin");
  return admins.map((u) => u.email).filter((e): e is string => !!e);
}

/** Record an event. Alerts are also emailed at once. Never throws. */
export async function recordEvent(input: OpsEventInput): Promise<void> {
  try {
    const [row] = await db
      .insert(opsEvents)
      .values({
        severity: input.severity,
        kind: input.kind,
        message: input.message.slice(0, 2000),
        detail: input.detail ?? null,
        refType: input.ref?.type ?? null,
        refId: input.ref?.id ?? null,
      })
      .returning();
    if (input.severity === "alert") {
      void sendAlertEmail(row.id, input).catch((e) => console.error("[OPS] alert email failed:", e?.message));
    }
  } catch (e: any) {
    console.error(`[OPS] could not record event ${input.kind}: ${e?.message}`);
  }
}

async function sendAlertEmail(id: string, input: OpsEventInput): Promise<void> {
  const to = await superAdminEmails();
  if (to.length === 0) return;
  const { sendOpsEmail } = await import("./email");
  const detail = input.detail ? JSON.stringify(input.detail, null, 2) : "";
  await sendOpsEmail({
    to,
    subject: `[Alert] ${input.message.slice(0, 120)}`,
    heading: "Needs a look",
    lines: [
      `<strong>${escapeHtml(input.message)}</strong>`,
      `Kind: ${escapeHtml(input.kind)}`,
      detail ? `<pre style="white-space:pre-wrap;font-size:12px;background:#f5f5f5;padding:12px;border-radius:4px;">${escapeHtml(detail)}</pre>` : "",
      `<a href="${APP_URL}/admin/ops-events">Open the events page</a>`,
    ].filter(Boolean),
    text: `${input.message}\nKind: ${input.kind}\n${detail}\n\n${APP_URL}/admin/ops-events`,
  });
}

export async function listEvents(opts: { since?: Date; severity?: OpsSeverity; openOnly?: boolean; limit?: number }) {
  const conds = [];
  if (opts.since) conds.push(gte(opsEvents.createdAt, opts.since));
  if (opts.severity) conds.push(eq(opsEvents.severity, opts.severity));
  if (opts.openOnly) conds.push(isNull(opsEvents.acknowledgedAt));
  return db
    .select()
    .from(opsEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(opsEvents.createdAt))
    .limit(Math.min(500, opts.limit ?? 200));
}

export async function acknowledgeEvent(id: string, userId: string): Promise<boolean> {
  const [row] = await db
    .update(opsEvents)
    .set({ acknowledgedAt: new Date(), acknowledgedByUserId: userId })
    .where(and(eq(opsEvents.id, id), isNull(opsEvents.acknowledgedAt)))
    .returning({ id: opsEvents.id });
  return !!row;
}

/** The last 24 hours, grouped by kind, as a super admin would want to read it. */
export async function buildDigest(now = new Date()): Promise<{ subject: string; lines: string[]; text: string; total: number }> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await listEvents({ since, limit: 500 });
  const [{ openAlerts }] = await db
    .select({ openAlerts: sql<number>`count(*)::int` })
    .from(opsEvents)
    .where(and(eq(opsEvents.severity, "alert"), isNull(opsEvents.acknowledgedAt)));

  const byKind = new Map<string, typeof rows>();
  for (const r of rows) byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r]);
  const order = { alert: 0, warn: 1, info: 2 } as Record<string, number>;
  const kinds = Array.from(byKind.entries()).sort((a, b) => {
    const sa = Math.min(...a[1].map((r) => order[r.severity] ?? 9));
    const sb = Math.min(...b[1].map((r) => order[r.severity] ?? 9));
    return sa - sb || b[1].length - a[1].length;
  });

  const lines: string[] = [];
  const textLines: string[] = [];
  if (openAlerts > 0) {
    lines.push(`<strong style="color:#b45309;">${openAlerts} alert${openAlerts === 1 ? "" : "s"} still open</strong> — acknowledge them on the events page once handled.`);
    textLines.push(`${openAlerts} alert(s) still open.`);
  }
  for (const [kind, list] of kinds) {
    const worst = list.reduce((w, r) => (order[r.severity] < order[w] ? r.severity : w), "info" as string);
    const tag = worst === "alert" ? "ALERT" : worst === "warn" ? "warn" : "info";
    lines.push(`<p style="margin:12px 0 4px;"><strong>${escapeHtml(kind)}</strong> — ${list.length} <span style="color:#6b7280;">(${tag})</span></p><ul style="margin:0;padding-left:18px;">${list.slice(0, 8).map((r) => `<li>${escapeHtml(r.message)}</li>`).join("")}${list.length > 8 ? `<li>… and ${list.length - 8} more</li>` : ""}</ul>`);
    textLines.push(`${kind} — ${list.length} (${tag})`, ...list.slice(0, 8).map((r) => `  - ${r.message}`), ...(list.length > 8 ? [`  … and ${list.length - 8} more`] : []));
  }
  if (rows.length === 0) {
    lines.push("A quiet day: nothing recorded in the last 24 hours.");
    textLines.push("A quiet day: nothing recorded in the last 24 hours.");
  }
  lines.push(`<a href="${APP_URL}/admin/ops-events">Open the events page</a>`);
  textLines.push("", `${APP_URL}/admin/ops-events`);
  const day = now.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: PICKUP_POLICY.timezone });
  return { subject: `Site digest — ${day}: ${rows.length} event${rows.length === 1 ? "" : "s"}${openAlerts ? `, ${openAlerts} open alert${openAlerts === 1 ? "" : "s"}` : ""}`, lines, text: textLines.join("\n"), total: rows.length };
}

export async function sendDailyDigest(): Promise<void> {
  const to = await superAdminEmails();
  if (to.length === 0) return;
  const digest = await buildDigest();
  const { sendOpsEmail } = await import("./email");
  await sendOpsEmail({ to, subject: digest.subject, heading: "Yesterday on the site", lines: digest.lines, text: digest.text });
  console.log(`[OPS] digest sent to ${to.length} super admin(s): ${digest.total} events`);
}

/** 7:00 AM Pacific, every day. Gated by DISABLE_CRON in index.ts like the rest. */
export function startOpsDigestCron(): void {
  cron.schedule("0 7 * * *", () => {
    sendDailyDigest().catch((e) => console.error("[OPS] digest failed:", e?.message));
  }, { timezone: PICKUP_POLICY.timezone });
  console.log("[OPS] daily digest scheduled for 7:00 AM Pacific");
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
