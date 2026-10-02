/**
 * currency.js — the two currencies a bonus can be paid in, and how they are written.
 *
 * Tinting an amount is the whole point of the pairing: a reader has to tell pesos from
 * dollars at a glance in a table that mixes them, so blue-for-pesos / green-for-dollars has
 * to hold everywhere the amount appears — the List view's cells, the Grid view's team
 * totals and the Add Employee modal alike. The colours themselves live in
 * BonusCurrencySelect.css (`.bonus-money-dop` / `.bonus-money-usd`) rather than here,
 * because each needs a second value for dark mode; currencyClass() below is how a component
 * asks for the right one.
 *
 * `code` is what the API stores (the `currency` enum of org_bonus_employees).
 */
export const BONUS_CURRENCIES = [
    {
        code: 'DOP',
        symbol: 'RD$',
        label: 'Dominican Pesos (RD$)',
        flag: '🇩🇴'
    },
    {
        code: 'USD',
        symbol: 'US$',
        label: 'US Dollars (US$)',
        flag: '🇺🇸'
    }
];

export const DEFAULT_CURRENCY = 'DOP';

/** The definition for a stored code, falling back to the default rather than returning undefined. */
export const currencyOf = (code) =>
    BONUS_CURRENCIES.find(c => c.code === code) || BONUS_CURRENCIES[0];

/** Class that tints text in this currency's colour, in either theme. */
export const currencyClass = (code) => `bonus-money-${currencyOf(code).code.toLowerCase()}`;

/**
 * "RD$ 12,500.00" — the symbol, then the amount with thousands separators and exactly two
 * decimals. Grouping comes from Intl rather than the currency formatter's own output
 * because `RD$` is the symbol this organization writes, not the `DOP` Intl would print.
 */
export const formatBonusAmount = (amount, code) => {
    const value = Number(amount) || 0;
    return `${currencyOf(code).symbol} ${value.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
};

/**
 * Digits and at most one decimal point, for a currency field being typed into. Keeping the
 * raw string (rather than a parsed number) is what lets somebody type "1500." on the way to
 * "1500.50" without the field fighting them; parse it with Number() on save.
 */
export const sanitizeAmountInput = (raw) => {
    const cleaned = String(raw ?? '').replace(/[^\d.]/g, '');
    const [whole, ...rest] = cleaned.split('.');
    return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole;
};
