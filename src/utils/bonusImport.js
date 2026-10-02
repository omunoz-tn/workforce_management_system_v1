/**
 * bonusImport.js — turns an uploaded spreadsheet into rows the Bonus month can accept.
 *
 * Pure functions over the sheet's raw cells (SheetJS's header:1 output), no DOM and no
 * fetch, so the whole mapping — header detection, aliasing, currency parsing, roster
 * matching, duplicate detection — can be exercised outside a browser. The modal only feeds
 * it and renders what comes back.
 *
 * The philosophy is the template's: people will hand this files with Spanish headers,
 * "RD$ 5,000.00" pasted into the amount column, and a title row above everything. Every one
 * of those is normal, not an error. What IS an error gets a line number and a sentence,
 * because "row 14: enter a bonus amount" is fixable and "invalid file" is not.
 */
import { normalizeForSearch } from './search.js';
import { DEFAULT_CURRENCY, currencyOf } from './currency.js';

/** The columns a file may carry. Only name, amount and currency are truly required. */
const HEADER_ALIASES = {
    employee_id: ['id', 'employeeid', 'desktimeid', 'iddesktime', 'idempleado'],
    employee_name: ['employeename', 'employee', 'name', 'nombre', 'empleado', 'nombreempleado', 'nombredelempleado'],
    team_name: ['team', 'teamname', 'equipo'],
    company_name: ['company', 'companyname', 'compania', 'empresa'],
    bonus_amount: ['bonusamount', 'amount', 'monto', 'bono', 'montobono', 'montodelbono'],
    currency: ['currency', 'moneda', 'divisa'],
    comments: ['comments', 'comment', 'comentario', 'comentarios', 'nota', 'notas']
};

/**
 * The header the downloadable template writes, in order — the plain-language spelling of
 * the aliases above, kept beside them so the two cannot drift apart.
 */
export const TEMPLATE_HEADERS = [
    'ID', 'Employee Name', 'Team', 'Company', 'Bonus Amount', 'Currency', 'Comments'
];

export const BONUS_TEMPLATE_FILENAME = 'Bonus_Import_Template.csv';

/**
 * The template offered for download, as rows for utils/csv: the header row and nothing else.
 *
 * CSV, and deliberately so. The styled .xls this used to be was an HTML table with an .xls
 * name, and Excel re-saving one of those emits a layout table ahead of the data — which the
 * reader turns into a separate first sheet, and which is what made a filled-in template come
 * back "no header row". A CSV has one shape, survives a round trip through any spreadsheet,
 * and is read back by the same parser below. Plain beats pretty for a file whose whole job
 * is to come back.
 *
 * Bare on purpose: an instruction band and example rows are things the person filling this
 * in has to delete first, and the guidance they carried is already on screen in the Import
 * List modal that hands the file over. The parser still skips a preamble and still ignores
 * EJEMPLO rows, so a copy of the older template keeps working.
 */
export const buildBonusTemplateRows = () => [TEMPLATE_HEADERS];

/** "Bonus Amount", "MONTO DEL BONO ", "Compañía" — all reduced to bare comparable stems. */
const normalizeHeader = (value) =>
    normalizeForSearch(String(value ?? '')).replace(/[^a-z0-9]/g, '');

/** DOP/USD out of whatever the cell says: "RD$", "pesos", "US Dollars (US$)", "dolares"… */
export const normalizeCurrency = (value) => {
    const raw = normalizeForSearch(String(value ?? '')).replace(/[^a-z$]/g, '');
    if (raw === '') return null;
    if (/(dop|rd\$?|peso|dominican)/.test(raw)) return 'DOP';
    if (/(usd|us\$?|dollar|dolar)/.test(raw)) return 'USD';
    return null;
};

/** "RD$ 5,000.00" -> 5000. Currency letters and grouping are dressing, not data. */
export const parseAmount = (value) => {
    if (typeof value === 'number') return value;
    const cleaned = String(value ?? '').replace(/[^\d.,-]/g, '');
    if (cleaned === '') return NaN;
    // A comma followed by exactly 3 digits is a thousands separator; a trailing ",xx" is a
    // decimal comma. Handle both, since files here come from both conventions.
    const normalized = /,\d{1,2}$/.test(cleaned)
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
    return Number(normalized);
};

