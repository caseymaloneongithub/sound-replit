// Simple in-memory rate limiting for emailed verification / 2FA codes.
// Shared by routes.ts (wholesale email login) and auth.ts (retail/staff 2FA) so a
// single attacker can't email-bomb an account or brute-force a 6-digit code.

/**
 * Returns false when the caller has exceeded the send limit for this email
 * (5 codes per 15 minutes). Delegates to the generic bucket limiter below so there is
 * one fixed-window implementation — a separate copy here had no size sweep, so its Map
 * grew without bound on a long-lived process.
 */
export function checkEmailCodeRateLimit(email: string): boolean {
  return checkSubmissionRateLimit(`email-code:${email.toLowerCase()}`, 5, 15 * 60 * 1000);
}

/** Max wrong guesses allowed against a single issued code before it's refused. */
export const MAX_CODE_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Generic per-IP limiter for unauthenticated public forms (contact, wholesale
// application). These endpoints email every staff address on submit, so without a
// limit one script can flood the team's inbox.
// ---------------------------------------------------------------------------

const submissionLimiter = new Map<string, { count: number; resetAt: number }>();

/**
 * Returns false when this bucket has exceeded `limit` submissions in `windowMs`.
 * `bucket` should combine the form name and the client IP.
 */
export function checkSubmissionRateLimit(
  bucket: string,
  limit = 5,
  windowMs = 60 * 60 * 1000,
): boolean {
  const now = Date.now();
  const entry = submissionLimiter.get(bucket);

  // Opportunistic sweep so the map can't grow without bound on a long-lived process.
  if (submissionLimiter.size > 5000) {
    for (const [k, v] of Array.from(submissionLimiter.entries())) {
      if (now >= v.resetAt) submissionLimiter.delete(k);
    }
  }

  if (!entry || now >= entry.resetAt) {
    submissionLimiter.set(bucket, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count++;
  return true;
}

/**
 * Honeypot: a field real users never see and never fill. Bots that blindly complete
 * every input trip it. We return success to the caller rather than an error, so a bot
 * gets no signal that it was caught.
 */
export function isHoneypotTripped(body: any): boolean {
  return typeof body?.website === "string" && body.website.trim() !== "";
}
