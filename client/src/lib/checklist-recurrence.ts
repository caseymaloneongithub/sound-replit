import { startOfDay, getDay, getDate, getMonth, eachDayOfInterval } from "date-fns";
import type { AdminTask } from "@shared/schema";

/**
 * When is a recurring task due? Shared by the Weekly Checklist page and the sidebar's
 * overdue-count badge — one copy of the recurrence rules, so the badge and the page can
 * never disagree about what counts as overdue.
 */
export function isTaskDueOnDate(task: AdminTask, date: Date): boolean {
  // Check if date is within task's start/end date range
  if (task.startDate) {
    const startDate = startOfDay(new Date(task.startDate));
    if (date < startDate) return false;
  }
  if (task.endDate) {
    const endDate = startOfDay(new Date(task.endDate));
    if (date > endDate) return false;
  }

  const dayOfWeek = getDay(date);
  const dayOfMonth = getDate(date);
  const month = getMonth(date) + 1; // getMonth returns 0-11

  switch (task.recurrence) {
    case "daily":
      return true;
    case "weekly":
      return task.dayOfWeek === dayOfWeek;
    case "monthly":
      return task.dayOfMonth === dayOfMonth;
    case "quarterly": {
      // Quarters: Jan (1), Apr (4), Jul (7), Oct (10)
      const quarterMonths = [1, 4, 7, 10];
      return quarterMonths.includes(month) && task.dayOfMonth === dayOfMonth;
    }
    case "yearly":
      return task.monthOfYear === month && task.dayOfMonth === dayOfMonth;
    case "one-time":
      // One-time tasks show on the specific date stored in dayOfMonth/monthOfYear or on creation date
      if (task.dayOfMonth && task.monthOfYear) {
        // Use current year since one-time doesn't specify year
        const taskDate = new Date(date.getFullYear(), task.monthOfYear - 1, task.dayOfMonth);
        return startOfDay(taskDate).getTime() === startOfDay(date).getTime();
      }
      // Fallback: show on creation date
      if (task.createdAt) {
        return startOfDay(new Date(task.createdAt)).getTime() === startOfDay(date).getTime();
      }
      return false;
    default:
      return false;
  }
}

export function isTaskDueInWeek(task: AdminTask, weekStart: Date, weekEnd: Date): boolean {
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });
  return daysInWeek.some((day) => isTaskDueOnDate(task, day));
}

export function getTaskDueDateInWeek(task: AdminTask, weekStart: Date, weekEnd: Date): Date | null {
  const daysInWeek = eachDayOfInterval({ start: weekStart, end: weekEnd });
  return daysInWeek.find((day) => isTaskDueOnDate(task, day)) || null;
}