/**
 * Finds the header row and says which column index feeds which field. Scanned rather than
 * assumed to be row one: the downloadable template itself opens with a title band, and any
 * file exported from this module does too.
 */
export const findHeaderRow = (sheetRows) => {
    // Deep enough to clear whatever preamble a round-trip through Excel adds: the template's
    // own title and instruction band are three rows, and re-saving pads that with spacer
    // rows of its own. Cheap either way — it stops at the first row that looks like a header.
    const limit = Math.min(sheetRows.length, 25);
    for (let index = 0; index < limit; index++) {
        const cells = sheetRows[index] || [];
        const map = {};
        cells.forEach((cell, column) => {
            const stem = normalizeHeader(cell);
            for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
                if (aliases.includes(stem) && map[field] === undefined) map[field] = column;
            }
        });
        // A real header names at least the employee and the amount.
        if (map.employee_name !== undefined && map.bonus_amount !== undefined) {
            return { rowIndex: index, columns: map };
        }
    }
    return null;
};

/**
 * The whole mapping. Returns:
 *   rows     — importable rows, each already resolved against the roster and the company
 *              catalog, with `line` pointing back at the spreadsheet
 *   errors   — rows that cannot be imported, with the reason
 *   examples — template example rows, silently set aside (names starting with "ejemplo" /
 *              "example"): forgetting to delete them must not seed the month with fakes
 */
export const mapImportRows = (sheetRows, { roster = [], companies = [] } = {}) => {
    const header = findHeaderRow(sheetRows);
    if (!header) {
        return { rows: [], errors: [], examples: 0, headerFound: false };
    }

    const { rowIndex, columns } = header;
    const cellAt = (cells, field) =>
        columns[field] === undefined ? '' : (cells[columns[field]] ?? '');

    const rosterById = new Map(roster.map(emp => [Number(emp.id), emp]));
    const rosterByName = new Map(roster.map(emp => [normalizeForSearch(emp.name), emp]));
    const companyByName = new Map(companies.map(c => [normalizeForSearch(c.name), c]));

    const rows = [];
    const errors = [];
    let examples = 0;
    const seenIds = new Set();
    const seenNames = new Set();

    for (let index = rowIndex + 1; index < sheetRows.length; index++) {
        const cells = sheetRows[index] || [];
        const line = index + 1; // 1-based, as the spreadsheet shows it.
        const fail = (reason) => errors.push({ line, name: name || '(no name)', reason });

        const name = String(cellAt(cells, 'employee_name') ?? '').trim();
        const everythingElseEmpty = ['employee_id', 'team_name', 'company_name', 'bonus_amount', 'comments']
            .every(field => String(cellAt(cells, field) ?? '').trim() === '');
        if (name === '' && everythingElseEmpty) continue; // a blank spreadsheet row, not data

        const normalizedName = normalizeForSearch(name);
        if (/^(ejemplo|example)/.test(normalizedName)) {
            examples++;
            continue;
        }
        if (name === '') {
            fail('The row has data but no employee name.');
            continue;
        }

        // ── Who this is ─────────────────────────────────────────────────────
        const rawId = String(cellAt(cells, 'employee_id') ?? '').trim();
        let employee = null;
        let employeeId = null;
        if (rawId !== '' && /^\d+$/.test(rawId)) {
            employeeId = Number(rawId);
            employee = rosterById.get(employeeId) ?? null;
        } else {
            employee = rosterByName.get(normalizedName) ?? null;
            employeeId = employee ? Number(employee.id) : null;
        }

        // ── Duplicates inside the file itself ───────────────────────────────
        if (employeeId !== null && seenIds.has(employeeId)) {
            fail('This employee appears earlier in the same file.');
            continue;
        }
        if (employeeId === null && seenNames.has(normalizedName)) {
            fail('This name appears earlier in the same file.');
            continue;
        }

        // ── What they get ───────────────────────────────────────────────────
        const amount = parseAmount(cellAt(cells, 'bonus_amount'));
        if (Number.isNaN(amount) || amount <= 0) {
            fail('Enter a bonus amount greater than zero.');
            continue;
        }

        const currencyText = String(cellAt(cells, 'currency') ?? '').trim();
        // "RD$ 5,000" carries its own answer, so a blank Currency column asks the amount.
        const statedCurrency = normalizeCurrency(currencyText)
            ?? normalizeCurrency(cellAt(cells, 'bonus_amount'));
        if (statedCurrency === null && currencyText !== '') {
            fail(`"${currencyText}" is not a currency. Use RD$ (DOP) or US$ (USD).`);
            continue;
        }
        // Blank falls back to the module's default — the same one the Add form opens on and
        // the column itself defaults to. These files arrive with the currency left off; that
        // is a row to flag in the preview, not one to refuse.
        const currency = statedCurrency ?? DEFAULT_CURRENCY;
        const warnings = [];
        if (statedCurrency === null) {
            warnings.push(`No currency on this row — imported as ${currencyOf(DEFAULT_CURRENCY).symbol}.`);
        }

        // ── Where they sit ──────────────────────────────────────────────────
        const sheetTeam = String(cellAt(cells, 'team_name') ?? '').trim();
        const teamName = sheetTeam !== '' ? sheetTeam : (employee?.team ?? '');
        if (employeeId === null && teamName === '') {
            fail('A name DeskTime does not know needs a Team.');
            continue;
        }

        const companyText = String(cellAt(cells, 'company_name') ?? '').trim();
        const company = companyText === '' ? null : (companyByName.get(normalizeForSearch(companyText)) ?? null);
        if (companyText !== '' && company === null) {
            warnings.push(`Company "${companyText}" is not in Configuration > HR > Company — imported without one.`);
        }

        if (employeeId !== null) seenIds.add(employeeId);
        seenNames.add(normalizedName);

        rows.push({
            line,
            employee_id: employeeId,
            // The roster's spelling wins when the row is linked: the link is to the person,
            // and their record is the canonical name.
            employee_name: employee ? employee.name : name,
            team_name: teamName,
            company_id: company ? company.id : null,
            company_name: company ? company.name : '',
            bonus_amount: Math.round(amount * 100) / 100,
            currency,
            comments: String(cellAt(cells, 'comments') ?? '').trim().slice(0, 1000),
            matched: employee !== null,
            warning: warnings.length > 0 ? warnings.join(' · ') : null
        });
    }

    return { rows, errors, examples, headerFound: true };
};

