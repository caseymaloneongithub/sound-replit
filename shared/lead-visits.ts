/*
 * Visit tags on leads (owner, 2026-10-05: "add something to the leads to tag it
 * for a visit this week. Then it flows as an option to add to the delivery
 * route."). A tag names a week by its Monday ("2026-10-05"); the Routes page
 * offers that week's tagged leads as stops on any day of it, and Driver Mode
 * marks the stop visited.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const utcDay = (date: string): number => {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/** The Monday ("YYYY-MM-DD") of the week a calendar date ("YYYY-MM-DD") falls in. */
export function weekMondayOf(date: string): string {
  const day = utcDay(date);
  const sinceMonday = (new Date(day).getUTCDay() + 6) % 7;
  return new Date(day - sinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** The week as staff read it: "Oct 5 – 11", or "Sep 28 – Oct 4" across a month end. */
export function visitWeekLabel(monday: string): string {
  const start = new Date(utcDay(monday));
  const end = new Date(utcDay(monday) + 6 * DAY_MS);
  const day = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${day(start)} – ${end.getUTCDate()}`
    : `${day(start)} – ${day(end)}`;
}

/** The touch point a visit leaves on the lead; undoing the visit removes the latest one. */
export const VISIT_TOUCH_POINT_SUBJECT = "Visited on the delivery route";
/** The same, for a visit marked straight from the leads sheet — a drop-in on
 *  the owner's own time, no route involved (owner, 2026-10-07). */
export const DROP_IN_TOUCH_POINT_SUBJECT = "Visited";
