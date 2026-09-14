/**
 * ONE rule for who a wholesale customer's order emails go to (owner,
 * 2026-09-14): a customer with several locations is emailed at the ORDER'S
 * location (each Evergreens store bills its own AP inbox); a customer with a
 * single location is emailed at the account email. A location may list several
 * addresses separated by commas or semicolons — every one of them gets the
 * email. NO FALLBACKS (owner, same day: "incorrect emails will annoy
 * customers"): a multi-location customer's order to a location with no inbox
 * on file gets NO recipient, and the caller tells staff so, rather than the
 * account email quietly receiving another store's mail. Confirmations,
 * invoices, receipts and anything else about an order must resolve recipients
 * here and nowhere else.
 */
import { storage } from "./storage";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** "a@x.com, b@y.com; c@z.com" -> ["a@x.com", "b@y.com", "c@z.com"], valid
 *  addresses only, de-duplicated case-insensitively (first spelling kept). */
export function splitEmails(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw ?? "").split(/[,;\s]+/)) {
    const e = part.trim();
    if (!EMAIL.test(e)) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export type OrderRecipients = {
  to: string[];
  /** Where the addresses came from, for logs and the send dialog. */
  source: "order" | "location" | "account" | "none";
  label: string;
  /** Set when the rule yields no address: what staff should do about it. */
  problem?: string;
};

/**
 * Resolve the recipients for an order of `customerId` tied to `locationId`
 * (null for a pickup order). Nothing is ever appended or substituted: the
 * rule's answer is the whole answer, and when it has none the caller shows
 * `problem` to staff.
 *
 * "Multi-location" counts every location the customer has ever had, active or
 * not, so deactivating a store never silently reroutes its open orders to the
 * account email (reviewer, 2026-09-14).
 *
 * `orderContactEmail` is an address chosen FOR THIS ORDER — typed by a guest on
 * the no-login form, or entered by staff in a send dialog — and wins outright:
 * an explicit choice, not a fallback. It is stored on the order so every later
 * email about it (invoice, receipt) follows the same choice.
 */
export async function wholesaleOrderRecipients(
  customerId: string,
  locationId: string | null | undefined,
  orderContactEmail?: string | null,
): Promise<OrderRecipients> {
  const chosen = splitEmails(orderContactEmail);
  if (chosen.length > 0) return { to: chosen, source: "order", label: "address given for this order" };

  const customer = await storage.getWholesaleCustomer(customerId);
  if (!customer) throw new Error("Wholesale customer not found");
  const locations = await storage.getWholesaleLocations(customerId);
  const multi = locations.length > 1;
  const location = locationId ? locations.find((l) => l.id === locationId) ?? (await storage.getWholesaleLocation(locationId)) : null;

  let to: string[] = [];
  let source: OrderRecipients["source"] = "account";
  let label = "account email";
  let problem: string | undefined;
  if (multi) {
    // Every email about a multi-location customer's order goes to the store
    // the order is for. A pickup order names no store, so it has no recipient
    // until staff say which store is ordering.
    if (!location) {
      source = "none";
      label = "pickup order, no store named";
      problem = `${customer.businessName} has several locations and this pickup order doesn't name one — enter the ordering store's address here.`;
    } else {
      to = splitEmails((location as any).contactEmail);
      if (to.length > 0) {
        source = "location";
        label = `${location.locationName} inbox`;
      } else {
        source = "none";
        label = `no inbox on ${location.locationName}`;
        problem = `No email on file for ${location.locationName} — add one to the location, or enter an address here.`;
      }
    }
  } else {
    to = splitEmails(customer.email);
    if (to.length === 0) {
      source = "none";
      label = "no account email";
      problem = `No email on file for ${customer.businessName} — add one to the account, or enter an address here.`;
    }
  }
  return { to, source, label, problem };
}
