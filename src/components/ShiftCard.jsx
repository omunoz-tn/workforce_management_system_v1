import React from 'react';
// The card's styles live with the Schedule Board on purpose: this component was extracted
// from it so both screens render the exact same markup and classes. Importing the file
// here keeps the card self-contained wherever it is used.
import './ScheduleBoard.css';
// Same source of truth as the Holidays module, so the type labels shown here cannot drift
// from the ones configured there.
import { HOLIDAY_TYPES, COUNTRIES, FlagIcon } from './Holidays';

export const timeToSeconds = (t) => {
    if (!t || t === '00:00:00') return 0;
    const parts = t.split(':').map(Number);
    return (parts[0] * 3600) + (parts[1] * 60) + (parts[2] || 0);
};

export const formatTime = (t) => {
    if (!t || t === '00:00:00') return '-';
    const [h, m] = t.split(':');
    const hh = parseInt(h);
    const ampm = hh >= 12 ? 'PM' : 'AM';
    const displayHour = hh % 12 || 12;
    return `${displayHour}:${m} ${ampm}`;
};

export const formatLunch = (hours) => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}:${m.toString().padStart(2, '0')} HRS`;
};

/**
 * Seconds of a shift that fall inside a time window. Used to deduct a Custom holiday's
 * range: it is the plain intersection of the two intervals, so a window that only clips an
 * edge, or one that cuts a hole in the middle, both come out right.
 */
const overlapSeconds = (start, end, from, to) => {
    const s = timeToSeconds(start), e = timeToSeconds(end);
    const xs = timeToSeconds(from), xe = timeToSeconds(to);
    return Math.max(0, Math.min(e, xe) - Math.max(s, xs));
};

/**
 * Hours a day contributes, after the team lunch and after any holiday the employee's team
 * configured for that date. The single place this is computed: the card's own total, the
 * Schedule Board's Weekly Hours column and Shift Management's weekly total all call it, so
 * they cannot disagree with each other — or with the Run Rate, which applies the same two
 * rules in SQL (see RunRateWindowSql.php).
 *
 *   Non-Working Holiday → the day contributes nothing at all.
 *   Custom Holiday      → only the part of the shift inside the window is deducted; the
 *                         schedule itself is left alone, and hours outside it still count.
 */
export const shiftHours = (schedule, lunchHours) => {
    if (!schedule || !schedule.start || schedule.start === '00:00:00') return 0;

    const holidays = schedule.holidays || [];
    if (holidays.some(h => h.type === 'non_working')) return 0;

    let excluded = 0;
    holidays.forEach(h => {
        if (h.type === 'campaign_defined' && h.from && h.to) {
            excluded += overlapSeconds(schedule.start, schedule.end, h.from, h.to);
        }
    });

    const workedSec = timeToSeconds(schedule.end) - timeToSeconds(schedule.start) - excluded;
    return Math.max(workedSec / 3600 - lunchHours, 0);
};

/** '09:00' <-> '09:00:00' — <input type="time"> speaks the short form. */
export const toInputTime = (t) => (t && t !== '00:00:00' ? t.slice(0, 5) : '');
export const fromInputTime = (t) => (t ? `${t}:00` : '00:00:00');


/**
 * Holiday markers for a day, carrying the type the employee's own team gave each one
 * (Employees > Teams > Assign Members > Holidays). The same date can therefore read
 * Non-Working on one row and Working on another.
 *
 * A date can hold one holiday per country, so they are grouped by resolved type: two
 * countries agreeing produce a single tag showing both flags, while two countries the team
 * treats differently produce one tag each, rather than hiding the disagreement.
 */
const HolidayTags = ({ holidays }) => {
    if (!holidays || holidays.length === 0) return null;

    const rank = { non_working: 3, campaign_defined: 2, working: 1 };
    const groups = {};
    holidays.forEach(h => { (groups[h.type] = groups[h.type] || []).push(h); });

    return Object.entries(groups)
        .sort((a, b) => (rank[b[0]] || 0) - (rank[a[0]] || 0))
        .map(([typeId, list]) => {
            const type = HOLIDAY_TYPES.find(t => t.id === typeId) || HOLIDAY_TYPES[0];
            const withWindow = list.find(h => h.from);
            const windowNote = withWindow
                ? ` · ${formatTime(withWindow.from)}–${formatTime(withWindow.to)} not counted`
                : '';
            const scope = list.some(h => h.custom) ? 'set for this team' : 'organization default';
            const names = list.map(h => h.name).join(' · ');
            return (
                <span
                    key={typeId}
                    className={`shift-holiday-tag holiday-${typeId}`}
                    title={`${names} — ${type.badge} Holiday (${scope})${windowNote}`}
                >
                    <span className="shift-holiday-flags">
                        {list.map(h => (
                            <FlagIcon
                                key={h.country}
                                country={COUNTRIES.find(c => c.code === h.country) || { code: h.country, flag: '🏳️' }}
                            />
                        ))}
                    </span>
                    {type.badge} Holiday
                </span>
            );
        });
};

/**
 * The Schedule Board shift card, lifted out of ScheduleBoard.jsx unchanged so Shift
 * Management can render the very same card instead of a look-alike.
 *
 * With no editing props it renders exactly what the board always rendered. Passing
 * `editing` swaps the two time readouts for inline inputs and keeps everything else —
 * dimensions, badges, lunch row, OFF treatment — identical.
 */
const ShiftCard = ({
    schedule,
    lunchHours = 0,
    editing = false,
    onChange,
    actions = null
}) => {
    const isOff = !schedule || schedule.start === '00:00:00';

    // `!schedule` is part of the guard, not just `isOff && !editing`: with no schedule
    // object there is nothing to edit, and falling through would dereference it below.
    if (!schedule || (isOff && !editing)) {
        const isPredictedOff = schedule?.predicted;
        const isOverride = schedule?.manualOverride;
        const note = isOverride
            ? ' (Set from a manual forecast)'
            : (isPredictedOff ? ' (Forecast from historical pattern)' : '');
        const tooltip = `Start: - | End: - | Total: 0h${note}`;
        return (
            <>
                <span
                    className={`shift-off ${isPredictedOff ? 'shift-off-predicted' : ''} ${isOverride ? 'shift-off-override' : ''}`}
                    title={tooltip}
                >
                    {isOverride ? 'Manual Forecast OFF' : (isPredictedOff ? 'Forecast OFF' : 'OFF')}
                </span>
                <HolidayTags holidays={schedule?.holidays} />
                {actions}
            </>
        );
    }

    const dayHours = shiftHours(schedule, lunchHours);
    const predictedNote = schedule.manualOverride
        ? ' (Set from a manual forecast)'
        : (schedule.predicted ? ' (Forecast from historical pattern)' : '');
    const tooltip = `Start: ${formatTime(schedule.start)} | End: ${formatTime(schedule.end)} | Total: ${dayHours.toFixed(2)}h${predictedNote}`;

    return (
        <div
            className={`shift-card ${schedule.predicted ? 'shift-predicted' : ''} ${schedule.manualOverride ? 'shift-override' : ''} ${editing ? 'shift-editing' : ''}`}
            title={editing ? undefined : tooltip}
        >
            {schedule.manualOverride ? (
                <span className="predicted-badge override-badge">Manual Forecast</span>
            ) : schedule.predicted && (
                <span className="predicted-badge">Forecast</span>
            )}
            <div className="shift-row">
                <span className="shift-label">Start:</span>
                {editing ? (
                    <input
                        type="time"
                        className="shift-time-input"
                        value={toInputTime(schedule.start)}
                        onChange={(e) => onChange({ ...schedule, start: fromInputTime(e.target.value) })}
                        aria-label="Shift start time"
                    />
                ) : (
                    <span className="shift-time">{formatTime(schedule.start)}</span>
                )}
            </div>
            <div className="shift-row lunch-row">
                <span className="shift-label">Lunch:</span>
                <span className="shift-time lunch-time">{formatLunch(lunchHours)}</span>
            </div>
            <div className="shift-row">
                <span className="shift-label">End:</span>
                {editing ? (
                    <input
                        type="time"
                        className="shift-time-input"
                        value={toInputTime(schedule.end)}
                        onChange={(e) => onChange({ ...schedule, end: fromInputTime(e.target.value) })}
                        aria-label="Shift end time"
                    />
                ) : (
                    <span className="shift-time">{formatTime(schedule.end)}</span>
                )}
            </div>
            {editing && (
                <div className="shift-row shift-total-row">
                    <span className="shift-label">Total:</span>
                    <span className="shift-time">{dayHours.toFixed(2)}h</span>
                </div>
            )}
            <HolidayTags holidays={schedule.holidays} />
            {actions}
        </div>
    );
};

export default ShiftCard;
