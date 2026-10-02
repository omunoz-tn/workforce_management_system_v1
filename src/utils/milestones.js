// ── HR Milestones helpers ───────────────────────────────────────────────────
// Shared by the Milestones screen and the PDF designer so the two can never
// describe the same employee differently. The birthday/anniversary rules
// themselves live in get_hr_milestones.php; this is only the wording and the
// ordering that both presentations need.

export const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
];

export const plural = (count, noun) => `${count} ${count === 1 ? noun : noun + 's'}`;

/**
 * "1 year 5 months and 1 day" — the parts come pre-counted from the server, which measures
 * them to today's date in the selected year, so the tenure moves with the year picker just
 * as the age and the anniversary count do. Empty parts drop out, so a tenure of exactly two
 * years reads "2 years" rather than "2 years 0 months and 0 days".
 */
export const formatTenure = (tenure) => {
    if (!tenure) return null;

    const parts = [];
    if (tenure.years) parts.push(plural(tenure.years, 'year'));
    if (tenure.months) parts.push(plural(tenure.months, 'month'));
    if (tenure.days) parts.push(plural(tenure.days, 'day'));

    if (parts.length === 0) return 'Less than a day';
    if (parts.length === 1) return parts[0];
    return `${parts.slice(0, -1).join(' ')} and ${parts[parts.length - 1]}`;
};

/**
 * What an entry says under the name on the Milestones screen.
 *
 * With Tenure on, an anniversary states the exact time served instead of the round number
 * of years. The two are different facts and would read as a contradiction stacked on top of
 * each other ("1 year with the company" above "1 year 5 months and 1 day"), so this
 * replaces rather than appends — unlike Show Age, where the age is genuinely extra
 * information about a birthday.
 */
export const milestoneLabel = (item, showTenure) => {
    if (item.type === 'birthday') return 'Birthday';
    if (showTenure && item.tenure) return formatTenure(item.tenure);
    return `${plural(item.years, 'year')} with the company`;
};

/** Chronological, then alphabetical — the order every view renders in. */
export const chronological = (a, b) => (
    a.month - b.month
    || a.day - b.day
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
);

/** "02" — the day on its own, which is all any milestone entry ever shows. */
export const dayLabel = (day) => String(day).padStart(2, '0');
