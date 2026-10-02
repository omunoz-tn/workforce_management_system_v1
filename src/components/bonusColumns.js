/**
 * bonusColumns.js — what the Bonus List's columns ARE, apart from how they are drawn.
 *
 * The descriptor table and the handful of widths derived from it, lifted out of
 * BonusHomeOffice.jsx. Keeping them here rather than in utils/ is deliberate: these are
 * facts about one screen's table, not general helpers, and `display` and `chrome` only mean
 * anything to the auto-fit that measures a rendered cell.
 *
 * It exports no component and touches no DOM, so it is plain .js, not .jsx.
 */
import { earnedAmount } from '../utils/bonusRows.js';
import { formatBonusAmount } from '../utils/currency.js';

/** Shown in the Company cell's menu, and in the cell itself while it holds no company. */
export const NO_COMPANY_LABEL = '— No company —';

/**
 * Every column the header row offers a sort and a filter for, in display order.
 *
 * One descriptor list rather than nine hand-written headers and nine bespoke dropdowns:
 * `type` is what BonusColumnFilter reads to decide between a search box, a checkbox list
 * and a min/max pair, and `value` is the single definition of what the column holds — used
 * by the sort, the filter and the list of choices alike, so the three can never disagree
 * about what "Company" means.
 *
 * The Actions column is absent on purpose: there is nothing in it to sort or filter by.
 */
export const BONUS_COLUMNS = [
    { id: 'employee_id', label: 'ID', className: 'bonus-col-id', type: 'number', width: 78, chrome: 36, value: (row) => row.employee_id },
    { id: 'employee_name', label: 'Employee Name', className: 'bonus-col-name', type: 'text', width: 172, chrome: 36 + 22, value: (row) => row.employee_name || '' },
    // `shared` marks the one filter that is not this table's own: Team is the selection the
    // toolbar dropdown edits, shown a second time here rather than duplicated.
    { id: 'team_name', label: 'Team', className: 'bonus-col-team', type: 'list', shared: 'teams', width: 165, chrome: 36 + 22, value: (row) => row.team_name || 'No team' },
    { id: 'company_name', label: 'Company', className: 'bonus-col-company', type: 'list', width: 143, chrome: 36, value: (row) => row.company_name || NO_COMPANY_LABEL },
    {
        id: 'days_worked', label: 'Days Employee Worked / Workdays', className: 'bonus-col-days',
        type: 'number', width: 198,
        // Cell padding, the input's own padding, and the 44px lane the breakdown and reset
        // buttons share.
        chrome: 36 + 44,
        value: (row) => row.days_worked,
        // The cell is two fixed-width boxes and a slash, so what it displays never gets
        // wider than this — measuring the numbers would size it to nothing.
        display: () => '00 / 00',
        // A second dimension on the same column: min/max asks how many days, this asks who
        // decided them. The row carries an override only when somebody typed over the
        // computed number, which is the same test the cell's own "reset" marker uses — one
        // definition of "corrected by hand", not two that can drift.
        flag: {
            label: 'Days set by',
            of: (row) => (row.days_worked_override !== null ? 'manual' : 'auto'),
            options: [
                { id: 'auto', label: 'Auto', hint: 'Left as the schedule computed it' },
                { id: 'manual', label: 'Manual', hint: 'Typed over by hand' }
            ]
        }
    },
    {
        id: 'bonus_amount', label: 'Bonus Amount', className: 'bonus-col-amount',
        type: 'number', width: 214,
        // Cell padding, the input's own padding, the flag button and the gap before it.
        chrome: 36 + 42,
        value: (row) => Number(row.bonus_amount) || 0,
        display: (row) => formatBonusAmount(row.bonus_amount, row.currency)
    },
    {
        id: 'total_earned', label: 'Total Amount Earned', className: 'bonus-col-earned',
        type: 'number', width: 214, chrome: 24,
        value: (row) => earnedAmount(row.bonus_amount, row.days_worked, row.workdays),
        display: (row) => formatBonusAmount(
            earnedAmount(row.bonus_amount, row.days_worked, row.workdays), row.currency
        )
    },
    { id: 'comments', label: 'Comments', className: 'bonus-col-comments', type: 'text', width: 143, chrome: 36, value: (row) => row.comments || '' }
];

// Not resizable and not in BONUS_COLUMNS: there is nothing in it to fit to.
export const ACTIONS_COLUMN_WIDTH = 52;

export const MIN_COLUMN_WIDTH = 56;
// What an auto-fit adds on top of the widest text: the header's own lane for the sort
// arrows and the funnel, plus the gap before it.
export const HEADER_TOOLS_WIDTH = 26;

export const DEFAULT_COLUMN_WIDTHS = Object.fromEntries(
    BONUS_COLUMNS.map(column => [column.id, column.width])
);

/** Which column ids a stored sort may name — see reportPreferences. */
export const SORTABLE_IDS = BONUS_COLUMNS.map(column => column.id);
