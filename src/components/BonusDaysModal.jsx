import React, { useEffect, useMemo, useState } from 'react';
import './BonusModal.css';
import './BonusDaysModal.css';
import { ISO_WEEKDAYS, isoWeekdayOf } from '../utils/dates';

/**
 * The day-by-day behind one row's Days Employee Worked, opened from that cell.
 *
 * Answers the question the number itself cannot: WHICH days counted, and for the ones that
 * did not, how close they came. Every day the employee was rostered for is listed — a day
 * that was missed is as much the point as one that was earned — along with any day they
 * tracked time on without being rostered, since the rule is an absolute number of hours and
 * such a day can count too.
 *
 * Read-only. Nothing here is editable, because none of it is stored: it is all derived from
 * the DeskTime rows and the schedule, and the place to correct the outcome is the Days cell
 * this modal was opened from.
 */

const HOURS = (value) => `${(Number(value) || 0).toFixed(2)} h`;

/** Points the way the panel will move: right to open the calendar, left to fold it away. */
const ChevronIcon = ({ pointing }) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points={pointing === 'left' ? '15 18 9 12 15 6' : '9 18 15 12 9 6'} />
    </svg>
);

/** "08:00 – 17:00" from two SQL TIME values. */
const shiftLabel = (start, end) => {
    if (!start || !end) return '—';
    return `${String(start).slice(0, 5)} – ${String(end).slice(0, 5)}`;
};

/** "Mon 3" — weekday first, because that is how a roster is read. */
const dayLabel = (isoDate) => {
    const date = new Date(`${isoDate}T12:00:00`);
    return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
};

/**
 * The same month as a calendar, laid out beside the table rather than instead of it.
 *
 * The table answers "what happened on the 14th"; a grid answers "where are the gaps" —
 * three missed Mondays in a row is a pattern the table makes you reconstruct row by row.
 * Both are the same `days` array, so neither can disagree with the other.
 *
 * Every square of the month is drawn, not only the days that came back: a day the employee
 * was neither rostered for nor tracked on is exactly the blank the grid is for. Weeks start
 * on Monday, from the shared ISO_WEEKDAYS, so this reads like every other week in the app.
 */
const MonthCalendar = ({ year, month, days, periodLabel, workedDayHours }) => {
    // One flat list of squares; the 7-column grid does the wrapping into weeks.
    const cells = useMemo(() => {
        const byDate = new Map(days.map(day => [day.log_date, day]));
        const isoDateOf = (dayOfMonth) =>
            `${year}-${String(month).padStart(2, '0')}-${String(dayOfMonth).padStart(2, '0')}`;

        const squares = [];
        // Leading blanks so the 1st lands under its own weekday column.
        for (let column = 1; column < isoWeekdayOf(isoDateOf(1)); column++) {
            squares.push(null);
        }
        // Day 0 of the NEXT month is the last of this one — setMonth overflows, this does not.
        const lastDayOfMonth = new Date(year, month, 0).getDate();
        for (let dayOfMonth = 1; dayOfMonth <= lastDayOfMonth; dayOfMonth++) {
            const isoDate = isoDateOf(dayOfMonth);
            squares.push({ dayOfMonth, isoDate, record: byDate.get(isoDate) ?? null });
        }
        // Trailing blanks so the last row is a full week and the grid keeps its shape.
        while (squares.length % 7 !== 0) squares.push(null);

        return squares;
    }, [year, month, days]);

    // Tallied from the squares themselves rather than from `days` or the totals block: the
    // legend explains THIS grid, so counting anything else is how the two drift apart. The
    // padding blanks either side of the month are not days and are not counted.
    const tally = useMemo(() => {
        const counts = { worked: 0, missed: 0, off: 0 };
        cells.forEach(cell => {
            if (cell === null) return;
            if (cell.record === null) counts.off++;
            else if (cell.record.worked) counts.worked++;
            else counts.missed++;
        });
        return counts;
    }, [cells]);

    return (
        <div className="bonus-days-calendar">
            <div className="bonus-days-calendar-head">
                <h3>Calendar</h3>
                <span className="bonus-days-period">{periodLabel}</span>
            </div>

            <div className="bonus-days-calendar-grid">
                {ISO_WEEKDAYS.map(weekday => (
                    <span className="bonus-days-calendar-weekday" key={weekday.iso}>
                        {weekday.short}
                    </span>
                ))}

                {cells.map((cell, index) => {
                    if (cell === null) {
                        return <span className="bonus-days-calendar-cell is-blank" key={`pad-${index}`} />;
                    }
                    const { record } = cell;
                    // Three states, not two: worked, fell short, and never on the roster at
                    // all — collapsing the last two would show a Sunday as a missed day.
                    const state = record === null ? 'is-off' : (record.worked ? 'is-worked' : 'is-missed');
                    const title = record === null
                        ? `${cell.isoDate} · not scheduled, nothing tracked`
                        : `${cell.isoDate} · ${HOURS(record.tracked_hours)} tracked of ${HOURS(record.scheduled_hours)} scheduled`
                            + ` · ${record.worked ? 'counted' : `under the ${workedDayHours} h bar`}`;

                    return (
                        <span className={`bonus-days-calendar-cell ${state}`} key={cell.isoDate} title={title}>
                            <span className="bonus-days-calendar-day">{cell.dayOfMonth}</span>
                            {record !== null && (
                                <span className="bonus-days-calendar-hours">
                                    {(Number(record.tracked_hours) || 0).toFixed(1)}
                                </span>
                            )}
                        </span>
                    );
                })}
            </div>

            <div className="bonus-days-calendar-legend">
                <span><i className="is-worked" /> Counted: {tally.worked}</span>
                <span><i className="is-missed" /> Under {workedDayHours} h: {tally.missed}</span>
                <span><i className="is-off" /> Not scheduled: {tally.off}</span>
            </div>
        </div>
    );
};

