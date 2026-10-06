/**
 * Retail shipping (owner, 2026-10-05): cans only, in insulated shippers with ice
 * packs, packed and shipped on Mondays. Carrier rates and labels come from Shippo
 * (one shipment per box, so USPS works too); the customer's charge is the carrier
 * rate plus the owner's per-box packaging fee, both read from /admin/shipping.
 * Sales tax on shipped orders is Stripe Tax, destination-based.
 *
 * No SHIPPO_API_KEY → stub mode: a stand-in rate and a drawn placeholder label,
 * so checkout and the board can be exercised locally. Quotes say so (`stub`).
 */
import Stripe from 'stripe';
import PDFDocument from 'pdfkit';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db } from './db';
import { flavors, retailOrderItemsV2, retailOrders, retailProducts, shippingBoxes, siteSettings, type RetailOrder, type ShippingBox } from '@shared/schema';
import {
  DEFAULT_SHIPPING_SETTINGS,
  SHIPPING_SETTINGS_KEY,
  formatShipDate,
  nextShipDate,
  normalizeShippingSettings,
  packCans,
  type QuotedBox,
  type ShippingAddress,
  type ShippingLabel,
  type ShippingQuote,
  type ShippingSettings,
} from '@shared/shipping-policy';
import { recordEvent } from './ops-events';

const SHIPPO_BASE = 'https://api.goshippo.com';
const SHIPPO_KEY = process.env.SHIPPO_API_KEY?.trim() || '';
/** Washington's combined rate used ONLY when Stripe Tax is unreachable (the pickup rate today). */
const FALLBACK_WA_RATE = 0.1035;

export class ShippingError extends Error {
  constructor(public status: number, message: string, public code: string = 'shipping_error') {
    super(message);
  }
}

export function shippingProviderStatus(): { provider: 'shippo' | 'stub'; configured: boolean; testMode: boolean } {
  return {
    provider: SHIPPO_KEY ? 'shippo' : 'stub',
    configured: !!SHIPPO_KEY,
    testMode: SHIPPO_KEY.startsWith('shippo_test_'),
  };
}

// ---------------------------------------------------------------------------
// Settings and boxes
// ---------------------------------------------------------------------------

export async function getShippingSettings(): Promise<ShippingSettings> {
  const [row] = await db.select().from(siteSettings).where(eq(siteSettings.key, SHIPPING_SETTINGS_KEY));
  if (!row) return { ...DEFAULT_SHIPPING_SETTINGS };
  try {
    return normalizeShippingSettings(JSON.parse(row.value));
  } catch {
    return { ...DEFAULT_SHIPPING_SETTINGS };
  }
}

/** Merge and save. Bumps the version so quotes cached before the edit are discarded. */
export async function saveShippingSettings(patch: Partial<ShippingSettings>): Promise<ShippingSettings> {
  const current = await getShippingSettings();
  const next = normalizeShippingSettings({ ...current, ...patch, shipFrom: { ...current.shipFrom, ...(patch.shipFrom ?? {}) }, version: current.version + 1 });
  await db
    .insert(siteSettings)
    .values({ key: SHIPPING_SETTINGS_KEY, value: JSON.stringify(next), updatedAt: new Date() })
    .onConflictDoUpdate({ target: siteSettings.key, set: { value: JSON.stringify(next), updatedAt: new Date() } });
  quoteCache.clear();
  return next;
}

export async function getActiveBoxes(): Promise<ShippingBox[]> {
  return db.select().from(shippingBoxes).where(eq(shippingBoxes.isActive, true)).orderBy(asc(shippingBoxes.canCapacity));
}

export async function getAllBoxes(): Promise<ShippingBox[]> {
  return db.select().from(shippingBoxes).orderBy(asc(shippingBoxes.displayOrder), asc(shippingBoxes.canCapacity));
}

// ---------------------------------------------------------------------------
// Cart → cans
// ---------------------------------------------------------------------------

export type ShippableLine = {
  quantity: number;
  retailProduct: { cansPerUnit: number | null; canWeightOz: string | number | null; unitDescription?: string | null };
};

/**
 * Whether a cart can ship at all, and how many cans it holds. A legacy-catalog
 * line or any unit without a can count (kegs) makes the whole cart pickup-only.
 */
