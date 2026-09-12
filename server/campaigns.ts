import sanitizeHtml from 'sanitize-html';
import { createHmac, timingSafeEqual } from 'crypto';
import { db } from './db';
import { emailCampaigns, emailCampaignRecipients, marketingOptOuts } from '../shared/schema';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { buildCampaignEmail, isMailConfigured, isMailIdempotent, sendCampaignMail } from './email';

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

// ---- Unsubscribe links (RFC 8058 one-click) ----
// Each recipient gets a link carrying their address and an HMAC over it, so the
// link works with no login and can't be forged for someone else. Signed with
// the session secret — no new config to set.

const unsubscribeSecret = () => process.env.UNSUBSCRIBE_SECRET || process.env.SESSION_SECRET || 'dev-unsubscribe-secret';
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
const sign = (email: string) => createHmac('sha256', unsubscribeSecret()).update(normalizeEmail(email)).digest('base64url');

export function makeUnsubscribeToken(email: string): string {
  return `${b64url(normalizeEmail(email))}.${sign(email)}`;
}

/** Returns the address the token was issued for, or null if it doesn't verify. */
export function verifyUnsubscribeToken(token: string): string | null {
  const [payload, mac] = String(token ?? '').split('.');
  if (!payload || !mac) return null;
  let email: string;
  try { email = Buffer.from(payload, 'base64url').toString('utf8'); } catch { return null; }
  const expected = sign(email);
  const a = Buffer.from(mac); const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return normalizeEmail(email);
}

export const baseUrl = () => (process.env.APP_URL || 'http://localhost:5000').replace(/\/+$/, '');
export const unsubscribeUrlFor = (email: string) => `${baseUrl()}/unsubscribe?token=${encodeURIComponent(makeUnsubscribeToken(email))}`;

// ---- Provider events (Resend webhook) ----

/** Verifies a Svix-signed Resend webhook (headers svix-id / svix-timestamp /
 *  svix-signature over "id.timestamp.rawBody"). Returns the parsed event or
 *  null when the signature doesn't check out. */
