import crypto from "crypto";
import { getBaseUrl } from "./app-url";

/**
 * The payment link in an emailed invoice and in its overdue reminders. A Stripe
 * Checkout URL dies after 24 hours (owner, 2026-10-07: Pot of Gold Coffee's
 * "pay by bank transfer link in their email expired even though it was fairly
 * recent"), so the email carries OUR link, /pay/<order>/<signature>; the route
 * in routes.ts mints a fresh Checkout session on every click. The signature is
 * the key, as the Stripe URL it replaces was: an HMAC of the order id, compared
 * in constant time.
 */
const payLinkSecret = () => process.env.PAY_LINK_SECRET || process.env.SESSION_SECRET || "dev-pay-link-secret";

export function payLinkSignature(orderId: string): string {
  return crypto.createHmac("sha256", payLinkSecret()).update(`wholesale-pay:${orderId}`).digest("base64url").slice(0, 32);
}

export function payLinkSignatureMatches(orderId: string, signature: string): boolean {
  const expected = Buffer.from(payLinkSignature(orderId));
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function wholesalePayLink(orderId: string): string {
  return `${getBaseUrl()}/pay/${orderId}/${payLinkSignature(orderId)}`;
}
