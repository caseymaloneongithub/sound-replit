import sanitizeHtml from 'sanitize-html';
import { db } from './db';
import { emailCampaigns, emailCampaignRecipients, marketingOptOuts } from '../shared/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { buildCampaignEmail, isMailConfigured, sendCampaignMail } from './email';

/**
 * Email campaigns (owner, 2026-09-11; hardened after review the same day).
 *
 * Everything that matters is in the database: the campaign, its body, and one
 * row per recipient with that recipient's delivery state. The runner walks the
 * PENDING rows and stamps each sent/failed as it goes, so a restart mid-send
 * resumes the remainder (resumeUnfinishedCampaigns, called at boot) instead of
 * abandoning it — and never re-sends a row already marked sent. Marketing
 * opt-outs are a separate persistent list enforced here, server-side, on every
 * campaign regardless of what the admin page ticked.
 */

export const MAX_CAMPAIGN_RECIPIENTS = 1000;

export type CampaignInput = {
  subject: string;
  audience: 'retail' | 'wholesale';
  bodyHtml: string;
  recipients: Array<{ email: string; name?: string }>;
  createdBy?: string | null;
};

export type CampaignStatus = {
  id: string;
  subject: string;
  audience: string;
  startedAt: string;
  completedAt: string | null;
  done: boolean;
  logOnly: boolean;
  total: number;
  sent: number;
  pending: number;
  skipped: number;
  failed: Array<{ email: string; error: string }>;
};

// Parser-based allowlist: structural tags survive (bold, bullets, headings,
// links), everything else is dropped, and attribute values are escaped by the
// library rather than rebuilt by hand.
export function sanitizeCampaignHtml(input: string): string {
  return sanitizeHtml(String(input ?? ''), {
    allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'blockquote'],
    allowedAttributes: { a: ['href'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
  }).trim();
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// ---- Opt-outs ----

export async function listOptOuts() {
  return db.select().from(marketingOptOuts).orderBy(desc(marketingOptOuts.createdAt));
}

export async function addOptOut(email: string, createdBy?: string | null, reason?: string | null) {
  const normalized = normalizeEmail(email);
  await db
    .insert(marketingOptOuts)
    .values({ email: normalized, createdBy: createdBy ?? null, reason: reason ?? null })
    .onConflictDoNothing();
  return normalized;
}

export async function removeOptOut(email: string) {
  await db.delete(marketingOptOuts).where(eq(marketingOptOuts.email, normalizeEmail(email)));
}

// ---- Campaigns ----

async function isCampaignRunning(): Promise<boolean> {
  const [row] = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, 'sending'))
    .limit(1);
  return !!row;
}

/** Validates, persists, and kicks off the background send. Throws a message
 *  suitable for a 400/409 on bad input. */
export async function startCampaign(input: CampaignInput): Promise<{ id: string; queued: number; skipped: number }> {
  if (await isCampaignRunning()) {
    throw Object.assign(new Error('A campaign is already sending — wait for it to finish.'), { status: 409 });
  }
  const subject = input.subject.trim().slice(0, 150);
  const bodyHtml = sanitizeCampaignHtml(input.bodyHtml);
  if (!subject) throw Object.assign(new Error('Subject is required'), { status: 400 });
  if (!bodyHtml.replace(/<[^>]+>/g, '').trim()) throw Object.assign(new Error('The email body is empty'), { status: 400 });
  if (input.recipients.length > MAX_CAMPAIGN_RECIPIENTS) {
    throw Object.assign(
      new Error(`Campaigns are capped at ${MAX_CAMPAIGN_RECIPIENTS} recipients — this one has ${input.recipients.length}. Split it into batches.`),
      { status: 400 },
    );
  }

  // Validate + dedupe, then apply the persistent opt-out list.
  const seen = new Set<string>();
  const cleaned: Array<{ email: string; name: string | null }> = [];
  for (const r of input.recipients) {
    const email = typeof r?.email === 'string' ? r.email.trim() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    const key = normalizeEmail(email);
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push({ email, name: typeof r?.name === 'string' ? r.name.slice(0, 120) : null });
  }
  if (cleaned.length === 0) throw Object.assign(new Error('No valid recipients selected'), { status: 400 });
  const optedOut = new Set((await listOptOuts()).map((o) => o.email));

  const [campaign] = await db
    .insert(emailCampaigns)
    .values({ subject, audience: input.audience, bodyHtml, createdBy: input.createdBy ?? null })
    .returning({ id: emailCampaigns.id });
  let skipped = 0;
  await db.insert(emailCampaignRecipients).values(
    cleaned.map((r) => {
      const isOut = optedOut.has(normalizeEmail(r.email));
      if (isOut) skipped++;
      return {
        campaignId: campaign.id,
        email: r.email,
        name: r.name,
        status: isOut ? 'skipped' : 'pending',
        error: isOut ? 'opted out' : null,
      };
    }),
  );

  console.log(`[CAMPAIGN] ${campaign.id} "${subject}" queued: ${cleaned.length - skipped} to send, ${skipped} opted out`);
  void runCampaign(campaign.id).catch((e) => console.error('[CAMPAIGN] run failed:', e));
  return { id: campaign.id, queued: cleaned.length - skipped, skipped };
}