export function verifyResendWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): any | null {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return null;
  const id = headers['svix-id']; const ts = headers['svix-timestamp']; const sigHeader = headers['svix-signature'];
  if (!id || !ts || !sigHeader) return null;
  // Reject stale deliveries (replay window: 5 minutes).
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return null;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${id}.${ts}.`).update(rawBody).digest('base64');
  const ok = sigHeader.split(' ').some((part) => {
    const [, sig] = part.split(',');
    if (!sig) return false;
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!ok) return null;
  try { return JSON.parse(rawBody.toString('utf8')); } catch { return null; }
}

/** Hard bounces and spam complaints opt the address out automatically — emailing
 *  either again is what sinks a sender's reputation. Soft bounces are left alone. */
export async function handleResendEvent(event: any): Promise<{ optedOut: string[] }> {
  const type = String(event?.type ?? '');
  const to: string[] = Array.isArray(event?.data?.to) ? event.data.to : [];
  const optedOut: string[] = [];
  const bounceType = String(event?.data?.bounce?.type ?? '').toLowerCase();
  // Allow-list, not "anything but transient": Resend classifies bounces as
  // Permanent / Transient / Undetermined, and only a PERMANENT one means the
  // address is dead. A full mailbox or an undetermined failure must not
  // silently unsubscribe a customer.
  const hardBounce = type === 'email.bounced' && bounceType === 'permanent';
  if (hardBounce || type === 'email.complained') {
    const reason = type === 'email.complained' ? 'spam complaint (provider webhook)' : 'hard bounce (provider webhook)';
    for (const addr of to) {
      if (typeof addr !== 'string' || !addr.includes('@')) continue;
      await addOptOut(addr, null, reason);
      optedOut.push(normalizeEmail(addr));
    }
  }
  return { optedOut };
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

// Resend honors an idempotency key for 24 hours; stay inside that with margin.
// (Declared up here because claimNext enforces it too.)
const IDEMPOTENCY_WINDOW_SECS = 23 * 60 * 60;

/** A pending row that was attempted before (first_claimed_at set) is a RETRY,
 *  and a retry is only safe while the provider's duplicate protection for the
 *  original attempt is alive. A retry that sat pending through downtime past
 *  that window is retired to 'uncertain' rather than delivered late. */
async function expireStaleRetries(campaignId: string): Promise<string[]> {
  const rows = await db
    .update(emailCampaignRecipients)
    .set({ status: 'uncertain', error: 'retry window expired — delivery of the first attempt unknown, not retried' })
    .where(and(
      eq(emailCampaignRecipients.campaignId, campaignId),
      eq(emailCampaignRecipients.status, 'pending'),
      sql`${emailCampaignRecipients.firstClaimedAt} IS NOT NULL AND ${emailCampaignRecipients.firstClaimedAt} <= now() - make_interval(secs => ${IDEMPOTENCY_WINDOW_SECS})`,
    ))
    .returning({ email: emailCampaignRecipients.email });
  if (rows.length) console.log(`[CAMPAIGN] ${campaignId}: ${rows.length} stale retry(ies) marked uncertain: ${rows.map((r) => r.email).join(', ')}`);
  return rows.map((r) => r.email);
}

/** Atomically claims one pending row for this worker, or null when none remain.
 *  SKIP LOCKED means overlapping workers never hand out the same row twice, and
 *  the deadline sits INSIDE the claim predicate so a retry can't slip through
 *  between an expiry sweep and the claim. */
export async function claimNext(campaignId: string): Promise<{ id: string; email: string; claimedAt: string } | null> {
  // claimed_at comes back as TEXT so it can be handed back to Postgres verbatim
  // for an equality guard (a JS Date round-trip loses precision/zone).
  const result = await db.execute(sql`
    UPDATE email_campaign_recipients
    SET status = 'sending', claimed_at = now(), first_claimed_at = COALESCE(first_claimed_at, now())
    WHERE id = (
      SELECT id FROM email_campaign_recipients
      WHERE campaign_id = ${campaignId} AND status = 'pending'
        AND (first_claimed_at IS NULL OR first_claimed_at > now() - make_interval(secs => ${IDEMPOTENCY_WINDOW_SECS}))
      ORDER BY id
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, email, claimed_at::text AS claimed_at`);
  const row = (result as any).rows?.[0];
  return row ? { id: String(row.id), email: String(row.email), claimedAt: String(row.claimed_at) } : null;
}

/** Records a provider failure — but only on THIS worker's live claim. If the
 *  lease expired mid-call and a peer reclaimed, resent, and recorded 'sent'
 *  (the provider deduped it), a late error here must not clobber that. */
export async function markFailed(rowId: string, claimedAt: string, message: string): Promise<void> {
  await db
    .update(emailCampaignRecipients)
    .set({ status: 'failed', error: message.slice(0, 200) })
    .where(and(
      eq(emailCampaignRecipients.id, rowId),
      eq(emailCampaignRecipients.status, 'sending'),
      sql`${emailCampaignRecipients.claimedAt} = ${claimedAt}::timestamp`,
    ));
}

// A claim is a LEASE: a live worker finishes one send in seconds, so a claim
// older than this belongs to a worker that died (or a deploy that was killed).
// Younger claims are someone else's active work — overlapping deployments run
// two workers for a while — and must be left alone.
const CLAIM_LEASE_MS = 5 * 60 * 1000;
const IDEMPOTENCY_WINDOW_MS = IDEMPOTENCY_WINDOW_SECS * 1000;
// How long a worker with nothing to claim waits for other workers' leases.
const SETTLE_POLL_MS = 15 * 1000;

/** Resolves claims whose lease has EXPIRED: back to 'pending' when the provider
 *  dedupes by idempotency key and the FIRST claim is inside the key's lifetime
 *  (a retry then can't deliver twice), otherwise 'uncertain' (delivery unknown —
 *  NOT re-sent). Live leases are untouched.
 *
 *  Each branch is ONE conditional UPDATE whose predicate re-checks "still
 *  'sending' and still expired" at write time — no read-then-write gap for a
 *  worker recording 'sent' to fall into. Every time comparison is done in SQL
 *  (a JS Date parameter reaches the naive timestamp column with a local offset
 *  the column ignores). Returns what it changed. */
export async function settleExpiredClaims(campaignId: string): Promise<{ retried: string[]; uncertain: string[] }> {
  // Parenthesized: inside the AND chain an unwrapped OR would bind loosest and
  // match every old claim in the TABLE, other campaigns included.
  const expiredLease = sql`(${emailCampaignRecipients.claimedAt} IS NULL OR ${emailCampaignRecipients.claimedAt} < now() - make_interval(secs => ${CLAIM_LEASE_MS / 1000}))`;
  const retried: string[] = [];
  if (isMailIdempotent()) {
    const rows = await db
      .update(emailCampaignRecipients)
      .set({ status: 'pending', claimedAt: null })
      .where(and(
        eq(emailCampaignRecipients.campaignId, campaignId),
        eq(emailCampaignRecipients.status, 'sending'),
        expiredLease,
        // The window is anchored to the FIRST attempt — the lease refreshes on
        // every retry and must not extend the provider's 24h protection.
        sql`${emailCampaignRecipients.firstClaimedAt} IS NOT NULL AND ${emailCampaignRecipients.firstClaimedAt} > now() - make_interval(secs => ${IDEMPOTENCY_WINDOW_MS / 1000})`,
      ))
      .returning({ email: emailCampaignRecipients.email });
    retried.push(...rows.map((r) => r.email));
  }
  const uncertainRows = await db
    .update(emailCampaignRecipients)
    .set({ status: 'uncertain', error: 'interrupted mid-send — delivery unknown, not retried' })
    .where(and(
      eq(emailCampaignRecipients.campaignId, campaignId),
      eq(emailCampaignRecipients.status, 'sending'),
      expiredLease,
    ))
    .returning({ email: emailCampaignRecipients.email });
  const uncertain = uncertainRows.map((r) => r.email);
  if (retried.length || uncertain.length) {
    console.log(`[CAMPAIGN] ${campaignId}: expired claims —` +
      (retried.length ? ` ${retried.length} queued for idempotent retry` : '') +
      (uncertain.length ? ` ${uncertain.length} marked uncertain: ${uncertain.join(', ')}` : ''));
  }
  return { retried, uncertain };
}

/** Records a delivery the provider ACCEPTED. Delivery is already a fact, so a
 *  database hiccup here must never turn into 'failed' (that would invite a
 *  resend): retry the write, and if it still won't land, leave the row on its
 *  lease — the settle logic resolves it conservatively later. */
async function markSent(rowId: string, email: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await db.update(emailCampaignRecipients).set({ status: 'sent', sentAt: new Date() }).where(eq(emailCampaignRecipients.id, rowId));
      return;
    } catch (error: any) {
      console.error(`[CAMPAIGN] delivered to ${email} but could not record 'sent' (attempt ${attempt}): ${error?.message}`);
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  console.error(`[CAMPAIGN] delivered to ${email}; 'sent' NOT recorded after 3 attempts — row left on its lease`);
}

/** Walks the campaign's pending rows, claiming each before sending. Safe to run
 *  from more than one worker at once (rolling deploys) and again after a
 *  restart: sent/failed/skipped/uncertain rows are never touched, live leases
 *  held by another worker are waited for, expired ones are settled. */
export async function runCampaign(campaignId: string): Promise<void> {
  const [campaign] = await db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId));
  if (!campaign || campaign.status !== 'sending') return;
  const built = buildCampaignEmail(campaign.subject, campaign.bodyHtml);
  const live = isMailConfigured();

  // A transient database error (Neon idle cutoff, a pool hiccup, a blip) must
  // not end the loop: an abandoned loop leaves the campaign 'sending' forever,
  // and the one-sending index then blocks every future campaign until a
  // restart. Each pass is isolated; errors back off and retry, and only a long
  // unbroken run of them gives up (the boot hook resumes it later).
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 30;
  for (;;) {
    try {
      const next = await claimNext(campaignId);
      if (next) {
        // Delivery and its bookkeeping are separate steps with separate
        // failure meanings: a provider error is a failed send; a database
        // error AFTER the provider accepted is a recorded-delivery problem.
        let delivered = false;
        try {
          await sendCampaignMail(next.email, campaign.subject, built, {
            unsubscribeUrl: unsubscribeUrlFor(next.email),
            // Stable per campaign+row: a retry after an interrupted send is
            // deduplicated by the provider instead of delivered twice.
            idempotencyKey: `campaign:${campaignId}:${next.id}`,
          });
          delivered = true;
        } catch (error: any) {
          console.error(`[CAMPAIGN] failed for ${next.email}: ${error?.message}`);
          await markFailed(next.id, next.claimedAt, String(error?.message ?? 'send failed'))
            .catch((e: any) => console.error(`[CAMPAIGN] could not record failure for ${next.email}: ${e?.message}`));
        }
        if (delivered) {
          await markSent(next.id, next.email);
          if (live) console.log(`[CAMPAIGN] sent to ${next.email}`);
        }
        consecutiveErrors = 0;
        // Gentle pacing — provider rate limits, and a slow drip beats a bounce storm.
        if (live) await new Promise((resolve) => setTimeout(resolve, 300));
        continue;
      }

      // Nothing claimable. Retire retries that outlived their window (they're
      // pending but claimNext refuses them), settle any claims whose lease ran
      // out (a dead worker's), then look again — settling may have returned
      // rows to 'pending'.
      await expireStaleRetries(campaignId);
      const settled = await settleExpiredClaims(campaignId);
      if (settled.retried.length) continue;

      const [{ inFlight }] = await db
        .select({ inFlight: sql<number>`count(*)::int` })
        .from(emailCampaignRecipients)
        .where(and(eq(emailCampaignRecipients.campaignId, campaignId), inArray(emailCampaignRecipients.status, ['pending', 'sending'])));
      consecutiveErrors = 0;
      if (inFlight === 0) break;
      // Another worker holds live leases — wait for them rather than declaring
      // the campaign done underneath it.
      await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
    } catch (error: any) {
      consecutiveErrors++;
      console.error(`[CAMPAIGN] ${campaignId}: loop error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error?.message}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`[CAMPAIGN] ${campaignId}: giving up for now — still 'sending'; the boot hook or next worker resumes it`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(5_000 * consecutiveErrors, 60_000)));
    }
  }

  // Finishing is itself retried: a blip right here would otherwise strand the
  // campaign 'sending' with nothing left to do.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await db.update(emailCampaigns).set({ status: 'done', completedAt: new Date() }).where(eq(emailCampaigns.id, campaignId));
      console.log(`[CAMPAIGN] ${campaignId} done`);
      return;
    } catch (error: any) {
      console.error(`[CAMPAIGN] ${campaignId}: could not mark done (attempt ${attempt}): ${error?.message}`);
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
}

