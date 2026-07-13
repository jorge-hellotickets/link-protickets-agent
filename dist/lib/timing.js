import { DEFAULT_BUSINESS_HOURS } from "./types";
/**
 * Get the local hour and day-of-week for a Date in a given IANA timezone.
 * dayOfWeek: 1=Mon ... 7=Sun (ISO convention).
 */
function localParts(date, timezone) {
    const fmt = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone,
        hour: "numeric",
        minute: "numeric",
        weekday: "short",
        hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(date).map((p) => [p.type, p.value]));
    const hour = Number(parts.hour === "24" ? 0 : parts.hour);
    const minute = Number(parts.minute);
    const dayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
    const dayOfWeek = dayMap[parts.weekday] ?? 1;
    return { hour, minute, dayOfWeek };
}
/**
 * Set the local time of a Date in a given timezone, returning a new Date.
 * Adjusts the UTC time so that the local representation matches the target hour/minute.
 */
function setLocalTime(date, timezone, hour, minute) {
    const current = localParts(date, timezone);
    const diffMs = (hour - current.hour) * 3600_000 +
        (minute - current.minute) * 60_000;
    return new Date(date.getTime() + diffMs);
}
/**
 * Advance a Date by N calendar days.
 */
function addDays(date, days) {
    return new Date(date.getTime() + days * 86_400_000);
}
/**
 * Check if a Date falls within business hours for a timezone.
 */
export function isBusinessHours(date, timezone, bh = DEFAULT_BUSINESS_HOURS) {
    const { hour, dayOfWeek } = localParts(date, timezone);
    return bh.dayOfWeek.includes(dayOfWeek) && hour >= bh.startHour && hour < bh.endHour;
}
/**
 * Find the next business morning slot (random between startHour and startHour+2)
 * on the next business day at or after `date`.
 * If `date` is already on a business day before startHour, uses the same day.
 */
export function nextMorningSlot(date, timezone, bh = DEFAULT_BUSINESS_HOURS, _rng) {
    const rng = _rng ?? Math.random;
    let candidate = new Date(date);
    const { hour, dayOfWeek } = localParts(candidate, timezone);
    // If on a business day but past start+2 or at/after start, skip to next day
    if (bh.dayOfWeek.includes(dayOfWeek) && hour < bh.startHour) {
        // Same day morning — use it
    }
    else {
        candidate = addDays(candidate, 1);
    }
    // Skip to next business day
    for (let i = 0; i < 7; i++) {
        const { dayOfWeek: dow } = localParts(candidate, timezone);
        if (bh.dayOfWeek.includes(dow))
            break;
        candidate = addDays(candidate, 1);
    }
    // Random hour between startHour and startHour+2
    const randomMinutes = Math.floor(rng() * 120); // 0-119 minutes
    return setLocalTime(candidate, timezone, bh.startHour, randomMinutes);
}
/**
 * Add N business days to a date (skipping weekends).
 */
export function addBusinessDays(date, days, timezone, bh = DEFAULT_BUSINESS_HOURS) {
    let result = new Date(date);
    let remaining = days;
    while (remaining > 0) {
        result = addDays(result, 1);
        const { dayOfWeek } = localParts(result, timezone);
        if (bh.dayOfWeek.includes(dayOfWeek)) {
            remaining--;
        }
    }
    return result;
}
/**
 * Snap a Date to business hours. If already in business hours, return as-is.
 * Otherwise shift to the next business morning.
 * Optionally prefer a specific day of week if it falls within a valid window.
 */
export function snapToBusinessHours(date, timezone, options) {
    const bh = options?.bh ?? DEFAULT_BUSINESS_HOURS;
    if (isBusinessHours(date, timezone, bh)) {
        return tryPreferredDay(date, timezone, options);
    }
    const morning = nextMorningSlot(date, timezone, bh, options?._rng);
    return tryPreferredDay(morning, timezone, options);
}
function tryPreferredDay(date, timezone, options) {
    if (!options?.preferredDayOfWeek)
        return date;
    const bh = options.bh ?? DEFAULT_BUSINESS_HOURS;
    const { dayOfWeek } = localParts(date, timezone);
    if (dayOfWeek === options.preferredDayOfWeek)
        return date;
    // Find the next occurrence of preferred day
    let daysAhead = (options.preferredDayOfWeek - dayOfWeek + 7) % 7;
    if (daysAhead === 0)
        daysAhead = 7;
    const preferredDate = addDays(date, daysAhead);
    // Check if it's within the allowed window
    if (options.windowEnd && preferredDate > options.windowEnd)
        return date;
    if (options.windowStart && preferredDate < options.windowStart)
        return date;
    if (!bh.dayOfWeek.includes(options.preferredDayOfWeek))
        return date;
    const hour = options.preferredHour ?? bh.startHour;
    return setLocalTime(preferredDate, timezone, hour, 30);
}
/**
 * Compute the send time for a reply to an inbound email.
 * Normal reply: `minMinutes`–`maxMinutes` delay (default 10–90).
 * Counteroffer: 12-24h delay (min 2h).
 * Snaps to business hours if the computed time falls outside.
 */
export function computeReplySendAt(now, timezone, isCounteroffer, _rng, options) {
    const rng = _rng ?? Math.random;
    const minMinutes = options?.minMinutes ?? 10;
    const maxMinutes = options?.maxMinutes ?? 90;
    const spanMinutes = Math.max(0, maxMinutes - minMinutes);
    const delayMs = isCounteroffer
        ? Math.max((12 + rng() * 12) * 3600_000, 2 * 3600_000)
        : (minMinutes + rng() * spanMinutes) * 60_000;
    return snapToBusinessHours(new Date(now.getTime() + delayMs), timezone, {
        _rng: rng,
        bh: options?.bh,
    });
}
//# sourceMappingURL=timing.js.map