export function summarizeCans(
  retailLines: ShippableLine[],
  legacyLineCount: number,
  settings: ShippingSettings,
): { shippable: boolean; reason: string | null; cans: number; cansWeightOz: number } {
  if (legacyLineCount > 0) return { shippable: false, reason: 'Some items in your cart are pickup only.', cans: 0, cansWeightOz: 0 };
  let cans = 0;
  let weight = 0;
  for (const line of retailLines) {
    const per = line.retailProduct.cansPerUnit;
    if (!per || per <= 0) {
      const what = line.retailProduct.unitDescription ? `"${line.retailProduct.unitDescription}"` : 'an item in your cart';
      return { shippable: false, reason: `${what} is pickup only — kegs don't ship.`, cans: 0, cansWeightOz: 0 };
    }
    const each = Number(line.retailProduct.canWeightOz ?? 0) || settings.defaultCanWeightOz;
    cans += per * line.quantity;
    weight += per * line.quantity * each;
  }
  if (cans === 0) return { shippable: false, reason: 'Your cart is empty.', cans: 0, cansWeightOz: 0 };
  return { shippable: true, reason: null, cans, cansWeightOz: weight };
}

// ---------------------------------------------------------------------------
// Shippo
// ---------------------------------------------------------------------------

type ShippoRate = {
  object_id: string;
  amount: string;
  currency: string;
  provider: string;
  servicelevel: { name: string; token: string };
  estimated_days: number | null;
  duration_terms?: string;
};

