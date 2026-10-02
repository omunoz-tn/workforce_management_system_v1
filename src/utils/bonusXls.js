/**
 * bonusXls.js — the Bonus list as a styled Excel table.
 *
 * Pure string-building, no DOM: BonusHomeOffice hands it the rows currently on screen and
 * downloads whatever comes back through utils/xls.js. Kept separate from the component so
 * the output can be exercised outside a browser.
 *
 * The colours are the module's own, at their LIGHT-theme values: Excel sheets are white,
 * whatever theme the app was in when the button was pressed. Pesos blue, dollars green —
 * the same pairing every screen of HR > Bonus uses — and the navy the report cards carry
 * for the header band. If BonusCurrencySelect.css ever changes the pairing, change it here
 * too.
 */
import { escapeXlsValue } from './xls.js';
import { currencyOf } from './currency.js';

const NAVY = '#1b2d46';
const CURRENCY_COLOR = { DOP: '#2563eb', USD: '#16a34a' };
const BORDER = 'border:1px solid #cbd5e1;';
const ZEBRA = '#f4f6fa';

// A real number with a display format, not text that looks like one — finance sums these.
const MONEY_FORMAT = "mso-number-format:'#,##0.00';";

const cell = (value, style = '') => `<td style="${BORDER}${style}">${value}</td>`;
const text = (value, style = '') => cell(escapeXlsValue(value), style);
const money = (value, currencyCode, extra = '') => cell(
    (Number(value) || 0).toFixed(2),
    `${MONEY_FORMAT}text-align:right;color:${CURRENCY_COLOR[currencyCode] || '#000'};${extra}`
);
const number = (value, extra = '') => cell(
    value === null || value === undefined ? '' : String(value),
    `text-align:center;${extra}`
);

const HEADERS = [
    ['ID', 55], ['Employee Name', 210], ['Team', 150], ['Company', 140],
    ['Days Worked', 90], ['Workdays', 80], ['Bonus Amount', 110], ['Currency', 70],
    ['Total Amount Earned', 130], ['Comments', 220]
];

/**
 * The sheet: a navy title band, the column headers, one zebra-striped row per employee with
 * the module's currency colours, and a bold total per currency at the foot.
 *
 * `rows` are the List view's own row objects, already filtered and sorted — the export is
 * what the user is looking at, the same rule the Run Rate's CSV export follows. `earned`
 * computes Total Amount Earned so this module cannot drift from the screen's formula.
 */
export const buildBonusXlsTable = ({ rows, periodLabel, generatedAt, earned }) => {
    const columnCount = HEADERS.length;

    const title = `<tr><td colspan="${columnCount}" style="background:${NAVY};color:#ffffff;`
        + 'font-size:14pt;font-weight:bold;padding:8px;">'
        + 'Bonus Home Office / Transportation</td></tr>';

    const subtitle = `<tr><td colspan="${columnCount}" style="background:${NAVY};color:#cbd5e1;`
        + `padding:4px 8px;">${escapeXlsValue(periodLabel)} · ${rows.length} employee${rows.length === 1 ? '' : 's'}`
        + ` · exported ${escapeXlsValue(generatedAt)}</td></tr>`;

    const head = '<tr>' + HEADERS.map(([label, width]) =>
        `<th width="${width}" style="${BORDER}background:${NAVY};color:#ffffff;`
        + `font-weight:bold;text-align:left;padding:4px 6px;">${label}</th>`
    ).join('') + '</tr>';

    const body = rows.map((row, index) => {
        const stripe = index % 2 === 1 ? `background:${ZEBRA};` : '';
        // The screen marks a hand-typed day count with a dotted underline; Excel's closest
        // faithful rendering is an underline, so a reviewer can still tell corrected days
        // from computed ones.
        const daysStyle = row.days_worked_override !== null ? 'text-decoration:underline;' : '';

        return '<tr>'
            + number(row.employee_id ?? '—', `${stripe}color:#64748b;`)
            + text(row.employee_name, stripe)
            + text(row.team_name || '', stripe)
            + text(row.company_name || '', stripe)
            + number(row.days_worked, stripe + daysStyle)
            + number(row.workdays, stripe)
            + money(row.bonus_amount, row.currency, stripe)
            + text(currencyOf(row.currency).symbol, `${stripe}text-align:center;color:${CURRENCY_COLOR[row.currency]};font-weight:bold;`)
            + money(earned(row), row.currency, `${stripe}font-weight:bold;`)
            + text(row.comments || '', `${stripe}color:#64748b;`)
            + '</tr>';
    }).join('');

    // One foot line per currency actually present — mixing pesos and dollars into one sum
    // is exactly what this module refuses to do everywhere else.
    const totals = ['DOP', 'USD']
        .filter(code => rows.some(row => row.currency === code))
        .map(code => {
            const subset = rows.filter(row => row.currency === code);
            const bonus = subset.reduce((sum, row) => sum + (Number(row.bonus_amount) || 0), 0);
            const earnedSum = subset.reduce((sum, row) => sum + earned(row), 0);
            const bold = `font-weight:bold;color:${CURRENCY_COLOR[code]};`;

            return '<tr>'
                + `<td colspan="6" style="${BORDER}${bold}text-align:right;padding-right:6px;">`
                + `Total ${currencyOf(code).symbol} (${subset.length})</td>`
                + money(bonus, code, 'font-weight:bold;')
                + cell('', '')
                + money(earnedSum, code, 'font-weight:bold;')
                + cell('', '')
                + '</tr>';
        }).join('');

    return `<table cellspacing="0">${title}${subtitle}${head}${body}${totals}</table>`;
};

/** "Bonus_Home_Office_Transportation_August_2026.xls" */
export const bonusXlsFilename = (periodLabel) =>
    `Bonus_Home_Office_Transportation_${String(periodLabel).replace(/\s+/g, '_')}.xls`;
