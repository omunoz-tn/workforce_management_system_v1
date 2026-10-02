import React, { useState } from 'react';
import { currencyClass, formatBonusAmount, sanitizeAmountInput } from '../utils/currency';

/**
 * BonusEditableCells.jsx — the three one-field cells the Bonus List edits in place.
 *
 * Lifted out of BonusHomeOffice.jsx, which had grown to hold the screen, its table, its
 * arithmetic and these. They share one contract, which is the reason they belong together
 * rather than in three files: each holds a draft of its own, commits on blur and on Enter,
 * reverts on Escape, and re-seeds itself when the row's value moves underneath it.
 *
 * `readOnly` is the approved-period lock. It leaves the value selectable and copyable --
 * an approved month is frozen, not taken away -- and the server refuses the write either
 * way (BonusApproval.php); this only removes the affordance.
 *
 * They take a value and an onCommit, never a row and never a save function, so none of them
 * knows what a bonus is. That is what keeps them reusable and what kept this extraction
 * mechanical.
 */

/**
 * Text cell that only reports a change once the user is done with it.
 *
 * Saving on every keystroke would fire a request per letter; saving on blur alone would lose
 * the edit of anyone who tabs away expecting Enter to have committed it. Both commit — Enter
 * by blurring the field — and `dirty` keeps a blur that follows no typing (tabbing through
 * the row, or a re-render) from firing a save at all.
 */
export const EditableTextCell = ({ value, onCommit, placeholder, title, className = '', readOnly = false }) => {
    const [draft, setDraft] = useState(value ?? '');
    const [dirty, setDirty] = useState(false);
    const [lastValue, setLastValue] = useState(value);

    // Re-seeds the box whenever the row's own value moves under it — a reload, another
    // cell's save, a rolled-back edit. Adjusted during render rather than in an effect:
    // the input must never paint one frame showing the value it is about to drop.
    if (value !== lastValue) {
        setLastValue(value);
        setDraft(value ?? '');
        setDirty(false);
    }

    const commit = () => {
        if (!dirty) return;
        setDirty(false);
        if ((draft ?? '') !== (value ?? '')) onCommit(draft);
    };

    return (
        <input
            type="text"
            className={`bonus-cell-input ${className}`}
            value={draft}
            placeholder={readOnly ? '' : placeholder}
            title={title}
            readOnly={readOnly}
            onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraft(value ?? ''); setDirty(false); e.currentTarget.blur(); }
            }}
        />
    );
};

/**
 * Days Employee Worked. Digits only — which is what rules a negative out, there being no
 * minus key to press — and clamped to `max`, the month's Workdays, because a bonus cannot be
 * earned on a day the month did not have. An empty box means "back to the computed figure".
 */
export const EditableDaysCell = ({ value, isOverridden, autoValue, max, onCommit, readOnly = false }) => {
    const [draft, setDraft] = useState(String(value ?? ''));
    const [dirty, setDirty] = useState(false);
    const [lastValue, setLastValue] = useState(value);

    if (value !== lastValue) {
        setLastValue(value);
        setDraft(String(value ?? ''));
        setDirty(false);
    }

    const commit = () => {
        if (!dirty) return;
        setDirty(false);
        const cleaned = draft.replace(/[^\d]/g, '');
        if (cleaned === '') {
            setDraft(String(autoValue ?? 0));
            if (isOverridden) onCommit(null);
            return;
        }
        // Clamped here rather than rejected: someone typing 25 into a 22-workday month meant
        // "all of them", and bouncing the edit back would make them guess the number.
        const clamped = Math.min(Number(cleaned), max);
        setDraft(String(clamped));
        if (clamped !== Number(value)) onCommit(clamped);
    };

    return (
        <input
            type="text"
            inputMode="numeric"
            className={`bonus-cell-input bonus-cell-number ${isOverridden ? 'is-overridden' : ''}`}
            value={draft}
            readOnly={readOnly}
            title={readOnly
                ? (isOverridden ? `Manually set. Computed value: ${autoValue}.` : 'Computed automatically.')
                : isOverridden
                    ? `Manually set. Computed value: ${autoValue}. Clear the box to go back to it. Maximum ${max}.`
                    : `Computed automatically. Type a number (0 to ${max}) to override it.`}
            onChange={(e) => { setDraft(e.target.value.replace(/[^\d]/g, '')); setDirty(true); }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraft(String(value ?? '')); setDirty(false); e.currentTarget.blur(); }
            }}
        />
    );
};

/**
 * The Bonus Amount cell.
 *
 * Reads as money — "RD$ 5,000.00", tinted by currency, exactly like Total Amount Earned
 * beside it — and only turns into a bare, typable number while it has focus. Thousands
 * separators and a currency symbol cannot live in a field being typed into (every keystroke
 * would fight the caret), so the two states are the answer: formatted at rest, raw while
 * editing. `formatBonusAmount` is the same function the Earned column uses, which is what
 * keeps the pair from drifting apart.
 */
export const EditableAmountCell = ({ value, currency, onCommit, readOnly = false }) => {
    const raw = (Number(value) || 0).toFixed(2);
    const [draft, setDraft] = useState(raw);
    const [focused, setFocused] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [lastValue, setLastValue] = useState(value);

    if (value !== lastValue) {
        setLastValue(value);
        setDraft(raw);
        setDirty(false);
    }

    const commit = () => {
        setFocused(false);
        if (!dirty) return;
        setDirty(false);
        const parsed = Number(draft);
        if (draft === '' || Number.isNaN(parsed)) {
            setDraft(raw);
            return;
        }
        if (parsed !== Number(value)) onCommit(parsed);
        setDraft(parsed.toFixed(2));
    };

    return (
        <input
            type="text"
            inputMode="decimal"
            className={`bonus-cell-input bonus-cell-amount-input ${focused ? 'is-editing' : currencyClass(currency)}`}
            value={focused ? draft : formatBonusAmount(value, currency)}
            readOnly={readOnly}
            // A read-only cell never enters the raw-number state: there is nothing to type,
            // so it stays formatted money whether or not it has focus.
            onFocus={() => { if (!readOnly) { setDraft(raw); setFocused(true); } }}
            onChange={(e) => { setDraft(sanitizeAmountInput(e.target.value)); setDirty(true); }}
            onBlur={commit}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraft(raw); setDirty(false); e.currentTarget.blur(); }
            }}
        />
    );
};
