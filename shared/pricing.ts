export const PRICING = {
  CASE_ONE_TIME: 40,
  CASE_SUBSCRIPTION: 36,
  SUBSCRIPTION_DISCOUNT_PERCENT: 10,
  BOTTLES_PER_CASE: 12,
} as const;

export const CASE_SIZE = PRICING.BOTTLES_PER_CASE;

export type SubscriptionFrequency = 'weekly' | 'bi-weekly';

export function getCasePrice(isSubscription: boolean): number {
  return isSubscription ? PRICING.CASE_SUBSCRIPTION : PRICING.CASE_ONE_TIME;
}

export function getCasePriceCents(isSubscription: boolean): number {
  return getCasePrice(isSubscription) * 100;
}

export function casesToBottles(cases: number): number {
  return cases * CASE_SIZE;
}

export function bottlesToCases(bottles: number): number {
  return Math.ceil(bottles / CASE_SIZE);
}

export function formatCaseQuantity(cases: number): string {
  const bottles = casesToBottles(cases);
  if (cases === 1) {
    return `1 case (${bottles} bottles)`;
  }
  return `${cases} cases (${bottles} bottles)`;
}

export function formatBottleQuantity(bottles: number): string {
  if (bottles < CASE_SIZE) {
    return `${bottles} bottles`;
  }
  const cases = Math.floor(bottles / CASE_SIZE);
  const remaining = bottles % CASE_SIZE;
  if (remaining === 0) {
    return formatCaseQuantity(cases);
  }
  return `${cases} cases + ${remaining} bottles (${bottles} bottles total)`;
}
