import React, { useEffect, useMemo, useRef, useState } from 'react';
import './BonusComboCell.css';
import { normalizeForSearch } from '../utils/search';

/**
 * A table cell that is both a text box and a picker — used by the Bonus list's Employee
 * Name and Team columns.
 *
 * Clicking it opens the full list, so changing a row's employee (or moving one to another
 * team) is a choice, not a spelling exercise. Typing filters that list, and typing
 * something the list does not have and leaving the cell commits the text as-is: a name
 * DeskTime has never seen, or a team that only exists on paper, still has to be enterable.
 * Which of the two happened is the difference between `onSelect` and `onCommitText`, and the
 * caller does different things with them — picking an employee also fills in their team.
 *
 * `strict` turns that last part off, for a column backed by a CLOSED list. The box still
 * filters as you type, but text matching nothing snaps back to what the cell held: the
 * Company column stores a foreign key into the catalog in Configuration > HR > Company, and
 * a spelling nobody maintains is the exact thing that catalog exists to prevent. Typing an
 * exact match still selects it, so the keyboard route survives.
 *
 * The menu is positioned `fixed` from the input's own rect rather than absolutely inside the
 * cell: the table wrapper scrolls (`overflow-y: auto`), and an absolutely positioned menu on
 * the last visible row would be clipped by it. It closes on scroll for the same reason —
 * a fixed menu does not follow the row it belongs to.
 *
 * `options` is [{ key, label, sublabel }]. `sublabel` is searched too, so an employee can be
 * found by their team.
 */

// Enough to fill the menu twice over; past that the list is a scroll marathon, not a picker,
// and the user is better served by typing.
const MAX_SUGGESTIONS = 60;
const MENU_MAX_HEIGHT = 240;

const BonusComboCell = ({
    value,
    options = [],
    onSelect,
    onCommitText,
    placeholder,
    title,
    strict = false,
    className = '',
    emptyLabel = 'No matches.',
    // An approved bonus period locks its cells. readOnly rather than disabled so the value
    // is still selectable and copyable -- the data is frozen, not taken away.
    readOnly = false
}) => {
    const [draft, setDraft] = useState(value ?? '');
    const [dirty, setDirty] = useState(false);
    const [lastValue, setLastValue] = useState(value);
    const [menuRect, setMenuRect] = useState(null);
    const inputRef = useRef(null);

    // Re-seeds the box when the row's value moves under it — a reload, a rolled-back edit,
    // or the selection that just fired. Adjusted during render rather than in an effect so
    // the input never paints a frame showing the value it is about to drop.
    if (value !== lastValue) {
        setLastValue(value);
        setDraft(value ?? '');
        setDirty(false);
    }

    // A fixed menu cannot follow its row, so any scroll (the table's or the page's) closes
    // it instead of leaving it stranded over the wrong cell. Capture phase: the scroll
    // happens on the wrapper, not on window.
    useEffect(() => {
        if (!menuRect) return undefined;
        const close = () => setMenuRect(null);
        window.addEventListener('scroll', close, true);
        window.addEventListener('resize', close);
        return () => {
            window.removeEventListener('scroll', close, true);
            window.removeEventListener('resize', close);
        };
    }, [menuRect]);

    const suggestions = useMemo(() => {
        // Only what the user actually typed narrows the list; simply clicking into a cell
        // shows everything, rather than only the one value already in it.
        // Word by word over label-and-sublabel together, the same rule the "+ Add Employee"
        // picker uses. DeskTime holds people under their full legal name, so a contiguous
        // match makes "nicolas lauria" miss "Nicolás Andrés Lauría" and the cell offers
        // nothing for a person who is plainly on the roster.
        const tokens = dirty ? normalizeForSearch(draft).split(/\s+/).filter(Boolean) : [];
        const matches = tokens.length === 0
            ? options
            : options.filter(option => {
                const haystack = `${normalizeForSearch(option.label)} ${normalizeForSearch(option.sublabel || '')}`;
                return tokens.every(token => haystack.includes(token));
            });
        return matches.slice(0, MAX_SUGGESTIONS);
    }, [options, draft, dirty]);

    const openMenu = () => {
        if (!inputRef.current) return;
        setMenuRect(inputRef.current.getBoundingClientRect());
    };

    const commitText = () => {
        setMenuRect(null);
        if (!dirty) return;
        setDirty(false);
        const text = draft.trim();
        if (text === (value ?? '')) return;

        if (strict) {
            // The typed text is only ever a shortcut to an option here, never a value of
            // its own. An exact match (ignoring case and accents, as everywhere else)
            // counts as having picked it; anything else puts the cell back.
            const match = options.find(
                option => normalizeForSearch(option.label) === normalizeForSearch(text)
            );
            if (match) {
                setDraft(match.label);
                onSelect(match);
            } else {
                setDraft(value ?? '');
            }
            return;
        }

        // A caller may refuse the text (a cancelled duplicate-name confirm) by returning
        // false. The box then snaps back to the row's real value on its own — without this
        // it would keep showing a name the row never took, since the reseed above only
        // fires when the row's value actually moves.
        if (onCommitText(text) === false) {
            setDraft(value ?? '');
        }
    };

    const handleSelect = (option) => {
        setDirty(false);
        setMenuRect(null);
        if (onSelect(option) === false) {
            setDraft(value ?? '');
            return;
        }
        setDraft(option.label);
    };

    // Flips above the cell when there is not room below, so the last rows of a full table
    // still get a usable menu.
    const menuStyle = menuRect && (() => {
        const openUpwards = menuRect.bottom + MENU_MAX_HEIGHT > window.innerHeight;
        return {
            left: menuRect.left,
            width: Math.max(menuRect.width, 240),
            maxHeight: MENU_MAX_HEIGHT,
            ...(openUpwards
                ? { bottom: window.innerHeight - menuRect.top + 4 }
                : { top: menuRect.bottom + 4 })
        };
    })();

    return (
        <div className="bonus-combo-cell">
            <input
                ref={inputRef}
                type="text"
                className={`bonus-cell-input bonus-combo-input ${className}`}
                value={draft}
                placeholder={readOnly ? '' : placeholder}
                title={title}
                readOnly={readOnly}
                // The picker never opens while locked, so there is no menu to choose a new
                // employee or team from either.
                onFocus={readOnly ? undefined : openMenu}
                onClick={readOnly ? undefined : openMenu}
                onChange={(e) => { setDraft(e.target.value); setDirty(true); openMenu(); }}
                onBlur={readOnly ? undefined : commitText}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') {
                        setDraft(value ?? '');
                        setDirty(false);
                        setMenuRect(null);
                        e.currentTarget.blur();
                    }
                }}
            />

            {menuRect && (
                // Swallowing mousedown keeps the input focused through the click, so onBlur
                // does not fire (and commit the half-typed filter text) before onClick runs.
                <div
                    className="bonus-combo-menu"
                    style={menuStyle}
                    onMouseDown={(e) => e.preventDefault()}
                >
                    {suggestions.map(option => (
                        <button
                            key={option.key}
                            type="button"
                            className={`bonus-combo-option ${option.label === value ? 'is-active' : ''}`}
                            onClick={() => handleSelect(option)}
                        >
                            <span className="bonus-combo-option-label">{option.label}</span>
                            {option.sublabel && (
                                <span className="bonus-combo-option-sub">{option.sublabel}</span>
                            )}
                        </button>
                    ))}
                    {suggestions.length === 0 && (
                        <div className="bonus-combo-empty">{emptyLabel}</div>
                    )}
                </div>
            )}
        </div>
    );
};

export default BonusComboCell;