/** The first few rows with anything in them, for an error that shows what the file held. */
const previewOf = (sheetRows) => sheetRows
    .filter(cells => (cells || []).some(cell => String(cell ?? '').trim() !== ''))
    .slice(0, 4)
    .map(cells => cells
        .slice(0, 8)
        .map(cell => String(cell ?? '').trim().slice(0, 24))
        .filter(cell => cell !== ''));

/**
 * The whole WORKBOOK, not one sheet of it — the entry point the modal should use.
 *
 * Taking sheet zero and hoping is what made a file that plainly had an "Employee Name"
 * column report that it had no header row. A spreadsheet reader turns every <table> in an
 * HTML file into its own sheet, and Excel re-saving one of these templates emits a layout
 * table before the data; a workbook someone built by hand just as often opens on an empty
 * "Hoja1". In both cases the data is on the SECOND sheet and the first is furniture.
 *
 * So every sheet is tried and the first one carrying a recognizable header wins. `sheetName`
 * comes back so the preview can say which sheet it read, since "we found your data, on
 * Sheet2" is a different message from "we found your data".
 */
export const mapImportWorkbook = (sheets, context = {}) => {
    for (const sheet of sheets) {
        const mapped = mapImportRows(sheet.cells, context);
        if (mapped.headerFound) {
            // sheetNames rides along so the caller can tell "the only sheet" from "the one
            // of four that had the data" — only the second is worth saying out loud.
            return { ...mapped, sheetName: sheet.name, sheetNames: sheets.map(s => s.name) };
        }
    }

    // Nothing anywhere. Report against the sheet with the most in it, which is the one the
    // person thinks they uploaded.
    const fullest = sheets
        .slice()
        .sort((a, b) => previewOf(b.cells).length - previewOf(a.cells).length)[0];

    return {
        rows: [],
        errors: [],
        examples: 0,
        headerFound: false,
        sheetName: fullest?.name ?? null,
        sheetNames: sheets.map(sheet => sheet.name),
        preview: fullest ? previewOf(fullest.cells) : []
    };
};
