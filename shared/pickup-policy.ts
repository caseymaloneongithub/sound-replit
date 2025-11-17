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
  const pacificDate = toZonedTime(date, PICKUP_POLICY.timezone);
  const dayOfWeek = pacificDate.getDay(); // 0 = Sunday, 1 = Monday, etc.
  
  // If already Monday-Thursday (1-4), keep it
  if (PICKUP_POLICY.allowedWeekdays.includes(dayOfWeek)) {
    // Return midnight Pacific time using timezone-aware conversion
    const dateStr = formatInTimeZone(pacificDate, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
    return fromZonedTime(`${dateStr}T00:00:00`, PICKUP_POLICY.timezone);
  }
  
  // Calculate days to advance to next Monday
  let daysToAdd: number;
  if (dayOfWeek === 0) { // Sunday
    daysToAdd = 1; // Move to Monday
  } else if (dayOfWeek === 5) { // Friday
    daysToAdd = 3; // Move to Monday
  } else if (dayOfWeek === 6) { // Saturday
    daysToAdd = 2; // Move to Monday
  } else {
    daysToAdd = 0; // Should never happen if allowedWeekdays is correct
  }
  
  const adjustedDate = addDays(pacificDate, daysToAdd);
  const dateStr = formatInTimeZone(adjustedDate, PICKUP_POLICY.timezone, 'yyyy-MM-dd');
  // Use timezone-aware conversion to handle DST correctly
  return fromZonedTime(`${dateStr}T00:00:00`, PICKUP_POLICY.timezone);
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
