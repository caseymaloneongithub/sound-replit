/**
 * Single source of truth for subscription cadence.
 *
 * This used to be re-implemented as a 3-branch ternary in ~16 places, all of which
 * silently fell through to 28 days for anything they didn't recognise. That meant
 * "Every 8 weeks" billed every 4, and the product page's "Quarterly" billed monthly.
 * Every conversion (days, Stripe interval, display label) now comes from here.
 */
import { z } from "zod";

export const SUBSCRIPTION_FREQUENCIES = [
  "weekly",
  "bi-weekly",
  "every-4-weeks",
  "every-6-weeks",
  "every-8-weeks",
] as const;

export type SubscriptionFrequency = (typeof SUBSCRIPTION_FREQUENCIES)[number];

const FREQUENCY_WEEKS: Record<SubscriptionFrequency, number> = {
  "weekly": 1,
  "bi-weekly": 2,
  "every-4-weeks": 4,
  "every-6-weeks": 6,
  "every-8-weeks": 8,
};

const FREQUENCY_LABELS: Record<SubscriptionFrequency, string> = {
  "weekly": "Weekly",
  "bi-weekly": "Every 2 weeks",
  "every-4-weeks": "Every 4 weeks",
  "every-6-weeks": "Every 6 weeks",
  "every-8-weeks": "Every 8 weeks",
};

/** Short form for tight spaces, e.g. "$40.00 / 2 wks". */
const FREQUENCY_SHORT: Record<SubscriptionFrequency, string> = {
  "weekly": "wk",
  "bi-weekly": "2 wks",
  "every-4-weeks": "4 wks",
  "every-6-weeks": "6 wks",
  "every-8-weeks": "8 wks",
};

/** Legacy/alias spellings that older UI wrote. Normalised on the way in. */
const ALIASES: Record<string, SubscriptionFrequency> = {
  biweekly: "bi-weekly",
  "every-2-weeks": "bi-weekly",
  monthly: "every-4-weeks",
  "4-weeks": "every-4-weeks",
  quarterly: "every-8-weeks", // closest supported cadence
};

export function isSubscriptionFrequency(v: unknown): v is SubscriptionFrequency {
  return typeof v === "string" && (SUBSCRIPTION_FREQUENCIES as readonly string[]).includes(v);
}

/**
 * Coerce any stored/legacy value to a supported cadence.
 * Throws on anything unrecognised — silently defaulting is what caused the
 * mis-billing in the first place.
 */
export function normalizeFrequency(value: string | null | undefined): SubscriptionFrequency {
  if (isSubscriptionFrequency(value)) return value;
  const alias = value ? ALIASES[value.toLowerCase()] : undefined;
  if (alias) return alias;
  throw new Error(
    `Unsupported subscription frequency: ${JSON.stringify(value)}. ` +
      `Expected one of: ${SUBSCRIPTION_FREQUENCIES.join(", ")}`
  );
}

/** Days between deliveries/charges. */
export function frequencyToDays(value: string | null | undefined): number {
  return FREQUENCY_WEEKS[normalizeFrequency(value)] * 7;
}

/** Stripe recurring interval — always expressed in weeks. */
export function frequencyToStripeInterval(value: string | null | undefined): {
  interval: "week";
  interval_count: number;
} {
  return { interval: "week", interval_count: FREQUENCY_WEEKS[normalizeFrequency(value)] };
}

/** Human label, e.g. "Every 2 weeks". Never throws — falls back to the raw value. */
export function frequencyLabel(value: string | null | undefined): string {
  try {
    return FREQUENCY_LABELS[normalizeFrequency(value)];
  } catch {
    return String(value ?? "—");
  }
}

/** Short human label, e.g. "2 wks". Never throws. */
export function frequencyShortLabel(value: string | null | undefined): string {
  try {
    return FREQUENCY_SHORT[normalizeFrequency(value)];
  } catch {
    return String(value ?? "—");
  }
}

/** Options for a <Select>, in cadence order. */
export const FREQUENCY_OPTIONS: { value: SubscriptionFrequency; label: string }[] =
  SUBSCRIPTION_FREQUENCIES.map((value) => ({ value, label: FREQUENCY_LABELS[value] }));

/** Zod schema for validating inbound API payloads. */
export const subscriptionFrequencySchema = z.enum(SUBSCRIPTION_FREQUENCIES);
