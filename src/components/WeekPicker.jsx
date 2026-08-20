import React, { useState, useEffect, useMemo, useRef } from 'react';
import { formatDate, mondayOf, parseDate } from '../utils/dates';

// ── ISO 8601 week helpers ───────────────────────────────────────────────────
// Week 1 is the one containing the first Thursday, and weeks run Monday–Sunday —
// the same convention the board already uses everywhere else.

export const isoWeekOf = (date) => {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;          // Monday = 1 ... Sunday = 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);  // hop to this week's Thursday
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return {
        week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7),
        year: d.getUTCFullYear()
    };
};

export const mondayOfIsoWeek = (isoYear, week) => {
    const jan4 = new Date(isoYear, 0, 4);       // Jan 4 always falls in ISO week 1
    const week1Monday = new Date(jan4);
    week1Monday.setDate(jan4.getDate() - ((jan4.getDay() || 7) - 1));
    const monday = new Date(week1Monday);
    monday.setDate(week1Monday.getDate() + (week - 1) * 7);
    return monday;
};

// 52 or 53, depending on the year. Dec 28 is always in the last ISO week.
export const isoWeeksInYear = (isoYear) => isoWeekOf(new Date(isoYear, 11, 28)).week;

// "Aug 17 – 23", collapsing the month when the week does not cross one.
export const weekRangeLabel = (monday) => {
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const opts = { month: 'short', day: 'numeric' };
    const left = monday.toLocaleDateString(undefined, opts);
    const right = monday.getMonth() === sunday.getMonth()
        ? sunday.getDate()
        : sunday.toLocaleDateString(undefined, opts);
    return `${left} – ${right}`;
};

/**
 *   ←  Week 34 · Aug 17 – 23 ▾  →
 *
 * Lived inline in ScheduleBoard until Shift Management needed the same control; it is
 * shared rather than copied for the same reason ShiftCard is, so the two screens cannot
 * drift into two slightly different week pickers.
 *
 * `monday` is the Monday of the week on screen. `onChange` always receives a noon-anchored
 * Monday (see utils/dates), so a caller never has to normalise a mid-week or midnight date
 * itself. `align` places the dropdown: "right" under a header control flush with the right
 * edge, "left" when the trigger sits near the left of its container.
 */
const WeekPicker = ({ monday, onChange, align = 'right' }) => {
    // `menuYear` is separate from the viewed week so the list can be browsed into another
    // year (the arrows can leave the current one) without moving the caller's week.
    const [open, setOpen] = useState(false);
    const viewedWeek = isoWeekOf(monday);
    const [menuYear, setMenuYear] = useState(viewedWeek.year);
    const wrapperRef = useRef(null);
    const listRef = useRef(null);

    const emit = (date) => onChange(mondayOf(formatDate(date)));

    const navigate = (weeks) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + weeks * 7);
        emit(d);
    };

    const toggleMenu = () => {
        // Always open on the week being viewed, even after browsing to another year.
        setMenuYear(viewedWeek.year);
        setOpen(o => !o);
    };

    const selectWeek = (date) => {
        emit(date);
        setOpen(false);
    };

    const weeksOfMenuYear = useMemo(
        () => Array.from({ length: isoWeeksInYear(menuYear) }, (_, i) => {
            const weekMonday = mondayOfIsoWeek(menuYear, i + 1);
            return { week: i + 1, monday: weekMonday, label: weekRangeLabel(weekMonday) };
        }),
        [menuYear]
    );

    useEffect(() => {
        if (!open) return undefined;
        const onClickAway = (e) => {
            if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
        };
        const onEscape = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onClickAway);
        document.addEventListener('keydown', onEscape);
        return () => {
            document.removeEventListener('mousedown', onClickAway);
            document.removeEventListener('keydown', onEscape);
        };
    }, [open]);

    // 52 entries would otherwise open scrolled to January, far from where you are.
    useEffect(() => {
        if (!open || !listRef.current) return;
        const selected = listRef.current.querySelector('.is-selected');
        if (selected) selected.scrollIntoView({ block: 'center' });
    }, [open, menuYear]);

    return (
        // The menu lives outside .navigation-controls on purpose: that element has
        // overflow:hidden to clip its buttons' corners, which would also clip the
        // dropdown. The wrapper provides the positioning context.
        <div className="week-nav-wrapper" ref={wrapperRef}>
            <div className="navigation-controls">
                <button type="button" className="nav-btn prev" onClick={() => navigate(-1)} title="Previous Week">←</button>
                <button
                    type="button"
                    className="nav-btn today week-picker-trigger"
                    onClick={toggleMenu}
                    title="Pick a week"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                >
                    Week {viewedWeek.week} · {weekRangeLabel(monday)}
                    <span className="week-picker-caret">▾</span>
                </button>
                <button type="button" className="nav-btn next" onClick={() => navigate(1)} title="Next Week">→</button>
            </div>

            {open && (
                <div className={`week-picker-menu ${align === 'left' ? 'week-picker-menu--left' : ''}`} role="listbox">
                    <div className="week-picker-year">
                        <button type="button" onClick={() => setMenuYear(y => y - 1)} title="Previous year">‹</button>
                        <span>{menuYear}</span>
                        <button type="button" onClick={() => setMenuYear(y => y + 1)} title="Next year">›</button>
                    </div>
                    <button
                        type="button"
                        className="week-picker-current"
                        onClick={() => selectWeek(parseDate())}
                    >
                        ◆ Current Week
                    </button>
                    <div className="week-picker-list" ref={listRef}>
                        {weeksOfMenuYear.map(w => {
                            const isSelected = menuYear === viewedWeek.year && w.week === viewedWeek.week;
                            return (
                                <button
                                    key={w.week}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    className={`week-picker-item ${isSelected ? 'is-selected' : ''}`}
                                    onClick={() => selectWeek(w.monday)}
                                >
                                    <span className="week-picker-num">Week {w.week}</span>
                                    <span className="week-picker-range">{w.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WeekPicker;
