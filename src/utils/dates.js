/**
 * dates.js — the platform runs on a single timezone: America/Santo_Domingo.
 *
 * A JavaScript Date holds an instant, not a calendar date; the date only appears when it is
 * read, and which date you get depends on the timezone doing the reading. The codebase used
 * to derive "today" with `new Date().toISOString().split('T')[0]`, which reads the instant
 * in UTC. Past 8 PM local that lands on the next UTC day, so week ranges shifted forward and
 * month-to-date ranges lost their first day — silently, and only in the evening.
 *
 * Two rules keep every date the same everywhere:
 *
 *   1. The current date comes from `todayStr()`, which pins the reading to Santo Domingo, so
 *      a laptop set to another timezone still agrees with the server and the database.
 *   2. Arithmetic (setDate, getDay, week offsets) runs on a Date anchored at NOON via
 *      `parseDate()`. No timezone offset on earth is large enough to push noon across
 *      midnight, so adding or subtracting days can never change the calendar day by accident.
 *      Format the result back with `formatDate()`, never with toISOString().
 *
 * Deliberately NOT used for Excel serial dates (BulkAddHolidaysModal): those are built on a
 * UTC epoch, where toISOString() is the correct reading.
 */

export const APP_TIME_ZONE = 'America/Santo_Domingo';

// 'en-CA' yields YYYY-MM-DD, the format the API and the database speak.
const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
});

/** Today's date in Santo Domingo, as YYYY-MM-DD, whatever the machine's timezone is. */
export const todayStr = (instant = new Date()) => dateFormatter.format(instant);

/**
 * A Date for calendar arithmetic, anchored at noon so day maths cannot slip across midnight.
 * Accepts YYYY-MM-DD (extra time in the string is ignored) and defaults to today.
 */
export const parseDate = (dateStr = todayStr()) => new Date(`${dateStr.slice(0, 10)}T12:00:00`);

/** Formats a noon-anchored Date back to YYYY-MM-DD using its own calendar day. */
export const formatDate = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Same calendar day shifted by `days`, as YYYY-MM-DD. */
export const addDays = (dateStr, days) => {
    const d = parseDate(dateStr);
    d.setDate(d.getDate() + days);
    return formatDate(d);
};

/** Monday of the week containing `dateStr`, as a noon-anchored Date. */
export const mondayOf = (dateStr = todayStr()) => {
    const d = parseDate(dateStr);
    const weekday = d.getDay();
    d.setDate(d.getDate() - weekday + (weekday === 0 ? -6 : 1));
    return d;
};
