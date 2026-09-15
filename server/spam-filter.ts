/**
 * Cheap spam screen for public forms (owner, 2026-09-15: the contact form was
 * relaying "get a Wikipedia page" pitches to every staff inbox). Nothing here
 * needs a third-party service: a honeypot field and a per-IP rate limit
 * already exist; this adds the two signals those miss — a form submitted
 * faster than a person could fill it, and the tell-tale phrasing of bulk
 * pitches. Scores are additive; a caller drops anything at or above SPAM_THRESHOLD
 * while answering "sent" so the sender learns nothing.
 */

export const SPAM_THRESHOLD = 2;

/** A person needs at least this long between opening the form and sending it. */
export const MIN_FILL_MS = 3_000;

const PHRASES: Array<[RegExp, number, string]> = [
  [/respond\s+(with|back\s+with)\s+["']?stop["']?\s+to\s+opt\s*out/i, 3, "opt-out footer"],
  [/\b(opt\s*-?\s*out|unsubscribe)\b/i, 1, "opt-out language"],
  [/\bwikipedia\s+page\b/i, 2, "Wikipedia page pitch"],
  [/\b(seo|search\s+engine\s+optimi[sz]ation|backlinks?|guest\s+posts?|domain\s+authority)\b/i, 2, "SEO pitch"],
  [/\b(1st|first)\s+page\s+of\s+google\b/i, 2, "Google ranking pitch"],
  [/\b(web\s*site|web)\s+(design|development)\s+(services?|company|agency)\b/i, 2, "web design pitch"],
  [/\b(boost|increase|grow)\s+your\s+(sales|revenue|traffic|leads|ranking)/i, 1, "growth pitch"],
  [/\b(crypto(currency)?|bitcoin|forex|casino|loan\s+offer|payday)\b/i, 2, "finance spam"],
  [/\bif\s+you\s+are\s+interested\s+(in\s+getting\s+more\s+information\s+)?(just\s+)?(respond|reply)\s+(back\s+)?to\s+this\s+email/i, 2, "reply-to-this-email pitch"],
  [/\b(get|getting)\s+(yourself|your\s+business)\s+noticed\b/i, 1, "marketing pitch"],
];

export type SpamVerdict = { score: number; reasons: string[] };

/** Score free text (and, when given, the sender's fields) for bulk-pitch tells. */
export function spamScore(message: string, extra: { name?: string; email?: string; company?: string } = {}): SpamVerdict {
  const text = String(message ?? "");
  const reasons: string[] = [];
  let score = 0;
  for (const [re, weight, label] of PHRASES) {
    if (re.test(text)) {
      score += weight;
      reasons.push(label);
    }
  }
  const links = (text.match(/https?:\/\/|www\./gi) ?? []).length;
  if (links >= 2) {
    score += 2;
    reasons.push(`${links} links`);
  }
  // A "name" that is itself a URL or an email is a bot filling fields.
  if (extra.name && /(https?:\/\/|www\.|@)/i.test(extra.name)) {
    score += 2;
    reasons.push("name is a link/email");
  }
  return { score, reasons };
}

/** True when the form was submitted faster than a person could fill it, or
 *  without ever being opened (a direct POST to the API). */
export function submittedTooFast(formOpenedAt: unknown, now = Date.now()): boolean {
  const opened = typeof formOpenedAt === "number" ? formOpenedAt : Number(formOpenedAt);
  if (!Number.isFinite(opened) || opened <= 0) return true;
  return now - opened < MIN_FILL_MS;
}
