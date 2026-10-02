import React, { useState } from 'react';
import './BonusCurrencySelect.css';
import { BONUS_CURRENCIES, currencyClass, currencyOf } from '../utils/currency';

/**
 * The pesos/dollars picker, shared by the Add Employee modal and the Bonus list's own
 * Bonus Amount cells — the same choice in both places, so it is the same control.
 *
 * A native <select> cannot lay an option out as "label on the left, flag against the right
 * edge", nor tint one option blue and the other green, which is exactly what this field is
 * specified to do; hence the hand-rolled menu.
 *
 * `compact` strips the trigger down to the flag alone, for the table cell: the amount right
 * beside it already prints "RD$", so the button was saying it a second time 8px away. The
 * menu still carries the full labels either way — with a bare flag on the button, the menu
 * is where the currency is actually named, and the tooltip and aria-label cover the rest.
 */
const BonusCurrencySelect = ({ value, onChange, compact = false, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const active = currencyOf(value);

    return (
        <div className={`bonus-currency-dropdown ${compact ? 'is-compact' : ''}`}>
            <button
                type="button"
                className="bonus-currency-trigger"
                onClick={() => setIsOpen(open => !open)}
                disabled={disabled}
                title={active.label}
                aria-label={active.label}
            >
                {!compact && (
                    <span className={`bonus-currency-label ${currencyClass(active.code)}`}>
                        {active.label}
                    </span>
                )}
                <span className="bonus-currency-flag">{active.flag}</span>
                <span className="bonus-currency-caret">▾</span>
            </button>

            {isOpen && (
                <>
                    <div className="bonus-dropdown-overlay" onClick={() => setIsOpen(false)} />
                    <div className="bonus-currency-menu">
                        {BONUS_CURRENCIES.map(option => (
                            <button
                                key={option.code}
                                type="button"
                                className={`bonus-currency-option ${value === option.code ? 'is-active' : ''}`}
                                onClick={() => { onChange(option.code); setIsOpen(false); }}
                            >
                                <span className={`bonus-currency-label ${currencyClass(option.code)}`}>
                                    {option.label}
                                </span>
                                <span className="bonus-currency-flag">{option.flag}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

export default BonusCurrencySelect;
