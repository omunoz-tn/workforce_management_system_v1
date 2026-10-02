import React, { useEffect, useRef, useState } from 'react';
import './BonusColumnFilter.css';
import { normalizeForSearch } from '../utils/search';

/**
 * The funnel in a Bonus column header, and the little panel it opens.
 *
 * One component for every column rather than one per column, driven by the descriptor's
 * `type` — nine bespoke dropdowns would be nine places to fix the next behaviour change.
 * Three shapes cover the table:
 *
 *   text    a search box, matched with normalizeForSearch so "munoz" finds "Muñoz"
 *   list    checkboxes over the values actually present, plus Select All / Clear All
 *   number  a min and a max, either side optional
 *
 * `value` is whatever shape the type implies ({text} / {values} / {min,max}) or null for
 * "not filtered". The caller owns the state and decides what null means for that column —
 * the Team column, for instance, hands this the same selection its toolbar dropdown edits,
 * so the two controls are two windows onto one filter rather than two filters.
 *
 * The panel is positioned `fixed` from the funnel's own rect for the same reason
 * BonusComboCell's menu is: the table wrapper scrolls, and an absolutely positioned panel
 * would be clipped by it. It closes on scroll, since a fixed panel cannot follow its header.
 */

const PANEL_MAX_HEIGHT = 300;

const FunnelIcon = () => (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </svg>
);

const BonusColumnFilter = ({ column, value, options = [], isActive, onChange, onClear }) => {
    const [rect, setRect] = useState(null);
    const [optionSearch, setOptionSearch] = useState('');
    const buttonRef = useRef(null);
    const panelRef = useRef(null);

    useEffect(() => {
        if (!rect) return undefined;
        const close = () => setRect(null);
        const onClickAway = (e) => {
            if (panelRef.current?.contains(e.target) || buttonRef.current?.contains(e.target)) return;
            close();
        };
        const onEscape = (e) => { if (e.key === 'Escape') close(); };

        document.addEventListener('mousedown', onClickAway);
        document.addEventListener('keydown', onEscape);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            document.removeEventListener('mousedown', onClickAway);
            document.removeEventListener('keydown', onEscape);
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [rect]);

    const toggle = () => {
        if (rect) {
            setRect(null);
            return;
        }
        setOptionSearch('');
        setRect(buttonRef.current?.getBoundingClientRect() ?? null);
    };

    const panelStyle = rect && (() => {
        const width = column.type === 'number' ? 210 : 240;
        return {
            // Right-anchored to the funnel so a panel on the last column stays on screen.
            left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
            width,
            maxHeight: PANEL_MAX_HEIGHT,
            ...(rect.bottom + PANEL_MAX_HEIGHT > window.innerHeight
                ? { bottom: window.innerHeight - rect.top + 4 }
                : { top: rect.bottom + 4 })
        };
    })();

    // `null` means "every value passes", which for a checkbox list is every box ticked.
    const checked = column.type === 'list'
        ? new Set(value?.values ?? options)
        : new Set();

    const visibleOptions = column.type === 'list' && optionSearch.trim() !== ''
        ? options.filter(o => normalizeForSearch(o).includes(normalizeForSearch(optionSearch)))
        : options;

    const toggleOption = (option) => {
        const next = new Set(checked);
        if (next.has(option)) next.delete(option); else next.add(option);
        onChange({ values: Array.from(next) });
    };

    return (
        <span className="bonus-col-filter">
            <button
                ref={buttonRef}
                type="button"
                className={`bonus-col-filter-btn ${isActive ? 'is-active' : ''} ${rect ? 'is-open' : ''}`}
                onClick={toggle}
                aria-expanded={!!rect}
                title={isActive ? `${column.label} is filtered` : `Filter ${column.label}`}
            >
                <FunnelIcon />
            </button>

            {rect && (
                <div className="bonus-col-filter-panel" style={panelStyle} ref={panelRef}>
                    <div className="bonus-col-filter-head">
                        <span className="bonus-col-filter-title">{column.label}</span>
                        <button
                            type="button"
                            className="bonus-col-filter-clear"
                            onClick={() => { onClear(); setRect(null); }}
                            disabled={!isActive}
                        >
                            Clear
                        </button>
                    </div>

                    {column.type === 'text' && (
                        <input
                            type="text"
                            className="bonus-col-filter-input"
                            placeholder={`Search ${column.label.toLowerCase()}…`}
                            value={value?.text ?? ''}
                            onChange={(e) => onChange({ text: e.target.value })}
                            autoFocus
                        />
                    )}

                    {/* An optional second question on a number column, when the descriptor
                        carries one: the days column asks who set the number as well as how
                        big it is. "All" is the same state as no choice at all, so the row
                        below reads as three ways to answer one question rather than a
                        toggle with a hidden third position. */}
                    {column.type === 'number' && column.flag && (
                        <div className="bonus-col-filter-flag">
                            <span className="bonus-col-filter-sublabel">{column.flag.label}</span>
                            <div className="bonus-col-filter-segmented">
                                <button
                                    type="button"
                                    className={!value?.flag ? 'is-on' : ''}
                                    onClick={() => onChange({ ...value, flag: null })}
                                >
                                    All
                                </button>
                                {column.flag.options.map(option => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        title={option.hint}
                                        className={value?.flag === option.id ? 'is-on' : ''}
                                        // Clicking the lit one turns it off, so the choice can
                                        // be undone without hunting for "All".
                                        onClick={() => onChange({
                                            ...value,
                                            flag: value?.flag === option.id ? null : option.id
                                        })}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {column.type === 'number' && (
                        <div className="bonus-col-filter-range">
                            <label>
                                <span>Min</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="bonus-col-filter-input"
                                    placeholder="Any"
                                    value={value?.min ?? ''}
                                    onChange={(e) => onChange({ ...value, min: e.target.value.replace(/[^\d.]/g, '') })}
                                    autoFocus
                                />
                            </label>
                            <label>
                                <span>Max</span>
                                <input
                                    type="text"
                                    inputMode="decimal"
                                    className="bonus-col-filter-input"
                                    placeholder="Any"
                                    value={value?.max ?? ''}
                                    onChange={(e) => onChange({ ...value, max: e.target.value.replace(/[^\d.]/g, '') })}
                                />
                            </label>
                        </div>
                    )}

                    {column.type === 'list' && (
                        <>
                            {options.length > 8 && (
                                <input
                                    type="text"
                                    className="bonus-col-filter-input"
                                    placeholder="Search…"
                                    value={optionSearch}
                                    onChange={(e) => setOptionSearch(e.target.value)}
                                    autoFocus
                                />
                            )}
                            <div className="bonus-col-filter-actions">
                                <button type="button" onClick={() => onChange({ values: options })}>Select All</button>
                                <button type="button" onClick={() => onChange({ values: [] })}>Clear All</button>
                            </div>
                            <div className="bonus-col-filter-options">
                                {visibleOptions.map(option => (
                                    <label className="bonus-col-filter-option" key={option}>
                                        <input
                                            type="checkbox"
                                            checked={checked.has(option)}
                                            onChange={() => toggleOption(option)}
                                        />
                                        <span>{option}</span>
                                    </label>
                                ))}
                                {visibleOptions.length === 0 && (
                                    <div className="bonus-col-filter-empty">No values match.</div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </span>
    );
};

export default BonusColumnFilter;
