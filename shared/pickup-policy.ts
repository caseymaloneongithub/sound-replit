import { addDays } from 'date-fns';
import { toZonedTime, formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { frequencyToDays } from './subscription-frequency';

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
 * Returns the half-open date range for a Monday-anchored week in Pacific time.
 *
 * `offsetWeeks` shifts by whole weeks from the current week (0 = this week, -1 = last,
 * +1 = next). The range is [Monday 00:00 Pacific, next Monday 00:00 Pacific), which is the
 * same week definition billing and pickups already use, so the orders board lines up with
 * the rest of the app.
 *
 * All day arithmetic happens on noon-UTC anchors of the current PACIFIC calendar date —
 * the same technique as normalizeToAllowedPickupDay above. An earlier version ran the
 * clock through timezone conversion twice (toZonedTime, then formatInTimeZone), which
 * shifted the anchor a second time on any server not already in Pacific: on a UTC deploy
 * the "Monday" landed on Sunday for the first 7-8 hours of every Pacific day.
 */
export function getPacificWeekRange(offsetWeeks = 0): { start: Date; end: Date; mondayISO: string } {
  const todayStr = formatInTimeZone(new Date(), PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  const [y, m, d] = todayStr.split('-').map(Number);
  const todayNoon = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const daysSinceMonday = (todayNoon.getUTCDay() + 6) % 7; // Monday -> 0 ... Sunday -> 6

  const mondayNoon = new Date(Date.UTC(y, m - 1, d - daysSinceMonday + offsetWeeks * 7, 12, 0, 0));
  const nextMondayNoon = new Date(Date.UTC(y, m - 1, d - daysSinceMonday + (offsetWeeks + 1) * 7, 12, 0, 0));

  // A noon-UTC anchor carries its calendar date in the UTC fields directly.
  const mondayStr = mondayNoon.toISOString().slice(0, 10);
  const nextMondayStr = nextMondayNoon.toISOString().slice(0, 10);

  return {
    start: fromZonedTime(`${mondayStr}T00:00:00`, PICKUP_POLICY.timezone),
    end: fromZonedTime(`${nextMondayStr}T00:00:00`, PICKUP_POLICY.timezone),
    mondayISO: mondayStr,
  };
}

/**
 * Advances a pickup date by one subscription interval, then normalizes to an
 * allowed pickup day. Always advances from the *scheduled* date, not from now,
 * so dates never drift even if billing fires late.
 *
 * Frequency conversion lives in shared/subscription-frequency (the single source of
 * truth, with alias handling and validation). A duplicate implementation that briefly
 * lived here silently defaulted unknown values to WEEKLY — which would bill 4x too
 * often on bad data — and was removed in favor of the shared module, which throws.
 */
export function nextPickupDateFromScheduled(currentPickupDate: Date, frequency: string): Date {
  return normalizeToAllowedPickupDay(addDays(currentPickupDate, frequencyToDays(frequency)));
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