/** Walks the campaign's pending rows. Safe to call again after a restart: rows
 *  already sent/failed/skipped are never touched. */
export async function runCampaign(campaignId: string): Promise<void> {
  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
  if (!campaign || campaign.status !== 'sending') return;
  const built = buildCampaignEmail(campaign.subject, campaign.bodyHtml);
  const live = isMailConfigured();

  for (;;) {
    const [next] = await db
      .select()
      .from(emailCampaignRecipients)
      .where(and(eq(emailCampaignRecipients.campaignId, campaignId), eq(emailCampaignRecipients.status, 'pending')))
      .limit(1);
    if (!next) break;
    try {
      await sendCampaignMail(next.email, campaign.subject, built);
      await db
        .update(emailCampaignRecipients)
        .set({ status: 'sent', sentAt: new Date() })
        .where(eq(emailCampaignRecipients.id, next.id));
      if (live) console.log(`[CAMPAIGN] sent to ${next.email}`);
    } catch (error: any) {
      console.error(`[CAMPAIGN] failed for ${next.email}: ${error?.message}`);
      await db
        .update(emailCampaignRecipients)
        .set({ status: 'failed', error: String(error?.message ?? 'send failed').slice(0, 200) })
        .where(eq(emailCampaignRecipients.id, next.id));
    }
    // Gentle pacing — provider rate limits, and a slow drip beats a bounce storm.
    if (live) await new Promise((resolve) => setTimeout(resolve, 300));
  }

  await db.update(emailCampaigns).set({ status: 'done', completedAt: new Date() }).where(eq(emailCampaigns.id, campaignId));
  console.log(`[CAMPAIGN] ${campaignId} done`);
}

/** Boot hook: any campaign still marked 'sending' was interrupted by a restart;
 *  finish its pending rows. */
export async function resumeUnfinishedCampaigns(): Promise<void> {
  const unfinished = await db.select({ id: emailCampaigns.id, subject: emailCampaigns.subject }).from(emailCampaigns).where(eq(emailCampaigns.status, 'sending'));
  for (const c of unfinished) {
    console.log(`[CAMPAIGN] resuming interrupted campaign ${c.id} "${c.subject}"`);
    void runCampaign(c.id).catch((e) => console.error('[CAMPAIGN] resume failed:', e));
  }
}

/** The most recent campaign with live counts — what the admin page polls. */
export async function getLatestCampaignStatus(): Promise<CampaignStatus | null> {
  const [campaign] = await db.select().from(emailCampaigns).orderBy(desc(emailCampaigns.createdAt)).limit(1);
  if (!campaign) return null;
  const counts = await db
    .select({ status: emailCampaignRecipients.status, n: sql<number>`count(*)::int` })
    .from(emailCampaignRecipients)
    .where(eq(emailCampaignRecipients.campaignId, campaign.id))
    .groupBy(emailCampaignRecipients.status);
  const byStatus: Record<string, number> = {};
  for (const c of counts) byStatus[c.status] = c.n;
  const failedRows = await db
    .select({ email: emailCampaignRecipients.email, error: emailCampaignRecipients.error })
    .from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.campaignId, campaign.id), eq(emailCampaignRecipients.status, 'failed')))
    .limit(50);
  return {
    id: campaign.id,
    subject: campaign.subject,
    audience: campaign.audience,
    startedAt: campaign.createdAt.toISOString(),
    completedAt: campaign.completedAt ? campaign.completedAt.toISOString() : null,
    done: campaign.status === 'done',
    logOnly: !isMailConfigured(),
    total: Object.values(byStatus).reduce((a, b) => a + b, 0),
    sent: byStatus.sent ?? 0,
    pending: byStatus.pending ?? 0,
    skipped: byStatus.skipped ?? 0,
    failed: failedRows.map((r) => ({ email: r.email, error: r.error ?? 'send failed' })),
  };
}
