import React, { useState, useEffect, useMemo, useRef } from 'react';
import { firstOfMonth, formatDate, parseDate, todayStr } from '../utils/dates';

// "Aug 1 – 31", the month's own range — the same thing weekRangeLabel() prints for a week,
// so the two menus read alike down to the right-hand column.
const monthRangeLabel = (year, month) => {
    const first = new Date(year, month, 1, 12);
    const lastDay = new Date(year, month + 1, 0).getDate();
    return `${first.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${lastDay}`;
};

/**
 *   ←  August 2026 ▾  →
 *
 * The Month view's counterpart to WeekPicker, and deliberately its mirror: same arrows,
 * same trigger, same menu chrome (year stepper, a "current period" shortcut, the list), and
 * the same week-picker-* classes rather than a second set styled to look similar. The two
 * controls sit in the same slot of the same screen — a reader switching views should not be
 * able to tell them apart except by what they list.
 *
 * `monthStart` is the first of the month on screen. `onChange` always receives a
 * noon-anchored first-of-month (see utils/dates), so a caller never has to normalise a
 * mid-month or midnight date itself.
 */
const MonthPicker = ({ monthStart, onChange, align = 'right' }) => {
    // `menuYear` is separate from the viewed month so the list can be browsed into another
    // year without moving the caller's month.
    const [open, setOpen] = useState(false);
    const viewedYear = monthStart.getFullYear();
    const viewedMonth = monthStart.getMonth();
    const [menuYear, setMenuYear] = useState(viewedYear);
    const wrapperRef = useRef(null);

    const emit = (date) => onChange(firstOfMonth(formatDate(date)));

    const navigate = (months) => emit(new Date(viewedYear, viewedMonth + months, 1, 12));

    const toggleMenu = () => {
        // Always open on the month being viewed, even after browsing to another year.
        setMenuYear(viewedYear);
        setOpen(o => !o);
    };

    const selectMonth = (date) => {
        emit(date);
        setOpen(false);
    };

    const monthsOfMenuYear = useMemo(
        () => Array.from({ length: 12 }, (_, month) => ({
            month,
            first: new Date(menuYear, month, 1, 12),
            name: new Date(menuYear, month, 1, 12).toLocaleDateString(undefined, { month: 'long' }),
            label: monthRangeLabel(menuYear, month)
        })),
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

    // No scroll-into-view counterpart to WeekPicker's: twelve rows fit the menu whole, so
    // there is never an off-screen selection to hunt for.
    const thisMonth = parseDate(todayStr());

    return (
        // The menu lives outside .navigation-controls on purpose: that element has
        // overflow:hidden to clip its buttons' corners, which would also clip the
        // dropdown. The wrapper provides the positioning context.
        <div className="week-nav-wrapper" ref={wrapperRef}>
            <div className="navigation-controls">
                <button type="button" className="nav-btn prev" onClick={() => navigate(-1)} title="Previous Month">←</button>
                <button
                    type="button"
                    className="nav-btn today week-picker-trigger"
                    onClick={toggleMenu}
                    title="Pick a month"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                >
                    {monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    <span className="week-picker-caret">▾</span>
                </button>
                <button type="button" className="nav-btn next" onClick={() => navigate(1)} title="Next Month">→</button>
            </div>

            {open && (
                <div
                    className={`week-picker-menu month-picker-menu ${align === 'left' ? 'week-picker-menu--left' : ''}`}
                    role="listbox"
                >
                    <div className="week-picker-year">
                        <button type="button" onClick={() => setMenuYear(y => y - 1)} title="Previous year">‹</button>
                        <span>{menuYear}</span>
                        <button type="button" onClick={() => setMenuYear(y => y + 1)} title="Next year">›</button>
                    </div>
                    <button
                        type="button"
                        className="week-picker-current"
                        onClick={() => selectMonth(thisMonth)}
                    >
                        ◆ Current Month
                    </button>
                    <div className="week-picker-list">
                        {monthsOfMenuYear.map(m => {
                            const isSelected = menuYear === viewedYear && m.month === viewedMonth;
                            return (
                                <button
                                    key={m.month}
                                    type="button"
                                    role="option"
                                    aria-selected={isSelected}
                                    className={`week-picker-item ${isSelected ? 'is-selected' : ''}`}
                                    onClick={() => selectMonth(m.first)}
                                >
                                    <span className="week-picker-num">{m.name}</span>
                                    <span className="week-picker-range">{m.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default MonthPicker;