const BonusDaysModal = ({ employeeName, employeeId, year, month, periodLabel, onClose }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [showCalendar, setShowCalendar] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetch(`./api/get_bonus_days.php?employee_id=${employeeId}&year=${year}&month=${month}`)
            .then(res => res.json())
            .then(json => {
                if (cancelled) return;
                if (!json.success) throw new Error(json.error || 'Could not load the day breakdown.');
                setData(json);
            })
            .catch(err => { if (!cancelled) setError(err.message); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [employeeId, year, month]);

    const workedDayHours = data?.worked_day_hours ?? 7;

    return (
        <div className="bonus-modal-overlay" onClick={onClose}>
            <div
                className={`bonus-modal-panel bonus-days-modal ${showCalendar ? 'has-calendar' : ''}`}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="bonus-days-top">
                    <div className="bonus-modal-header">
                        <div>
                            <h2>{employeeName}</h2>
                            <span className="bonus-days-period">{periodLabel} · day by day</span>
                        </div>
                        <button className="bonus-modal-close" onClick={onClose}>&times;</button>
                    </div>

                    {loading && <p className="bonus-days-status">Loading the month…</p>}
                    {error && <div className="bonus-modal-error">{error}</div>}

                    {data && (
                        <>
                            <p className="bonus-modal-intro">
                                Every day of {periodLabel} this employee was scheduled for, plus any they
                                tracked time on without being. A day counts towards the bonus once DeskTime
                                records <strong>{workedDayHours} hours or more</strong> — the same bar for
                                everyone, whatever shift they are on. Change it in Configuration &gt; HR &gt; Bonus.
                            </p>

                            <div className="bonus-days-totals">
                                <div className="bonus-days-total">
                                    <span className="bonus-days-total-label">Days worked</span>
                                    <span className="bonus-days-total-value is-worked">
                                        {data.totals.worked_days} / {data.totals.scheduled_days}
                                    </span>
                                </div>
                                <div className="bonus-days-total">
                                    <span className="bonus-days-total-label" title="Net of the employee's lunch">Scheduled hours</span>
                                    <span className="bonus-days-total-value">{HOURS(data.totals.scheduled_hours)}</span>
                                </div>
                                <div className="bonus-days-total">
                                    <span className="bonus-days-total-label">DeskTime hours</span>
                                    <span className="bonus-days-total-value">{HOURS(data.totals.tracked_hours)}</span>
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="bonus-days-body">
                    {data && (
                        <div className="bonus-days-table-wrapper">
                            <table className="bonus-days-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Schedule</th>
                                        <th className="is-numeric" title="Net of the employee's lunch">Scheduled</th>
                                        <th className="is-numeric">DeskTime</th>
                                        <th className="is-status">Counted</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.days.map(day => (
                                        <tr key={day.log_date} className={day.worked ? '' : 'is-missed'}>
                                            <td>{dayLabel(day.log_date)}</td>
                                            <td className="bonus-days-shift">
                                                {shiftLabel(day.shift_start, day.shift_end)}
                                            </td>
                                            <td
                                                className="is-numeric"
                                                title={day.lunch_hours > 0
                                                    ? `${HOURS(day.scheduled_hours + day.lunch_hours)} shift − ${HOURS(day.lunch_hours)} lunch`
                                                    : undefined}
                                            >
                                                {HOURS(day.scheduled_hours)}
                                            </td>
                                            <td className="is-numeric">{HOURS(day.tracked_hours)}</td>
                                            <td className="is-status">
                                                <span className={`bonus-days-badge ${day.worked ? 'is-worked' : 'is-missed'}`}>
                                                    {day.worked ? 'Worked' : 'Missed'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                    {data.days.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="bonus-days-empty">
                                                This employee had no scheduled days in {periodLabel}.
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* Centred on the table it unfolds beside, sitting on its right edge like
                        the handle of a drawer: the calendar it opens is a second reading of
                        the very rows this control straddles. Disabled until the month
                        arrives, since there is nothing yet to unfold. */}
                    <button
                        type="button"
                        className="bonus-days-calendar-toggle"
                        onClick={() => setShowCalendar(open => !open)}
                        aria-expanded={showCalendar}
                        aria-label={showCalendar ? 'Hide Calendar' : 'Show Calendar'}
                        title={showCalendar ? 'Hide Calendar' : 'Show Calendar'}
                        disabled={!data}
                    >
                        <ChevronIcon pointing={showCalendar ? 'left' : 'right'} />
                    </button>
                </div>

                {showCalendar && data && (
                    <MonthCalendar
                        year={year}
                        month={month}
                        days={data.days}
                        periodLabel={periodLabel}
                        workedDayHours={workedDayHours}
                    />
                )}

                <div className="bonus-modal-footer">
                    <button className="bonus-btn-cancel" onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
};

export default BonusDaysModal;
