export const PRICING = {
  CASE_ONE_TIME: 40,
  CASE_SUBSCRIPTION: 36,
  SUBSCRIPTION_DISCOUNT_PERCENT: 10,
  BOTTLES_PER_CASE: 12,
} as const;

export type SubscriptionFrequency = 'weekly' | 'bi-weekly';

export function getCasePrice(isSubscription: boolean): number {
  return isSubscription ? PRICING.CASE_SUBSCRIPTION : PRICING.CASE_ONE_TIME;
}

export function getCasePriceCents(isSubscription: boolean): number {
  return getCasePrice(isSubscription) * 100;
}
