import crypto from "crypto";
import { getBaseUrl } from "./app-url";

/**
 * Links a customer can open without logging in. The signature in the URL is the
 * key, as a Stripe URL would be: an HMAC of the order id, compared in constant
 * time. Each kind of link signs its own purpose, so an invoice link can't start
 * a payment and a pay link doesn't open the invoice.
 *
 * Pay link, /pay/<order>/<signature>: the payment link in an emailed invoice and
 * in its overdue reminders. A Stripe Checkout URL dies after 24 hours (owner,
 * 2026-10-07: Pot of Gold Coffee's "pay by bank transfer link in their email
 * expired even though it was fairly recent"), so the email carries OUR link, and
 * the route in routes.ts mints a fresh Checkout session on every click.
 *
 * Invoice link, /invoice/<order>/<signature>: the invoice itself, read-only, with
 * the pay button (owner, 2026-10-29: "be able to send a link to a customer to an
 * invoice"). Staff copy it from the invoice page.
 */
const payLinkSecret = () => process.env.PAY_LINK_SECRET || process.env.SESSION_SECRET || "dev-pay-link-secret";

const sign = (purpose: string, orderId: string): string =>
  crypto.createHmac("sha256", payLinkSecret()).update(`${purpose}:${orderId}`).digest("base64url").slice(0, 32);

const matches = (expectedSignature: string, signature: string): boolean => {
  const expected = Buffer.from(expectedSignature);
  const given = Buffer.from(String(signature));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

export function payLinkSignature(orderId: string): string {
  return sign("wholesale-pay", orderId);
}

export function payLinkSignatureMatches(orderId: string, signature: string): boolean {
  return matches(payLinkSignature(orderId), signature);
}

export function wholesalePayLink(orderId: string): string {
  return `${getBaseUrl()}/pay/${orderId}/${payLinkSignature(orderId)}`;
}

export function invoiceLinkSignature(orderId: string): string {
  return sign("wholesale-invoice", orderId);
}

export function invoiceLinkSignatureMatches(orderId: string, signature: string): boolean {
  return matches(invoiceLinkSignature(orderId), signature);
}

export function wholesaleInvoiceLink(orderId: string): string {
  return `${getBaseUrl()}/invoice/${orderId}/${invoiceLinkSignature(orderId)}`;
}
