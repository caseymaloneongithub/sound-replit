import sanitizeHtml from 'sanitize-html';
import { db } from './db';
import { emailCampaigns, emailCampaignRecipients, marketingOptOuts } from '../shared/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildCampaignEmail, isMailConfigured, sendCampaignMail } from './email';

/**
 * Email campaigns (owner, 2026-09-11; hardened across two review rounds).
 *
 * Everything that matters is in the database: the campaign, its body, and one
 * row per recipient with that recipient's delivery state. Delivery is a state
 * machine per row — pending -> (claimed) sending -> sent | failed — where the
 * claim is an atomic UPDATE ... FOR UPDATE SKIP LOCKED, so two workers can never
 * take the same row. A row still 'sending' when a worker died is UNCERTAIN: the
 * mail may or may not have gone out, and it is never re-sent automatically (a
 * duplicate marketing email is worse than one missed). Only one campaign may be
 * 'sending' at a time, enforced by a partial unique index — not a check that two
 * concurrent requests could both pass. Marketing opt-outs are a separate
 * persistent list enforced here on every campaign, per address.
 */

export const MAX_CAMPAIGN_RECIPIENTS = 1000;
const FAILED_SAMPLE = 50;

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
  uncertain: number;
  failedCount: number;
  /** First FAILED_SAMPLE failures with their errors — the count above is the truth. */
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

const isUniqueViolation = (e: any) =>
  e?.code === '23505' || e?.cause?.code === '23505' || /email_campaigns_one_sending_idx/.test(String(e?.message ?? ''));

/** Validates, persists (one transaction), and kicks off the background send.
 *  Throws with .status for 400/409 on bad input or a campaign already running. */
export async function startCampaign(input: CampaignInput): Promise<{ id: string; queued: number; skipped: number }> {
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

  // Validate + dedupe, then apply the persistent opt-out list per address.
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
  const rows = cleaned.map((r) => {
    const isOut = optedOut.has(normalizeEmail(r.email));
    return { email: r.email, name: r.name, status: isOut ? 'skipped' : 'pending', error: isOut ? 'opted out' : null };
  });
  const skipped = rows.filter((r) => r.status === 'skipped').length;

  // Campaign + recipients land together or not at all; the partial unique index
  // on status='sending' turns a concurrent second campaign into 23505 -> 409.
  let campaignId: string;
  try {
    campaignId = await db.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(emailCampaigns)
        .values({ subject, audience: input.audience, bodyHtml, createdBy: input.createdBy ?? null })
        .returning({ id: emailCampaigns.id });
      await tx.insert(emailCampaignRecipients).values(rows.map((r) => ({ ...r, campaignId: campaign.id })));
      return campaign.id;
    });
  } catch (e: any) {
    if (isUniqueViolation(e)) {
      throw Object.assign(new Error('A campaign is already sending — wait for it to finish.'), { status: 409 });
    }
    throw e;
  }

  console.log(`[CAMPAIGN] ${campaignId} "${subject}" queued: ${rows.length - skipped} to send, ${skipped} opted out`);
  void runCampaign(campaignId).catch((e) => console.error('[CAMPAIGN] run failed:', e));
  return { id: campaignId, queued: rows.length - skipped, skipped };
}

/** Atomically claims one pending row for this worker, or null when none remain.
 *  SKIP LOCKED means overlapping workers never hand out the same row twice. */
async function claimNext(campaignId: string): Promise<{ id: string; email: string } | null> {
  const result = await db.execute(sql`
    UPDATE email_campaign_recipients SET status = 'sending', claimed_at = now()
    WHERE id = (
      SELECT id FROM email_campaign_recipients
      WHERE campaign_id = ${campaignId} AND status = 'pending'
      ORDER BY id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, email`);
  const row = (result as any).rows?.[0];
  return row ? { id: String(row.id), email: String(row.email) } : null;
}

/** Walks the campaign's pending rows, claiming each before sending. Safe to call
 *  again after a restart: sent/failed/skipped/uncertain rows are never touched. */
export async function runCampaign(campaignId: string): Promise<void> {
  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
  if (!campaign || campaign.status !== 'sending') return;
  const built = buildCampaignEmail(campaign.subject, campaign.bodyHtml);
  const live = isMailConfigured();

  for (;;) {
    const next = await claimNext(campaignId);
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

  // Finish only when nothing is left in flight — another worker may still hold
  // a claim, and a dead worker's claim is resolved to 'uncertain' at boot.
  const [{ inFlight }] = await db
    .select({ inFlight: sql<number>`count(*)::int` })
    .from(emailCampaignRecipients)
    .where(and(eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ['pending', 'sending'])));
  if (inFlight === 0) {
    await db.update(emailCampaigns).set({ status: 'done', completedAt: new Date() }).where(eq(emailCampaigns.id, campaignId));
    console.log(`[CAMPAIGN] ${campaignId} done`);
  }
}

/** Boot hook: any campaign still 'sending' was interrupted by a restart. Rows a
 *  dead worker had claimed become 'uncertain' (delivery unknown — NOT re-sent);
 *  the remaining pending rows are finished. */
export async function resumeUnfinishedCampaigns(): Promise<void> {
  const unfinished = await db
    .select({ id: emailCampaigns.id, subject: emailCampaigns.subject })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, 'sending'));
  for (const c of unfinished) {
    const orphaned = await db
      .update(emailCampaignRecipients)
      .set({ status: 'uncertain', error: 'interrupted mid-send — delivery unknown, not retried' })
      .where(and(eq(emailCampaignRecipients.campaignId, c.id), eq(emailCampaignRecipients.status, 'sending')))
      .returning({ email: emailCampaignRecipients.email });
    console.log(`[CAMPAIGN] resuming interrupted campaign ${c.id} "${c.subject}"${orphaned.length ? ` — ${orphaned.length} row(s) marked uncertain: ${orphaned.map((o) => o.email).join(', ')}` : ''}`);
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
    .limit(FAILED_SAMPLE);
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
    pending: (byStatus.pending ?? 0) + (byStatus.sending ?? 0),
    skipped: byStatus.skipped ?? 0,
    uncertain: byStatus.uncertain ?? 0,
    failedCount: byStatus.failed ?? 0,
    failed: failedRows.map((r) => ({ email: r.email, error: r.error ?? 'send failed' })),
  };
}
