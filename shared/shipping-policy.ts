/**
 * Retail shipping policy (owner, 2026-10-05): cans only, insulated shippers with
 * ice packs, packed and shipped on MONDAYS. Raw product means a two-day transit
 * ceiling, so a Monday ship lands by Wednesday with no weekend in a depot.
 *
 * Pure helpers shared by server and client. Anything that talks to Shippo or
 * Stripe lives in server/shipping.ts.
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { PICKUP_POLICY } from './pickup-policy';

export const SHIPPING_SETTINGS_KEY = 'shipping_settings';

export type ShippingSettings = {
  /** Master switch: off hides the Ship option at checkout entirely. */
  enabled: boolean;
  shipFrom: { name: string; company: string; street1: string; city: string; state: string; zip: string; phone: string; email: string };
  /** ISO weekday the batch ships (1 = Monday). */
  shipWeekday: number;
  /** Longest acceptable carrier transit, in days. Rates slower than this are not offered. */
  maxTransitDays: number;
  /** Owner's flat add-on per box, on top of each box's own packaging fee. */
  flatFeeCents: number;
  /** Markup on the carrier rate, in percent (0 = pass through at cost). */
  markupPercent: number;
  /** Two-letter states we will not ship to. */
  excludedStates: string[];
  /** Stripe Tax product tax code for the cans; empty = the account's default. */
  stripeTaxCode: string;
  /** Default weight of one full can when a product has none set. */
  defaultCanWeightOz: number;
  /** Bumped on every save so cached quotes from before an edit are discarded. */
  version: number;
};

export const DEFAULT_SHIPPING_SETTINGS: ShippingSettings = {
  enabled: false,
  shipFrom: {
    name: 'Puget Sound Kombucha Co.',
    company: 'Puget Sound Kombucha Co.',
    street1: PICKUP_POLICY.address,
    city: 'Seattle',
    state: 'WA',
    zip: '98107',
    phone: PICKUP_POLICY.phone,
    email: '',
  },
  shipWeekday: 1,
  maxTransitDays: 2,
  flatFeeCents: 0,
  markupPercent: 0,
  excludedStates: ['AK', 'HI', 'PR', 'GU', 'VI', 'AS', 'MP'],
  stripeTaxCode: '',
  defaultCanWeightOz: 17,
  version: 1,
};

export type ShippingAddress = {
  name: string;
  address1: string;
  address2?: string | null;
  city: string;
  state: string;
  zip: string;
  phone?: string | null;
};

/** One packed box in a quote: which shipper, how many cans, and the rate chosen for it. */
export type QuotedBox = {
  boxId: string;
  boxName: string;
  cans: number;
  weightOz: number;
  rateId: string | null;
  carrier: string;
  service: string;
  serviceToken: string | null;
  estimatedDays: number | null;
  carrierCents: number;
  packagingCents: number; // box fee + flat fee
};

export type ShippingQuote = {
  boxes: QuotedBox[];
  carrierCents: number;    // sum of carrier rates, after markup
  packagingCents: number;  // sum of per-box packaging + flat fees
  totalCents: number;      // what the customer pays for shipping & handling
  shipDate: string;        // ISO timestamp, midnight Pacific on the ship day
  estimatedDays: number | null; // slowest box
  settingsVersion: number;
  stub?: boolean;          // true when no carrier key was configured and a stand-in rate was used
  repackedAt?: string;     // set when a staff edit re-planned the boxes after payment
};

export type ShippingLabel = {
  boxName: string;
  cans: number;
  carrier: string;
  service: string;
  trackingNumber: string;
  trackingUrl: string | null;
  labelUrl: string | null;     // PNG (4x6) from the carrier; null in stub mode
  transactionId: string | null;
  amountCents: number;
};

/**
 * The next ship day strictly after today, Pacific. Cutoff is midnight Sunday:
 * an order placed Monday morning ships the FOLLOWING Monday, one placed Sunday
 * night ships tomorrow. Returns midnight Pacific on that day.
 */
export function nextShipDate(now: Date = new Date(), shipWeekday = 1): Date {
  const todayStr = formatInTimeZone(now, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  const [y, m, d] = todayStr.split('-').map(Number);
  const todayNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dow = todayNoon.getUTCDay(); // 0 = Sunday
  let daysAhead = (shipWeekday - dow + 7) % 7;
  if (daysAhead === 0) daysAhead = 7; // today is the ship day: it's already past cutoff
  const target = new Date(Date.UTC(y, m - 1, d + daysAhead, 12, 0, 0));
  const targetStr = target.toISOString().slice(0, 10);
  return fromZonedTime(`${targetStr}T00:00:00`, PICKUP_POLICY.timezone);
}

export function formatShipDate(date: Date | string): string {
  return formatInTimeZone(new Date(date), PICKUP_POLICY.timezone, 'EEEE, MMM d');
}

export type PackableBox = { id: string; name: string; canCapacity: number };

/**
 * Pack a can count into boxes. For what remains, take the smallest box that
 * holds all of it; if none does, take the largest and repeat. With 12 and 24
 * can shippers: 36 → 24 + 12, 30 → 24 + 12, 8 → 12.
 */
export function packCans(totalCans: number, boxes: PackableBox[]): Array<{ box: PackableBox; cans: number }> {
  const sorted = boxes.filter((b) => b.canCapacity > 0).sort((a, b) => a.canCapacity - b.canCapacity);
  if (sorted.length === 0 || totalCans <= 0) return [];
  const largest = sorted[sorted.length - 1];
  const out: Array<{ box: PackableBox; cans: number }> = [];
  let remaining = totalCans;
  while (remaining > 0) {
    const fit = sorted.find((b) => b.canCapacity >= remaining);
    if (fit) {
      out.push({ box: fit, cans: remaining });
      remaining = 0;
    } else {
      out.push({ box: largest, cans: largest.canCapacity });
      remaining -= largest.canCapacity;
    }
  }
  return out;
}

export function normalizeShippingSettings(raw: unknown): ShippingSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ShippingSettings>;
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_SHIPPING_SETTINGS.enabled,
    shipFrom: { ...DEFAULT_SHIPPING_SETTINGS.shipFrom, ...(r.shipFrom ?? {}) },
    shipWeekday: Math.min(6, Math.max(0, Math.round(num(r.shipWeekday, DEFAULT_SHIPPING_SETTINGS.shipWeekday)))),
    maxTransitDays: Math.max(1, Math.round(num(r.maxTransitDays, DEFAULT_SHIPPING_SETTINGS.maxTransitDays))),
    flatFeeCents: Math.max(0, Math.round(num(r.flatFeeCents, 0))),
    markupPercent: Math.max(0, num(r.markupPercent, 0)),
    excludedStates: Array.isArray(r.excludedStates)
      ? r.excludedStates.map((s) => String(s).trim().toUpperCase()).filter((s) => /^[A-Z]{2}$/.test(s))
      : DEFAULT_SHIPPING_SETTINGS.excludedStates,
    stripeTaxCode: typeof r.stripeTaxCode === 'string' ? r.stripeTaxCode.trim() : '',
    defaultCanWeightOz: Math.max(1, num(r.defaultCanWeightOz, DEFAULT_SHIPPING_SETTINGS.defaultCanWeightOz)),
    version: Math.max(1, Math.round(num(r.version, 1))),
  };
}
