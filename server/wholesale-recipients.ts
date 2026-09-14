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
  source: "location" | "account" | "none";
  label: string;
  /** Set when the rule yields no address: what staff should do about it. */
  problem?: string;
};

/**
 * Resolve the recipients for an order of `customerId` delivered to
 * `locationId` (null for pickup). `also` adds addresses that should get a copy
 * regardless — the person who placed a portal order, an address a guest typed
 * in — de-duplicated against the rule's own list.
 */
export async function wholesaleOrderRecipients(
  customerId: string,
  locationId: string | null | undefined,
  also: Array<string | null | undefined> = [],
): Promise<OrderRecipients> {
  const customer = await storage.getWholesaleCustomer(customerId);
  if (!customer) throw new Error("Wholesale customer not found");
  const locations = (await storage.getWholesaleLocations(customerId)).filter((l) => l.isActive !== false);
  const location = locationId ? locations.find((l) => l.id === locationId) ?? (await storage.getWholesaleLocation(locationId)) : null;

  let to: string[] = [];
  let source: OrderRecipients["source"] = "account";
  let label = "account email";
  let problem: string | undefined;
  if (locations.length > 1 && location) {
    // Multi-location customer, order tied to a store: that store's inbox or
    // nothing. A pickup order (no location) is customer-level, below.
    to = splitEmails((location as any).contactEmail);
    if (to.length > 0) {
      source = "location";
      label = `${location.locationName} inbox`;
    } else {
      source = "none";
      label = `no inbox on ${location.locationName}`;
      problem = `No email on file for ${location.locationName} — add one to the location, or enter an address here.`;
    }
  } else {
    to = splitEmails(customer.email);
    if (to.length === 0) {
      source = "none";
      label = "no account email";
      problem = `No email on file for ${customer.businessName} — add one to the account, or enter an address here.`;
    }
  }

  const seen = new Set(to.map((e) => e.toLowerCase()));
  for (const extra of also) {
    for (const e of splitEmails(extra)) {
      if (seen.has(e.toLowerCase())) continue;
      seen.add(e.toLowerCase());
      to.push(e);
    }
  }
  return { to, source, label, problem };
}
