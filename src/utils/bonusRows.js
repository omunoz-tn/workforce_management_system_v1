/**
 * bonusRows.js — the arithmetic and the verdicts behind HR > Bonus, as pure functions.
 *
 * Lifted out of BonusHomeOffice.jsx, which had grown to hold its own maths, its own column
 * descriptors, its own cells and its own screen. Nothing here touches React, the DOM or the
 * network: every function takes a row (or a set of them) and a column descriptor and returns
 * an answer, which is what makes the whole set exercisable outside a browser — and the
 * reason the List's filtering and sorting can now be tested without rendering a table.
 *
 * A "column" here is one of the descriptors in bonusColumns.js: an object with `type` and a
 * `value(row)` reader. These functions never read a row's fields directly, only through that
 * reader, which is what keeps one definition of "the Team column's value" for sorting,
 * filtering and export alike.
 */
import { normalizeForSearch } from './search.js';

/**
 * The day rate times the days worked, capped at the bonus itself.
 *
 * Duplicated from bonusEarnedAmount() in BonusSql.php on purpose: the server's figure is
 * what the API hands to any other consumer, but a cell being edited has to re-total before
 * the round trip finishes, and a spinner where the amount should be reads as a bug. Keep
 * the two in step.
 */
export const earnedAmount = (bonusAmount, daysWorked, workdays) => {
    const amount = Number(bonusAmount) || 0;
    const days = Number(daysWorked) || 0;
    const total = Number(workdays) || 0;
    if (total <= 0 || days <= 0) return 0;
    return Math.min(amount, days * (amount / total));
};

/** Per-currency { budget, earned } subtotals over a set of rows. */
export const totalsOf = (rows) => {
    const totals = new Map();
    rows.forEach(row => {
        const current = totals.get(row.currency) || { budget: 0, earned: 0 };
        current.budget += Number(row.bonus_amount) || 0;
        current.earned += earnedAmount(row.bonus_amount, row.days_worked, row.workdays);
        totals.set(row.currency, current);
    });
    return totals;
};

/** "11/09/2026 14:32" from the SQL datetime the approval endpoint returns. */
export const formatApprovalMoment = (value) => {
    if (!value) return '';
    // The space between date and time is not ISO, and Safari refuses it outright.
    const parsed = new Date(String(value).replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toLocaleString();
};

/** Does this filter value actually narrow anything? Drives the funnel's lit state and the count. */
export const isFilterActive = (column, filter, options) => {
    if (!filter) return false;
    if (column.type === 'text') return (filter.text || '').trim() !== '';
    if (column.type === 'number') {
        return (filter.min ?? '') !== '' || (filter.max ?? '') !== ''
            || (!!column.flag && !!filter.flag);
    }
    // A list filter is only a filter while something is unticked.
    return (filter.values?.length ?? options.length) < options.length;
};

/** One column's verdict on one row. Columns AND together in listRows below. */
export const rowMatchesFilter = (column, filter, row) => {
    if (!filter) return true;
    const value = column.value(row);

    if (column.type === 'text') {
        const term = normalizeForSearch((filter.text || '').trim());
        return term === '' || normalizeForSearch(String(value ?? '')).includes(term);
    }

    if (column.type === 'number') {
        // Asked before the bounds and independently of them: "show me the hand-corrected
        // ones" is a whole answer by itself, and a row with no number still has an answer.
        if (column.flag && filter.flag && column.flag.of(row) !== filter.flag) return false;

        // Rows with no value (a manual row has no ID) cannot satisfy a bound, so a bounded
        // filter excludes them rather than treating the gap as zero.
        if (value === null || value === undefined || value === '') {
            return (filter.min ?? '') === '' && (filter.max ?? '') === '';
        }
        const number = Number(value);
        if ((filter.min ?? '') !== '' && !(number >= Number(filter.min))) return false;
        if ((filter.max ?? '') !== '' && !(number <= Number(filter.max))) return false;
        return true;
    }

    return (filter.values ?? []).includes(value);
};

/**
 * The toolbar search: ID, Employee Name, Team and Company answered by one box.
 *
 * Every word has to land somewhere, but they do not all have to land in the SAME field —
 * "adan aci" finds Adán on the ACI team, and "aci tn" finds that team's TN Outsourcing
 * people. That is how somebody narrows a list they are already looking at, and it costs one
 * `every` over a joined haystack. Tokens are split on whitespace, so none of them can span
 * the boundary between two fields and match something nobody wrote.
 *
 * normalizeForSearch is applied to both sides, so a plain keyboard finds "Muñoz" — and it
 * takes a string, hence the String() around an employee_id that arrives as a number.
 */
const SEARCH_FIELDS = [
    (row) => row.employee_id,
    (row) => row.employee_name,
    (row) => row.team_name,
    (row) => row.company_name
];

export const rowMatchesSearch = (row, tokens) => {
    if (tokens.length === 0) return true;
    const haystack = SEARCH_FIELDS
        .map(field => normalizeForSearch(String(field(row) ?? '')))
        .join(' ');
    return tokens.every(token => haystack.includes(token));
};

/**
 * Comparator for one column, with anything empty pushed to the end in BOTH directions.
 *
 * Sorting nulls as 0 or as '' puts the manual rows — the ones with no DeskTime id and no
 * comment — at the top of every ascending sort, which buries what the user actually asked
 * to see. Absent is not small; it is absent.
 */
export const compareRows = (column, direction) => (a, b) => {
    const left = column.value(a);
    const right = column.value(b);
    const leftEmpty = left === null || left === undefined || left === '';
    const rightEmpty = right === null || right === undefined || right === '';

    if (leftEmpty || rightEmpty) return leftEmpty && rightEmpty ? 0 : (leftEmpty ? 1 : -1);

    const order = column.type === 'number'
        ? Number(left) - Number(right)
        : String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });

    return direction === 'asc' ? order : -order;
};