async function shippo<T>(path: string, body?: unknown, method: 'POST' | 'GET' = body ? 'POST' : 'GET'): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25_000);
  try {
    const res = await fetch(`${SHIPPO_BASE}${path}`, {
      method,
      headers: {
        Authorization: `ShippoToken ${SHIPPO_KEY}`,
        'Content-Type': 'application/json',
        'Shippo-API-Version': '2018-02-08',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
    if (!res.ok) {
      const detail = json?.detail || json?.message || (json ? JSON.stringify(json).slice(0, 300) : text.slice(0, 300));
      throw new ShippingError(502, `Carrier service error (${res.status}): ${detail}`, 'carrier_error');
    }
    return json as T;
  } catch (e: any) {
    if (e instanceof ShippingError) throw e;
    if (e?.name === 'AbortError') throw new ShippingError(504, 'The carrier rate service timed out. Please try again.', 'carrier_timeout');
    throw new ShippingError(502, `Carrier service unreachable: ${e?.message ?? e}`, 'carrier_error');
  } finally {
    clearTimeout(timer);
  }
}

function shippoAddress(a: ShippingAddress, email?: string | null) {
  return {
    name: a.name,
    street1: a.address1,
    street2: a.address2 || undefined,
    city: a.city,
    state: a.state.toUpperCase(),
    zip: a.zip,
    country: 'US',
    phone: a.phone || undefined,
    email: email || undefined,
  };
}

function shipFromAddress(settings: ShippingSettings) {
  const f = settings.shipFrom;
  return { name: f.name, company: f.company || undefined, street1: f.street1, city: f.city, state: f.state, zip: f.zip, country: 'US', phone: f.phone || undefined, email: f.email || undefined };
}

function parcelFor(box: ShippingBox, cans: number, cansWeightOz: number) {
  const weight = Number(box.tareWeightOz) + cansWeightOz + box.icePackCount * Number(box.icePackWeightOz);
  return {
    parcel: {
      length: String(box.lengthIn),
      width: String(box.widthIn),
      height: String(box.heightIn),
      distance_unit: 'in',
      weight: Math.max(1, weight).toFixed(1),
      mass_unit: 'oz',
    },
    weightOz: Math.round(weight * 10) / 10,
    cans,
  };
}

/** Cheapest rate that arrives within the transit ceiling. Null when nothing qualifies. */
function pickRate(rates: ShippoRate[], maxTransitDays: number, preferToken?: string | null): ShippoRate | null {
  const usable = rates.filter((r) => r.currency === 'USD' && Number.isFinite(Number(r.amount)) && r.estimated_days != null && r.estimated_days <= maxTransitDays);
  if (preferToken) {
    const same = usable.filter((r) => r.servicelevel?.token === preferToken).sort((a, b) => Number(a.amount) - Number(b.amount));
    if (same[0]) return same[0];
  }
  usable.sort((a, b) => Number(a.amount) - Number(b.amount));
  return usable[0] ?? null;
}

async function rateBox(settings: ShippingSettings, to: ShippingAddress, box: ShippingBox, cans: number, cansWeightOz: number, shipDate: Date, email?: string | null, preferToken?: string | null): Promise<{ rate: ShippoRate | null; weightOz: number; all: ShippoRate[] }> {
  const { parcel, weightOz } = parcelFor(box, cans, cansWeightOz);
  const shipment = await shippo<{ rates: ShippoRate[]; messages?: Array<{ text: string }> }>('/shipments/', {
    address_from: shipFromAddress(settings),
    address_to: shippoAddress(to, email),
    parcels: [parcel],
    // Rates and transit estimates from the day the batch actually leaves.
    shipment_date: shipDate.toISOString(),
    async: false,
  });
  const rates = shipment.rates ?? [];
  return { rate: pickRate(rates, settings.maxTransitDays, preferToken), weightOz, all: rates };
}

/** Shippo address validation. Throws a 400 with the carrier's wording when the address won't deliver. */
async function validateAddress(to: ShippingAddress): Promise<void> {
  const res = await shippo<{ validation_results?: { is_valid?: boolean; messages?: Array<{ text?: string; type?: string }> } }>('/addresses/', {
    ...shippoAddress(to),
    validate: true,
  });
  const v = res.validation_results;
  if (v && v.is_valid === false) {
    const why = (v.messages ?? []).map((m) => m.text).filter(Boolean).join(' ');
    throw new ShippingError(400, why ? `We couldn't verify that address: ${why}` : "We couldn't verify that address. Please check it and try again.", 'address_invalid');
  }
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

const quoteCache = new Map<string, { quote: ShippingQuote; expires: number }>();
const QUOTE_TTL_MS = 15 * 60 * 1000;

function cacheKey(cans: number, cansWeightOz: number, to: ShippingAddress, settings: ShippingSettings, shipDate: Date): string {
  const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  // Name and phone are part of the Shippo shipment the rate belongs to, so two
  // recipients at one address must not share a cached quote (reviewer, 2026-10-06).
  return JSON.stringify([cans, Math.round(cansWeightOz), norm(to.name), norm(to.phone), norm(to.address1), norm(to.address2), norm(to.city), norm(to.state), norm(to.zip).slice(0, 5), settings.version, shipDate.toISOString()]);
}

export function validateShipTo(a: Partial<ShippingAddress> | null | undefined): ShippingAddress {
  const name = (a?.name ?? '').trim();
  const address1 = (a?.address1 ?? '').trim();
  const city = (a?.city ?? '').trim();
  const state = (a?.state ?? '').trim().toUpperCase();
  const zip = (a?.zip ?? '').trim();
  if (name.length < 2) throw new ShippingError(400, 'Please enter the recipient name.', 'address_incomplete');
  if (address1.length < 4) throw new ShippingError(400, 'Please enter a street address.', 'address_incomplete');
  if (city.length < 2) throw new ShippingError(400, 'Please enter a city.', 'address_incomplete');
  if (!/^[A-Z]{2}$/.test(state)) throw new ShippingError(400, 'Please enter a two-letter state.', 'address_incomplete');
  if (!/^\d{5}(-\d{4})?$/.test(zip)) throw new ShippingError(400, 'Please enter a valid ZIP code.', 'address_incomplete');
  if (/^\s*p\.?\s*o\.?\s*box/i.test(address1)) throw new ShippingError(400, 'We can\'t ship cold-packed boxes to a PO Box. Please use a street address.', 'po_box');
  return { name, address1, address2: (a?.address2 ?? '').trim() || null, city, state, zip, phone: (a?.phone ?? '').trim() || null };
}

/**
 * Quote shipping & handling for a cart to an address. Packs cans into boxes,
 * rates each box for the next ship day, keeps the cheapest service within the
 * transit ceiling, and adds the owner's packaging fees. Cached briefly so the
 * live preview and the authoritative call at "Continue to Payment" agree.
 */
export async function quoteShipping(input: {
  retailLines: ShippableLine[];
  legacyLineCount: number;
  to: ShippingAddress;
  email?: string | null;
  settings?: ShippingSettings;
  boxes?: ShippingBox[];
}): Promise<ShippingQuote> {
  const settings = input.settings ?? (await getShippingSettings());
  if (!settings.enabled) throw new ShippingError(400, 'Shipping is not available right now — pickup only.', 'disabled');
  const to = validateShipTo(input.to);
  if (settings.excludedStates.includes(to.state)) throw new ShippingError(400, `Sorry, we don't ship to ${to.state} yet.`, 'state_excluded');

  const summary = summarizeCans(input.retailLines, input.legacyLineCount, settings);
  if (!summary.shippable) throw new ShippingError(400, summary.reason ?? 'This cart cannot be shipped.', 'not_shippable');

  const boxes = input.boxes ?? (await getActiveBoxes());
  if (boxes.length === 0) throw new ShippingError(503, 'No shipping boxes are set up yet.', 'no_boxes');

  const shipDate = nextShipDate(new Date(), settings.shipWeekday);
  const key = cacheKey(summary.cans, summary.cansWeightOz, to, settings, shipDate);
  const hit = quoteCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.quote;

  const perCan = summary.cansWeightOz / summary.cans;
  const packed = packCans(summary.cans, boxes.map((b) => ({ id: b.id, name: b.name, canCapacity: b.canCapacity })));
  const stub = !SHIPPO_KEY;
  if (!stub) await validateAddress(to);

  const quoted: QuotedBox[] = [];
  for (const p of packed) {
    const box = boxes.find((b) => b.id === p.box.id)!;
    const cansWeight = p.cans * perCan;
    const packagingCents = box.packagingFeeCents + settings.flatFeeCents;
    if (stub) {
      const { weightOz } = parcelFor(box, p.cans, cansWeight);
      // Stand-in: roughly what a ground box costs by weight ($6 + 6c/oz: a 31 lb
      // 24-can box lands near $36, a 17 lb 12-can box near $22). Clearly flagged.
      const carrierCents = Math.round((600 + weightOz * 6) * (1 + settings.markupPercent / 100));
      quoted.push({ boxId: box.id, boxName: box.name, cans: p.cans, weightOz, rateId: null, carrier: 'USPS', service: 'Ground Advantage (test rate)', serviceToken: 'usps_ground_advantage', estimatedDays: 2, carrierCents, packagingCents });
      continue;
    }
    const { rate, weightOz, all } = await rateBox(settings, to, box, p.cans, cansWeight, shipDate, input.email);
    if (!rate) {
      const fastest = all.filter((r) => r.estimated_days != null).sort((a, b) => a.estimated_days! - b.estimated_days!)[0];
      const hint = fastest ? ` The fastest service to you takes ${fastest.estimated_days} days.` : '';
      throw new ShippingError(400, `Sorry — we can't get cold-packed kombucha to that address within ${settings.maxTransitDays} days.${hint}`, 'no_service');
    }
    const carrierCents = Math.round(Number(rate.amount) * 100 * (1 + settings.markupPercent / 100));
    quoted.push({ boxId: box.id, boxName: box.name, cans: p.cans, weightOz, rateId: rate.object_id, carrier: rate.provider, service: rate.servicelevel?.name ?? rate.servicelevel?.token ?? 'Standard', serviceToken: rate.servicelevel?.token ?? null, estimatedDays: rate.estimated_days, carrierCents, packagingCents });
  }

  const carrierCents = quoted.reduce((s, b) => s + b.carrierCents, 0);
  const packagingCents = quoted.reduce((s, b) => s + b.packagingCents, 0);
  const quote: ShippingQuote = {
    boxes: quoted,
    carrierCents,
    packagingCents,
    totalCents: carrierCents + packagingCents,
    shipDate: shipDate.toISOString(),
    estimatedDays: quoted.reduce<number | null>((m, b) => (b.estimatedDays == null ? m : Math.max(m ?? 0, b.estimatedDays)), null),
    settingsVersion: settings.version,
    ...(stub ? { stub: true } : {}),
  };
  quoteCache.set(key, { quote, expires: Date.now() + QUOTE_TTL_MS });
  return quote;
}

// ---------------------------------------------------------------------------
// Tax (Stripe Tax, destination-based; WA-flat fallback when unreachable)
// ---------------------------------------------------------------------------

let lastTaxFallbackWarn = 0;

export async function calculateShippedOrderTax(stripe: Stripe | null, input: {
  subtotalCents: number;
  shippingCents: number;
  to: ShippingAddress;
  settings: ShippingSettings;
}): Promise<{ taxCents: number; calculationId: string | null; source: 'stripe_tax' | 'fallback'; rateBps: number }> {
  const fallback = () => {
    // Washington taxes delivery charges on taxable goods along with the goods;
    // outside Washington nothing is collected (nexus is the owner's call).
    const taxable = input.to.state === 'WA' ? input.subtotalCents + input.shippingCents : 0;
    const taxCents = Math.round(taxable * FALLBACK_WA_RATE);
    return { taxCents, calculationId: null, source: 'fallback' as const, rateBps: input.to.state === 'WA' ? Math.round(FALLBACK_WA_RATE * 10000) : 0 };
  };
  if (!stripe) return fallback();
  try {
    const calc = await stripe.tax.calculations.create({
      currency: 'usd',
      line_items: [{
        amount: input.subtotalCents,
        reference: 'kombucha-cans',
        tax_behavior: 'exclusive',
        ...(input.settings.stripeTaxCode ? { tax_code: input.settings.stripeTaxCode } : {}),
      }],
      shipping_cost: { amount: input.shippingCents },
      customer_details: {
        address: {
          line1: input.to.address1,
          line2: input.to.address2 || undefined,
          city: input.to.city,
          state: input.to.state,
          postal_code: input.to.zip,
          country: 'US',
        },
        address_source: 'shipping',
      },
    });
    const taxCents = calc.tax_amount_exclusive ?? 0;
    const base = input.subtotalCents + input.shippingCents;
    return { taxCents, calculationId: calc.id ?? null, source: 'stripe_tax', rateBps: base > 0 ? Math.round((taxCents / base) * 10000) : 0 };
  } catch (e: any) {
    const now = Date.now();
    if (now - lastTaxFallbackWarn > 60 * 60 * 1000) {
      lastTaxFallbackWarn = now;
      console.warn(`[SHIPPING] Stripe Tax unavailable, using WA-flat fallback: ${e?.message ?? e}`);
      recordEvent({ severity: 'warn', kind: 'stripe_tax_fallback', message: `Stripe Tax calculation failed; shipped orders are being taxed with the WA flat fallback. ${e?.message ?? ''}`.trim() }).catch(() => {});
    }
    return fallback();
  }
}

/** After payment, register the calculation as a Stripe Tax transaction so it lands in tax reports. Best effort. */
export async function commitStripeTaxTransaction(stripe: Stripe | null, calculationId: string | null, reference: string): Promise<string | null> {
  if (!stripe || !calculationId) return null;
  try {
    const tx = await stripe.tax.transactions.createFromCalculation({ calculation: calculationId, reference });
    return tx.id;
  } catch (e: any) {
    console.warn(`[SHIPPING] Stripe Tax transaction not recorded for ${reference}: ${e?.message ?? e}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

type ShippoTransaction = {
  object_id: string;
  status: 'SUCCESS' | 'ERROR' | 'QUEUED' | 'WAITING';
  tracking_number?: string;
  tracking_url_provider?: string;
  label_url?: string;
  messages?: Array<{ text?: string; code?: string }>;
  rate?: string | { object_id: string; amount?: string };
};

async function buyLabel(rateId: string): Promise<ShippoTransaction> {
  return shippo<ShippoTransaction>('/transactions/', { rate: rateId, label_file_type: 'PNG', async: false });
}

function orderShipTo(order: RetailOrder): ShippingAddress {
  return {
    name: order.shipName ?? order.customerName,
    address1: order.shipAddress1 ?? '',
    address2: order.shipAddress2,
    city: order.shipCity ?? '',
    state: order.shipState ?? '',
    zip: order.shipZip ?? '',
    phone: order.shipPhone ?? order.customerPhone,
  };
}

/** Orders whose labels are being bought right now, in this process. Railway runs
 *  one process, so this is the whole guard against a double tap; nothing is
 *  written to the row to mark "in progress", so there is no claim to abandon. */
const labelsInFlight = new Set<string>();

/**
 * Buy one label per box for a shipped order and record them. Resumable and
 * per-box (reviewer, 2026-10-06): each label is persisted the moment it is
 * bought, so a failure on box 2 keeps box 1's label and a retry buys only the
 * boxes still missing. Labels are rated from the ORDER's final address and the
 * quoted service, never from the checkout-time rate id, so an address or name
 * correction (or an expired rate) can't print the wrong label.
 * Does NOT change status — the caller flips it to fulfilled (which deducts stock)
 * once every box has a label.
 */
export async function purchaseLabelsForOrder(orderId: string): Promise<{ order: RetailOrder; labels: ShippingLabel[]; alreadyHad: boolean }> {
  if (labelsInFlight.has(orderId)) throw new ShippingError(409, 'Labels for this order are already being bought.');
  labelsInFlight.add(orderId);
  try {
    const [order] = await db.select().from(retailOrders).where(and(eq(retailOrders.id, orderId), isNull(retailOrders.deletedAt)));
    if (!order) throw new ShippingError(404, 'Order not found');
    if (order.fulfillmentMethod !== 'ship') throw new ShippingError(400, 'This is a pickup order — nothing to label.');
    if (order.status === 'cancelled') throw new ShippingError(400, 'This order is cancelled.');
    const quote = order.shippingQuote as ShippingQuote | null;
    if (!quote || quote.boxes.length === 0) throw new ShippingError(400, 'This order has no shipping quote to buy labels from.');

    const labels: ShippingLabel[] = [...(((order.shippingLabels as ShippingLabel[] | null) ?? []))];
    if (labels.length >= quote.boxes.length) return { order, labels, alreadyHad: true };

    const settings = await getShippingSettings();
    const to = orderShipTo(order);
    const allBoxes = await getAllBoxes();
    const shipDate = new Date(Math.max(Date.now(), new Date(quote.shipDate).getTime()));

    for (let i = labels.length; i < quote.boxes.length; i++) {
      const box = quote.boxes[i];
      let label: ShippingLabel;
      if (!SHIPPO_KEY) {
        label = {
          boxName: box.boxName, cans: box.cans, carrier: box.carrier, service: box.service,
          trackingNumber: `TEST${Date.now().toString(36).toUpperCase()}${i + 1}`,
          trackingUrl: null, labelUrl: null, transactionId: null, amountCents: box.carrierCents,
        };
      } else {
        const boxRow = allBoxes.find((b) => b.id === box.boxId);
        if (!boxRow) throw new ShippingError(500, `Shipping box ${box.boxName} no longer exists`);
        const perCan = box.cans > 0
          ? (box.weightOz - Number(boxRow.tareWeightOz) - boxRow.icePackCount * Number(boxRow.icePackWeightOz)) / box.cans
          : settings.defaultCanWeightOz;
        const { rate } = await rateBox(settings, to, boxRow, box.cans, box.cans * Math.max(1, perCan), shipDate, order.customerEmail, box.serviceToken);
        if (!rate) throw new ShippingError(502, `No service within ${settings.maxTransitDays} days is available any more for ${box.boxName}.`);
        const tx = await buyLabel(rate.object_id);
        if (tx.status !== 'SUCCESS') {
          const why = (tx.messages ?? []).map((m) => m.text).filter(Boolean).join(' ');
          throw new ShippingError(502, `Carrier refused the label for ${box.boxName}: ${why || tx.status}`);
        }
        label = {
          boxName: box.boxName, cans: box.cans, carrier: rate.provider, service: rate.servicelevel?.name ?? box.service,
          trackingNumber: tx.tracking_number ?? '',
          trackingUrl: tx.tracking_url_provider ?? null,
          labelUrl: tx.label_url ?? null,
          transactionId: tx.object_id,
          amountCents: Math.round(Number(rate.amount) * 100),
        };
      }
      labels.push(label);
      // Persist this label before touching the next box: a bought label is money.
      await db.update(retailOrders).set({ shippingLabels: labels, updatedAt: new Date() }).where(eq(retailOrders.id, orderId));
    }

    const [updated] = await db
      .update(retailOrders)
      .set({ shippedAt: new Date(), updatedAt: new Date() })
      .where(eq(retailOrders.id, orderId))
      .returning();
    return { order: updated, labels, alreadyHad: false };
  } finally {
    labelsInFlight.delete(orderId);
  }
}

/** The receipt email's shipping block for a stored order; undefined for pickups. */
export function receiptShippingFor(order: RetailOrder) {
  if (order.fulfillmentMethod !== 'ship') return undefined;
  const q = order.shippingQuote as ShippingQuote | null;
  const b = q?.boxes?.[0];
  return {
    amount: Number(order.shippingAmount ?? 0),
    name: order.shipName ?? order.customerName,
    addressLines: [
      [order.shipAddress1, order.shipAddress2].filter(Boolean).join(', '),
      `${order.shipCity ?? ''}, ${order.shipState ?? ''} ${order.shipZip ?? ''}`.trim(),
    ],
    shipDate: order.pickupDate ? formatShipDate(order.pickupDate) : 'Monday',
    service: b ? `${b.carrier} ${b.service}` : 'carrier',
  };
}

// ---------------------------------------------------------------------------
// Monday batch outputs: merged 4x6 PDF for the Dymo, CSV for Dymo Connect stickers
// ---------------------------------------------------------------------------

export type OrderContents = Array<{ label: string; quantity: number }>;

export async function contentsForOrders(orderIds: string[]): Promise<Map<string, OrderContents>> {
  const out = new Map<string, OrderContents>();
  if (orderIds.length === 0) return out;
  const rows = await db
    .select({
      orderId: retailOrderItemsV2.orderId,
      quantity: retailOrderItemsV2.quantity,
      flavorName: flavors.name,
      unitDescription: retailProducts.unitDescription,
      notes: retailOrderItemsV2.notes,
    })
    .from(retailOrderItemsV2)
    .innerJoin(retailProducts, eq(retailProducts.id, retailOrderItemsV2.retailProductId))
    .leftJoin(flavors, eq(flavors.id, sql`COALESCE(${retailOrderItemsV2.selectedFlavorId}, ${retailProducts.flavorId})`))
    .where(inArray(retailOrderItemsV2.orderId, orderIds));
  for (const r of rows) {
    const split = /^Split: 6 (.+) \/ 6 (.+)$/.exec(r.notes ?? '');
    const label = split ? `${split[1]} / ${split[2]} — ${r.unitDescription}` : `${r.flavorName ?? 'Mixed'} — ${r.unitDescription}`;
    const arr = out.get(r.orderId) ?? [];
    arr.push({ label, quantity: r.quantity });
    out.set(r.orderId, arr);
  }
  return out;
}

const LABEL_W = 288; // 4in at 72pt
const LABEL_H = 432; // 6in

async function fetchImage(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Every label for the given orders as one PDF, one 4x6 page per box, in order.
 * Prints straight to a LabelWriter 4XL/5XL. Carrier PNGs are placed as-is; a
 * label without an image (stub mode, or a fetch that failed) gets a drawn page
 * so the batch count still matches the boxes on the bench.
 */
export async function buildLabelsPdf(orders: RetailOrder[], contents: Map<string, OrderContents>): Promise<Buffer> {
  const doc = new PDFDocument({ size: [LABEL_W, LABEL_H], margin: 0, autoFirstPage: false });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  for (const order of orders) {
    const labels = (order.shippingLabels as ShippingLabel[] | null) ?? [];
    for (let i = 0; i < labels.length; i++) {
      const label = labels[i];
      doc.addPage();
      const img = label.labelUrl ? await fetchImage(label.labelUrl) : null;
      if (img) {
        try {
          doc.image(img, 0, 0, { fit: [LABEL_W, LABEL_H], align: 'center', valign: 'center' });
          continue;
        } catch {
          /* fall through to the drawn page */
        }
      }
      const to = orderShipTo(order);
      doc.rect(8, 8, LABEL_W - 16, LABEL_H - 16).lineWidth(1.5).stroke();
      doc.font('Helvetica-Bold').fontSize(13).text(label.labelUrl ? 'LABEL IMAGE UNAVAILABLE' : 'TEST LABEL — NOT POSTAGE', 16, 20, { width: LABEL_W - 32, align: 'center' });
      doc.font('Helvetica').fontSize(9).text(`${label.carrier} ${label.service}`, 16, 42, { width: LABEL_W - 32, align: 'center' });
      doc.moveTo(16, 60).lineTo(LABEL_W - 16, 60).stroke();
      doc.fontSize(9).text('FROM', 16, 68);
      const s = await getShippingSettings();
      doc.fontSize(10).text(`${s.shipFrom.company || s.shipFrom.name}\n${s.shipFrom.street1}\n${s.shipFrom.city}, ${s.shipFrom.state} ${s.shipFrom.zip}`, 16, 80);
      doc.fontSize(9).text('SHIP TO', 16, 140);
      doc.font('Helvetica-Bold').fontSize(14).text(to.name, 16, 152, { width: LABEL_W - 32 });
      doc.font('Helvetica').fontSize(13).text(`${to.address1}${to.address2 ? `\n${to.address2}` : ''}\n${to.city}, ${to.state} ${to.zip}`, 16, 172, { width: LABEL_W - 32 });
      doc.moveTo(16, 260).lineTo(LABEL_W - 16, 260).stroke();
      doc.fontSize(10).text(`Order #${order.orderNumber}  ·  Box ${i + 1} of ${labels.length}  ·  ${label.boxName}`, 16, 270, { width: LABEL_W - 32 });
      const items = (contents.get(order.id) ?? []).map((c) => `${c.quantity} × ${c.label}`).join('\n');
      doc.fontSize(9).text(items, 16, 288, { width: LABEL_W - 32, height: 90 });
      doc.font('Helvetica-Bold').fontSize(11).text(`Tracking: ${label.trackingNumber}`, 16, 385, { width: LABEL_W - 32 });
      doc.font('Helvetica-Bold').fontSize(12).text('PERISHABLE — KEEP REFRIGERATED', 16, 404, { width: LABEL_W - 32, align: 'center' });
    }
  }
  if (orders.every((o) => (((o.shippingLabels as ShippingLabel[] | null) ?? []).length === 0))) {
    doc.addPage();
    doc.font('Helvetica').fontSize(12).text('No labels have been bought for this batch yet.', 16, 200, { width: LABEL_W - 32, align: 'center' });
  }
  doc.end();
  return done;
}

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * One row per box for Dymo Connect's import: the in-house stickers (perishable
 * warning, contents) that go on the box beside the postage label. Also serves
 * as the packing list.
 */
export function buildStickersCsv(orders: RetailOrder[], contents: Map<string, OrderContents>): string {
  const header = ['Order', 'Customer', 'Box', 'BoxOf', 'Shipper', 'Cans', 'Contents', 'ShipDate', 'Carrier', 'Service', 'Tracking', 'Address', 'City', 'State', 'Zip', 'Phone', 'Warning'];
  const lines = [header.join(',')];
  for (const o of orders) {
    const labels = (o.shippingLabels as ShippingLabel[] | null) ?? [];
    const quote = o.shippingQuote as ShippingQuote | null;
    const boxes = labels.length > 0 ? labels : (quote?.boxes ?? []).map((b) => ({ boxName: b.boxName, cans: b.cans, carrier: b.carrier, service: b.service, trackingNumber: '' }));
    const items = (contents.get(o.id) ?? []).map((c) => `${c.quantity} × ${c.label}`).join('; ');
    boxes.forEach((b, i) => {
      lines.push([
        `#${o.orderNumber}`, o.shipName ?? o.customerName, i + 1, boxes.length, b.boxName, b.cans, items,
        o.pickupDate ? new Date(o.pickupDate).toISOString().slice(0, 10) : '',
        b.carrier, b.service, b.trackingNumber,
        [o.shipAddress1, o.shipAddress2].filter(Boolean).join(', '), o.shipCity ?? '', o.shipState ?? '', o.shipZip ?? '', o.shipPhone ?? o.customerPhone,
        'PERISHABLE - KEEP REFRIGERATED',
      ].map(csvCell).join(','));
    });
  }
  return lines.join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Tracking webhook (Shippo "track_updated")
// ---------------------------------------------------------------------------

export async function handleTrackingUpdate(payload: any): Promise<{ matched: boolean; delivered: boolean }> {
  const tracking: string | undefined = payload?.data?.tracking_number ?? payload?.tracking_number;
  const status: string | undefined = payload?.data?.tracking_status?.status ?? payload?.tracking_status?.status;
  if (!tracking) return { matched: false, delivered: false };
  const [order] = await db
    .select()
    .from(retailOrders)
    .where(sql`${retailOrders.shippingLabels} @> ${JSON.stringify([{ trackingNumber: tracking }])}::jsonb`);
  if (!order) return { matched: false, delivered: false };
  if (status === 'DELIVERED' && !order.deliveredAt) {
    await db.update(retailOrders).set({ deliveredAt: new Date(), updatedAt: new Date() }).where(eq(retailOrders.id, order.id));
    return { matched: true, delivered: true };
  }
  return { matched: true, delivered: false };
}
