import React, { useRef, useState } from 'react';
import './BonusModal.css';
import './ImportBonusListModal.css';
import { downloadCsv } from '../utils/csv';
import {
    BONUS_TEMPLATE_FILENAME,
    buildBonusTemplateRows,
    mapImportWorkbook
} from '../utils/bonusImport';
import { currencyClass, currencyOf, formatBonusAmount } from '../utils/currency';

/**
 * "Import List" — bulk enrolment for HR > Bonus from a spreadsheet.
 *
 * The template it offers for download is the same file it accepts back, which is the whole
 * idea: nobody should have to guess columns. It is a CSV — the styled .xls it used to be
 * came back from Excel as two sheets and failed to import, and a template that cannot make
 * the round trip is not a template. Everything tolerant lives in
 * utils/bonusImport.js — Spanish headers, "RD$ 5,000.00" amounts, names without accents —
 * and everything that failed comes back with the spreadsheet line it failed on.
 *
 * Nothing is sent until the person has SEEN the mapping: the preview lists every row with
 * who it resolved to (DeskTime or manual), and every rejected line with its reason. The
 * server then re-validates each row anyway; the one-person-one-month rule is enforced
 * there, so a file overlapping the existing list adds the missing people and skips the
 * rest — additive, like Load Last Month.
 */
