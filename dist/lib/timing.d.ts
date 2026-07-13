import { type BusinessHoursWindow } from "./types";
/**
 * Check if a Date falls within business hours for a timezone.
 */
export declare function isBusinessHours(date: Date, timezone: string, bh?: BusinessHoursWindow): boolean;
/**
 * Find the next business morning slot (random between startHour and startHour+2)
 * on the next business day at or after `date`.
 * If `date` is already on a business day before startHour, uses the same day.
 */
export declare function nextMorningSlot(date: Date, timezone: string, bh?: BusinessHoursWindow, _rng?: () => number): Date;
/**
 * Add N business days to a date (skipping weekends).
 */
export declare function addBusinessDays(date: Date, days: number, timezone: string, bh?: BusinessHoursWindow): Date;
/**
 * Snap a Date to business hours. If already in business hours, return as-is.
 * Otherwise shift to the next business morning.
 * Optionally prefer a specific day of week if it falls within a valid window.
 */
export declare function snapToBusinessHours(date: Date, timezone: string, options?: {
    preferredDayOfWeek?: number;
    preferredHour?: number;
    bh?: BusinessHoursWindow;
    windowStart?: Date;
    windowEnd?: Date;
    _rng?: () => number;
}): Date;
/**
 * Compute the send time for a reply to an inbound email.
 * Normal reply: `minMinutes`–`maxMinutes` delay (default 10–90).
 * Counteroffer: 12-24h delay (min 2h).
 * Snaps to business hours if the computed time falls outside.
 */
export declare function computeReplySendAt(now: Date, timezone: string, isCounteroffer: boolean, _rng?: () => number, options?: {
    minMinutes?: number;
    maxMinutes?: number;
    bh?: BusinessHoursWindow;
}): Date;
//# sourceMappingURL=timing.d.ts.map