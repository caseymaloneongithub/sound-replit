/**
 * Overdue wholesale invoice reminders (owner, 2026-10-07: "due today, 7 days
 * overdue, 2 weeks, 3 weeks, ..." — then every week until it's paid).
 *
 * One email per stage per invoice, checked once a day. Each invoice remembers
 * the stage of its last reminder, so a day the job missed (server down) sends
 * only the latest stage due, never the ones in between, and a restart can't
 * send a stage twice. Accounts can switch reminders off (payment_reminders).
 */
import cron from "node-cron";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { wholesaleOrders } from "@shared/schema";
import { PICKUP_POLICY } from "@shared/pickup-policy";
import { breweryToday } from "@shared/material-health";
import { sendInvoiceReminderEmail, overdueWording } from "./email";
import { wholesaleOrderRecipients } from "./wholesale-recipients";
import { wholesalePayLink } from "./wholesale-pay-link";
import { recordEvent } from "./ops-events";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The reminder an invoice this many days overdue is on: due today (0), then
 *  a week (7), two (14), three (21) and every week after. Null before it's due. */
export function reminderStageFor(daysOverdue: number): number | null {
  if (daysOverdue < 0) return null;
  return daysOverdue < 7 ? 0 : 7 * Math.floor(daysOverdue / 7);
}

const utcDay = (date: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));

/** Whole brewery-calendar days from the due date to `today` ("YYYY-MM-DD"). */
export function daysOverdueOn(dueDate: Date, today: string): number {
  return Math.round((utcDay(today) - utcDay(breweryToday(dueDate))) / DAY_MS);
}

export async function sendInvoiceReminders(now: Date = new Date()): Promise<{ sent: string[]; skipped: number }> {
  const today = breweryToday(now);
  const { orders } = await storage.getWholesaleOrders();
  const sent: string[] = [];
  let skipped = 0;

  for (const order of orders) {
    // Only an invoice that was emailed, is unpaid and has a due date can be overdue;
    // a bank debit already on its way needs no nudge.
    if (!order.dueDate || !order.invoiceSentAt || order.paidAt || order.status === 'cancelled') continue;
    if (order.paymentInitiatedAt && !order.paymentFailedAt) continue;
    const dueDate = new Date(order.dueDate);
    const days = daysOverdueOn(dueDate, today);
    const stage = reminderStageFor(days);
    if (stage === null) continue;
    // The last stage counts only against the due date it was sent for: a new due
    // date starts the schedule over (review, 2026-10-07).
    const sameDueDate = order.paymentReminderDueDate != null && new Date(order.paymentReminderDueDate).getTime() === dueDate.getTime();
    const lastStage = sameDueDate ? (order.paymentReminderStage ?? -1) : -1;
    if (lastStage >= stage) continue;

    try {
      const customer = await storage.getWholesaleCustomer(order.customerId);
      if (!customer || customer.paymentReminders === false) {
        skipped++;
        continue;
      }
      const recipients = await wholesaleOrderRecipients(customer.id, order.locationId, order.contactEmail, order.contactEmailChosen);
      if (recipients.to.length === 0) {
        console.warn(`[INVOICE REMINDERS] ${order.invoiceNumber}: no address to send to (${recipients.label})`);
        skipped++;
        continue;
      }
      const canPayOnline = customer.allowOnlinePayment !== false || customer.allowCardPayment !== false;
      // The stage is for not repeating; the customer reads the real count — a
      // first run that was late says "3 days overdue", never "due today".
      await sendInvoiceReminderEmail({
        to: recipients.to,
        businessName: customer.businessName,
        invoiceNumber: order.invoiceNumber,
        amount: Number(order.totalAmount),
        dueDate,
        daysOverdue: days,
        paymentUrl: canPayOnline ? wholesalePayLink(order.id) : null,
      });
      await db
        .update(wholesaleOrders)
        .set({ paymentReminderStage: stage, paymentReminderAt: now, paymentReminderDueDate: dueDate })
        .where(eq(wholesaleOrders.id, order.id));
      sent.push(`${order.invoiceNumber} (${overdueWording(days)})`);
    } catch (error) {
      console.error(`[INVOICE REMINDERS] ${order.invoiceNumber} failed:`, error);
    }
  }

  if (sent.length) {
    void recordEvent({ severity: 'info', kind: 'invoice.reminders', message: `Invoice reminders sent: ${sent.join(', ')}` });
  }
  console.log(`[INVOICE REMINDERS] ${today}: ${sent.length} sent, ${skipped} skipped`);
  return { sent, skipped };
}

/** Daily at 9:30 AM Pacific — after the morning digest, on the brewery's clock. */
export function startInvoiceReminderCron() {
  console.log('[INVOICE REMINDERS] Scheduling daily check for 9:30 AM Pacific');
  cron.schedule('30 9 * * *', async () => {
    try {
      await sendInvoiceReminders();
    } catch (error) {
      console.error('[INVOICE REMINDERS] run failed:', error);
    }
  }, { timezone: PICKUP_POLICY.timezone });
}