const ImportBonusListModal = ({ year, month, periodLabel, roster, companies, onClose, onImported }) => {
    const [fileName, setFileName] = useState(null);
    const [parsed, setParsed] = useState(null);
    // Set only when no header could be found: what the file actually held, so a mismatch
    // explains itself instead of leaving "wrong file?" as the only guess.
    const [diagnostic, setDiagnostic] = useState(null);
    const [parsing, setParsing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState(null);
    const fileInputRef = useRef(null);

    const handleTemplate = () =>
        downloadCsv(BONUS_TEMPLATE_FILENAME, buildBonusTemplateRows());

    const handleFile = async (event) => {
        const file = event.target.files?.[0];
        // Same file re-picked after fixing it must fire onChange again.
        event.target.value = '';
        if (!file) return;

        setParsing(true);
        setError(null);
        setParsed(null);
        setDiagnostic(null);
        setFileName(file.name);
        try {
            // Dynamically imported like BulkAddHolidaysModal does: the parser is a heavy
            // chunk nobody pays for until they actually import something.
            const XLSX = await import('xlsx');
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });

            // Every sheet, not just the first. An HTML-based .xls re-saved by Excel arrives
            // with a layout table ahead of the data, and each table becomes its own sheet —
            // so sheet zero is furniture and the template's own rows are on sheet two.
            const sheets = workbook.SheetNames.map(name => ({
                name,
                cells: XLSX.utils.sheet_to_json(workbook.Sheets[name], {
                    header: 1, raw: true, defval: ''
                })
            }));

            const mapped = mapImportWorkbook(sheets, { roster, companies });
            if (!mapped.headerFound) {
                setDiagnostic(mapped);
                throw new Error('Could not find the header row in this file. It needs a row '
                    + 'with at least an "Employee Name" and a "Bonus Amount" column. '
                    + 'What the file actually contains is shown below.');
            }
            if (mapped.rows.length === 0 && mapped.errors.length === 0) {
                // Importing the blank template is a normal mistake, and "no data rows" reads
                // like the file is broken when in fact it is untouched.
                throw new Error(mapped.examples > 0
                    ? 'This is the template with only its EJEMPLO rows in it. Replace those '
                        + 'rows with real employees and choose the file again.'
                    : 'The file has no data rows under the header.');
            }
            setParsed(mapped);
        } catch (err) {
            setError(err.message || 'Could not read that file.');
            setFileName(null);
        } finally {
            setParsing(false);
        }
    };

    const handleImport = async () => {
        if (!parsed || parsed.rows.length === 0) return;
        setImporting(true);
        setError(null);
        try {
            const res = await fetch('./api/manage_bonus.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'import', year, month, rows: parsed.rows })
            });
            const json = await res.json();
            if (!json.success) throw new Error(json.error || 'The import failed.');
            onImported(json);
        } catch (err) {
            setError(err.message);
            setImporting(false);
        }
    };

    const warnings = parsed ? parsed.rows.filter(row => row.warning) : [];

    return (
        <div className="bonus-modal-overlay" onClick={onClose}>
            <div className="bonus-modal-panel bonus-import-modal" onClick={(e) => e.stopPropagation()}>
                <div className="bonus-modal-header">
                    <div>
                        <h2>Import List</h2>
                        <span className="bonus-import-period">Into {periodLabel}</span>
                    </div>
                    <button className="bonus-modal-close" onClick={onClose}>&times;</button>
                </div>

                <p className="bonus-modal-intro">
                    Upload a spreadsheet with one employee per row — CSV, .xlsx or .xls all
                    work. Names are matched against DeskTime (accents ignored); anyone already
                    on {periodLabel} is skipped, never overwritten. Start from the template so
                    the columns match.
                </p>

                <div className="bonus-import-actions">
                    <button className="bonus-import-template" onClick={handleTemplate}>
                        ⬇ Download template (CSV)
                    </button>
                    <button
                        className="bonus-import-pick"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={parsing}
                    >
                        {parsing ? 'Reading…' : (fileName ? 'Choose another file' : '⬆ Choose file')}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={handleFile}
                        hidden
                    />
                    {fileName && <span className="bonus-import-filename">{fileName}</span>}
                </div>

                {error && <div className="bonus-modal-error">{error}</div>}

                {diagnostic && (
                    <div className="bonus-import-diagnostic">
                        <div className="bonus-import-diagnostic-head">
                            {diagnostic.sheetNames?.length > 1
                                ? `Sheets in this file: ${diagnostic.sheetNames.join(', ')}. `
                                : ''}
                            {diagnostic.preview?.length > 0
                                ? `First rows of ${diagnostic.sheetName ? `"${diagnostic.sheetName}"` : 'the file'}:`
                                : 'The file has no rows with anything in them.'}
                        </div>
                        {diagnostic.preview?.map((cells, index) => (
                            <div className="bonus-import-diagnostic-row" key={index}>
                                {cells.map((cell, cellIndex) => (
                                    <span key={cellIndex}>{cell}</span>
                                ))}
                            </div>
                        ))}
                    </div>
                )}

                {parsed && (
                    <>
                        <div className="bonus-import-summary">
                            <span className="bonus-import-chip is-ok">{parsed.rows.length} ready</span>
                            {parsed.errors.length > 0 && (
                                <span className="bonus-import-chip is-bad">{parsed.errors.length} with errors</span>
                            )}
                            {warnings.length > 0 && (
                                <span className="bonus-import-chip is-warn">{warnings.length} with warnings</span>
                            )}
                            {parsed.sheetNames?.length > 1 && (
                                <span className="bonus-import-chip is-muted">
                                    read “{parsed.sheetName}”
                                </span>
                            )}
                            {parsed.examples > 0 && (
                                <span className="bonus-import-chip is-muted">
                                    {parsed.examples} template example{parsed.examples === 1 ? '' : 's'} ignored
                                </span>
                            )}
                        </div>

                        {parsed.errors.length > 0 && (
                            <div className="bonus-import-errors">
                                {parsed.errors.map(err => (
                                    <div key={err.line}>
                                        <strong>Line {err.line}</strong> · {err.name}: {err.reason}
                                    </div>
                                ))}
                                <div className="bonus-import-errors-note">
                                    These lines will NOT be imported. Fix the file and choose it again,
                                    or import the {parsed.rows.length} valid rows as they are.
                                </div>
                            </div>
                        )}

                        <div className="bonus-import-table-wrapper">
                            <table className="bonus-import-table">
                                <thead>
                                    <tr>
                                        <th>Line</th>
                                        <th>Employee</th>
                                        <th>Source</th>
                                        <th>Team</th>
                                        <th>Company</th>
                                        <th className="is-numeric">Bonus</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {parsed.rows.map(row => (
                                        <tr key={row.line}>
                                            <td className="bonus-import-line">{row.line}</td>
                                            <td>
                                                {row.employee_name}
                                                {row.warning && (
                                                    <div className="bonus-import-warning">⚠ {row.warning}</div>
                                                )}
                                            </td>
                                            <td>
                                                <span className={`bonus-import-badge ${row.matched ? 'is-linked' : 'is-manual'}`}>
                                                    {row.matched ? `DeskTime ${row.employee_id}` : 'Manual'}
                                                </span>
                                            </td>
                                            <td>{row.team_name || '—'}</td>
                                            <td>{row.company_name || '—'}</td>
                                            <td className={`is-numeric ${currencyClass(row.currency)}`}>
                                                {formatBonusAmount(row.bonus_amount, row.currency)}
                                                {' '}{currencyOf(row.currency).flag}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}

                <div className="bonus-modal-footer">
                    <button className="bonus-btn-cancel" onClick={onClose} disabled={importing}>Cancel</button>
                    <button
                        className="bonus-btn-confirm"
                        onClick={handleImport}
                        disabled={importing || !parsed || parsed.rows.length === 0}
                    >
                        {importing
                            ? 'Importing…'
                            : parsed && parsed.rows.length > 0
                                ? `Import ${parsed.rows.length} employee${parsed.rows.length === 1 ? '' : 's'}`
                                : 'Import'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ImportBonusListModal;