/** Boot hook: any campaign still 'sending' was interrupted by a restart — or is
 *  being drained by the previous deployment's worker. runCampaign handles both:
 *  it takes whatever is pending, settles only EXPIRED leases, and waits on live
 *  ones instead of finishing the campaign out from under another worker. */
export async function resumeUnfinishedCampaigns(): Promise<void> {
  const unfinished = await db
    .select({ id: emailCampaigns.id, subject: emailCampaigns.subject })
    .from(emailCampaigns)
    .where(eq(emailCampaigns.status, 'sending'));
  for (const c of unfinished) {
    console.log(`[CAMPAIGN] resuming unfinished campaign ${c.id} "${c.subject}"`);
    void runCampaign(c.id).catch((e) => console.error('[CAMPAIGN] resume failed:', e));
  }
}

/** "Send a test to me": one message to the admin's own address, never persisted
 *  as a campaign, subject prefixed so it can't be mistaken for the real thing. */
export async function sendTestCampaign(to: string, subject: string, bodyHtml: string): Promise<void> {
  const clean = sanitizeCampaignHtml(bodyHtml);
  const subj = subject.trim().slice(0, 150) || '(no subject)';
  if (!clean.replace(/<[^>]+>/g, '').trim()) throw Object.assign(new Error('The email body is empty'), { status: 400 });
  const built = buildCampaignEmail(subj, clean);
  await sendCampaignMail(to, `[TEST] ${subj}`, built, { unsubscribeUrl: unsubscribeUrlFor(to) });
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
