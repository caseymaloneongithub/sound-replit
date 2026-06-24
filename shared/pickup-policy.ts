import { addDays } from 'date-fns';
import { toZonedTime, formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const PICKUP_POLICY = {
  allowedWeekdays: [1, 2, 3, 4] as number[], // Monday through Thursday (0 = Sunday, 1 = Monday, etc.)
  timeWindow: '9:00am to 3:00pm',
  address: '4501 Shilshole Ave NW',
  instructions: 'At the back of the building at the garage door',
  phone: '206-789-5219',
  phoneFormatted: '(206) 789-5219',
  callInstructions: 'Please call when you arrive',
  timezone: 'America/Los_Angeles',
} as const;

/**
 * Normalizes a date to the next allowed pickup day (Monday-Thursday).
 * If the date falls on a Friday, Saturday, or Sunday, it advances to the next Monday.
 * 
 * @param date - The date to normalize (in UTC or any timezone)
 * @returns A new Date object set to midnight Pacific time on an allowed pickup day
 */
export function normalizeToAllowedPickupDay(date: Date): Date {
  // Get the Pacific date string directly from the original timestamp — this is always correct
  // regardless of what time-of-day the input is (avoids toZonedTime+addDays+formatInTimeZone drift).
  const dateStr = formatInTimeZone(date, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  const [y, m, d] = dateStr.split('-').map(Number);

  // Use a noon-UTC anchor for the day-of-week lookup so the UTC day matches the Pacific day
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = noonUTC.getUTCDay(); // 0 = Sunday, 1 = Monday, …, 6 = Saturday

  // Days to advance to the next allowed pickup day (Monday)
  const daysToAdd =
    dayOfWeek === 0 ? 1 : // Sunday  → Monday
    dayOfWeek === 5 ? 3 : // Friday  → Monday
    dayOfWeek === 6 ? 2 : // Saturday → Monday
    0;                     // Mon–Thu already allowed

  const targetNoon = new Date(Date.UTC(y, m - 1, d + daysToAdd, 12, 0, 0));
  const targetStr = formatInTimeZone(targetNoon, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  return fromZonedTime(`${targetStr}T00:00:00`, PICKUP_POLICY.timezone);
}

/**
 * Checks if a date falls on an allowed pickup day (Monday-Thursday).
 * 
 * @param date - The date to check
 * @returns true if the date is Monday-Thursday, false otherwise
 */
export function isAllowedPickupDay(date: Date): boolean {
  const pacificDate = toZonedTime(date, PICKUP_POLICY.timezone);
  const dayOfWeek = pacificDate.getDay();
  return PICKUP_POLICY.allowedWeekdays.includes(dayOfWeek);
}

/**
 * Gets the day name (e.g., "Monday", "Friday") for a given date.
 * 
 * @param date - The date to get the day name for
 * @returns The day name
 */
export function getDayName(date: Date): string {
  return formatInTimeZone(date, PICKUP_POLICY.timezone, 'EEEE');
}

/**
 * Converts a subscription frequency string to the number of days between pickups.
 * This is the single source of truth for frequency-to-days mapping.
 */
export function frequencyToDays(frequency: string): number {
  switch (frequency) {
    case 'weekly':       return 7;
    case 'bi-weekly':    return 14;
    case 'every-4-weeks': return 28;
    case 'every-6-weeks': return 42;
    case 'every-8-weeks': return 56;
    default:             return 7;
  }
}

/**
 * Advances a pickup date by one subscription interval, then normalizes to an
 * allowed pickup day. Always advances from the *scheduled* date, not from now,
 * so dates never drift even if billing fires late.
 */
export function nextPickupDateFromScheduled(currentPickupDate: Date, frequency: string): Date {
  const days = frequencyToDays(frequency);
  return normalizeToAllowedPickupDay(addDays(currentPickupDate, days));
}

/**
 * Calculates the billing date (Monday morning) for a given pickup date.
 * Billing always happens on the Monday of the pickup week:
 * - If pickup is Monday, billing is that Monday
 * - If pickup is Tuesday-Thursday, billing is the Monday of that week
 * 
 * @param pickupDate - The scheduled pickup date (should be Monday-Thursday)
 * @returns A new Date object set to 4 AM Pacific time on the Monday of the pickup week
 */
export function getBillingDateForPickup(pickupDate: Date): Date {
  // Get the Pacific date string directly — avoids toZonedTime+addDays+formatInTimeZone drift
  // that occurs when the input is exactly midnight Pacific (07:00 UTC in PDT).
  const pickupStr = formatInTimeZone(pickupDate, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  const [y, m, d] = pickupStr.split('-').map(Number);

  // Noon-UTC anchor: unambiguous day-of-week lookup (Pacific is at most UTC-8)
  const noonUTC = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const dayOfWeek = noonUTC.getUTCDay(); // 0 = Sunday, 1 = Monday, …

  // Days to go back to the Monday of the pickup week
  const daysToSubtract =
    dayOfWeek === 2 ? 1 : // Tuesday  → Monday
    dayOfWeek === 3 ? 2 : // Wednesday → Monday
    dayOfWeek === 4 ? 3 : // Thursday  → Monday
    0;                     // Monday (or unexpected) — use as-is

  const mondayNoon = new Date(Date.UTC(y, m - 1, d - daysToSubtract, 12, 0, 0));
  const mondayStr = formatInTimeZone(mondayNoon, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  // Billing runs at 4 AM Pacific time on Monday
  return fromZonedTime(`${mondayStr}T04:00:00`, PICKUP_POLICY.timezone);
}
