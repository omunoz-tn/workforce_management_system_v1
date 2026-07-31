import React, { useState, useMemo, useRef } from 'react';
import './BulkAddHolidaysModal.css';

const COUNTRIES = [
    { code: 'DO', name: 'Dominican Republic', flag: '🇩🇴' },
    { code: 'US', name: 'United States', flag: '🇺🇸' }
];

const HOLIDAY_TYPES = [
    { id: 'non_working', label: 'Non-Working Holiday' },
    { id: 'working', label: 'Working Holiday' },
    { id: 'campaign_defined', label: 'Campaign Defined' }
];

let rowIdCounter = 0;
const newRowId = () => `row-${++rowIdCounter}`;

const blankRow = (overrides = {}) => ({
    _rowId: newRowId(),
    name: '',
    holiday_date: '',
    country_code: 'DO',
    holiday_type: 'non_working',
    description: '',
    _source: 'manual',
    ...overrides
});

// --- CSV parsing (no library needed for CSV; .xlsx uses a dynamically-imported parser) ---

function parseCSVText(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
            } else field += c;
        } else if (c === '"') {
            inQuotes = true;
        } else if (c === ',') {
            row.push(field); field = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else {
            field += c;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const HEADER_ALIASES = {
    name: ['holiday name', 'name'],
    holiday_date: ['date', 'holiday date'],
    country_code: ['country'],
    holiday_type: ['holiday type', 'type'],
    description: ['description']
};

function buildColumnMap(headerRow) {
    const map = {};
    (headerRow || []).forEach((h, idx) => {
        const norm = (h ?? '').toString().trim().toLowerCase();
        Object.entries(HEADER_ALIASES).forEach(([field, aliases]) => {
            if (aliases.includes(norm)) map[field] = idx;
        });
    });
    return map;
}

function resolveCountryCode(raw) {
    const v = (raw ?? '').toString().trim();
    if (!v) return '';
    const upper = v.toUpperCase();
    const byCode = COUNTRIES.find(c => c.code === upper);
    if (byCode) return byCode.code;
    const byName = COUNTRIES.find(c => c.name.toLowerCase() === v.toLowerCase());
    return byName ? byName.code : '';
}

function resolveHolidayType(raw) {
    const v = (raw ?? '').toString().trim().toLowerCase();
    if (!v) return '';
    const byId = HOLIDAY_TYPES.find(t => t.id === v.replace(/\s+/g, '_'));
    if (byId) return byId.id;
    const byLabel = HOLIDAY_TYPES.find(t => t.label.toLowerCase() === v);
    return byLabel ? byLabel.id : '';
}

function resolveDate(raw) {
    const v = (raw ?? '').toString().trim();
    if (!v) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    const mdy = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
        const [, m, d, y] = mdy;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    // Excel date serial fallback (epoch: Dec 30 1899), in case cellDates formatting missed it.
    if (/^\d+(\.\d+)?$/.test(v)) {
        const serial = parseFloat(v);
        const excelEpoch = Date.UTC(1899, 11, 30);
        const d = new Date(excelEpoch + serial * 86400000);
        return d.toISOString().split('T')[0];
    }
    return '';
}

function validateRow(row, allRows, existingHolidays) {
    if (!row.name || !row.name.trim()) return 'Holiday name is required.';
    if (!row.holiday_date || !/^\d{4}-\d{2}-\d{2}$/.test(row.holiday_date)) return 'A valid date is required.';
    if (!COUNTRIES.some(c => c.code === row.country_code)) return 'Select a country.';
    if (!HOLIDAY_TYPES.some(t => t.id === row.holiday_type)) return 'Select a holiday type.';

    const dupInBatch = allRows.some(r => r._rowId !== row._rowId && r.country_code === row.country_code && r.holiday_date === row.holiday_date);
    if (dupInBatch) return 'Duplicate country + date within this batch.';

    const dupInDb = existingHolidays.some(h => h.country_code === row.country_code && h.holiday_date === row.holiday_date);
    if (dupInDb) return 'A holiday already exists for that country and date.';

    return null;
}

const BulkAddHolidaysModal = ({ existingHolidays, onClose, onSaved }) => {
    const [method, setMethod] = useState('manual');
    const [rows, setRows] = useState([]);
    const fileInputRef = useRef(null);

    const [importError, setImportError] = useState(null);
    const [importSummary, setImportSummary] = useState(null);

    const [genCountry, setGenCountry] = useState('DO');
    const [genYear, setGenYear] = useState(new Date().getFullYear());
    const [generating, setGenerating] = useState(false);
    const [generateSummary, setGenerateSummary] = useState(null);

    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [saveResult, setSaveResult] = useState(null);
    const [serverErrors, setServerErrors] = useState({});

    const rowErrors = useMemo(() => {
        const errors = {};
        rows.forEach(row => {
            const err = validateRow(row, rows, existingHolidays);
            if (err) errors[row._rowId] = err;
        });
        return errors;
    }, [rows, existingHolidays]);

    const updateRow = (rowId, field, value) => {
        setRows(prev => prev.map(r => r._rowId === rowId ? { ...r, [field]: value } : r));
        setServerErrors(prev => { const next = { ...prev }; delete next[rowId]; return next; });
    };

    const deleteRow = (rowId) => setRows(prev => prev.filter(r => r._rowId !== rowId));

    const duplicateRow = (rowId) => {
        setRows(prev => {
            const idx = prev.findIndex(r => r._rowId === rowId);
            if (idx === -1) return prev;
            const copy = { ...prev[idx], _rowId: newRowId(), holiday_date: '' };
            return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
        });
    };

    const addRow = () => setRows(prev => [...prev, blankRow()]);

    const clearAll = () => {
        if (rows.length && !window.confirm('Clear all rows in this batch? This cannot be undone.')) return;
        setRows([]);
        setImportSummary(null);
        setGenerateSummary(null);
        setSaveError(null);
        setServerErrors({});
    };

    const processImportedRows = (rawRows) => {
        if (!rawRows || rawRows.length === 0) {
            setImportError('The file appears to be empty.');
            return;
        }
        const [headerRow, ...dataRows] = rawRows;
        const colMap = buildColumnMap(headerRow);
        if (colMap.name === undefined || colMap.holiday_date === undefined) {
            setImportError('Could not find "Holiday Name" and "Date" columns. Please use the provided template.');
            return;
        }

        let ignoredEmpty = 0;
        const parsedRows = [];
        dataRows.forEach(r => {
            const get = (field) => (colMap[field] !== undefined ? (r[colMap[field]] ?? '') : '');
            const values = ['name', 'holiday_date', 'country_code', 'holiday_type', 'description'].map(get);
            if (values.every(v => !String(v).trim())) { ignoredEmpty++; return; }

            parsedRows.push(blankRow({
                name: String(get('name')).trim(),
                holiday_date: resolveDate(get('holiday_date')),
                country_code: resolveCountryCode(get('country_code')),
                holiday_type: resolveHolidayType(get('holiday_type')),
                description: String(get('description')).trim(),
                _source: 'import'
            }));
        });

        setRows(prev => [...prev, ...parsedRows]);
        setImportError(null);
        setImportSummary({ imported: parsedRows.length, ignoredEmpty });
    };

    const handleFileChange = async (e) => {
        const file = e.target.files[0];
        e.target.value = '';
        if (!file) return;

        setImportError(null);
        setImportSummary(null);
        const lowerName = file.name.toLowerCase();

        try {
            if (lowerName.endsWith('.csv')) {
                const text = await file.text();
                processImportedRows(parseCSVText(text));
            } else if (lowerName.endsWith('.xlsx')) {
                const XLSX = await import('xlsx');
                const buf = await file.arrayBuffer();
                const wb = XLSX.read(buf, { type: 'array', cellDates: true });
                const sheet = wb.Sheets[wb.SheetNames[0]];
                const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, dateNF: 'yyyy-mm-dd' });
                processImportedRows(raw);
            } else {
                setImportError('Unsupported file type. Please upload a .csv or .xlsx file.');
            }
        } catch (err) {
            setImportError('Could not read that file. Please check the format and try again.');
        }
    };

    const handleDownloadTemplate = () => {
        const header = ['Holiday Name', 'Date', 'Country', 'Holiday Type', 'Description'];
        const example = ['Independence Day', '2026-02-27', 'DO', 'Non-Working Holiday', 'Optional notes'];
        const csv = [header, example]
            .map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'holiday_import_template.csv';
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleGenerate = async () => {
        setGenerating(true);
        setGenerateSummary(null);
        try {
            const res = await fetch(`./api/generate_official_holidays.php?country=${genCountry}&year=${genYear}`);
            const json = await res.json();
            if (json.success) {
                const alreadyStaged = json.holidays.filter(h =>
                    rows.some(r => r.country_code === h.country_code && r.holiday_date === h.holiday_date)
                ).length;
                const toAdd = json.holidays
                    .filter(h => !rows.some(r => r.country_code === h.country_code && r.holiday_date === h.holiday_date))
                    .map(h => blankRow({ ...h, _source: 'generated' }));

                setRows(prev => [...prev, ...toAdd]);
                setGenerateSummary({ added: toAdd.length, skippedInDb: json.skipped_count, alreadyStaged });
            } else {
                setGenerateSummary({ error: json.error });
            }
        } catch (err) {
            setGenerateSummary({ error: 'Failed to generate holidays.' });
        } finally {
            setGenerating(false);
        }
    };

    const handleSaveAll = async () => {
        if (rows.length === 0) {
            setSaveError('Add at least one holiday before saving.');
            return;
        }
        if (Object.keys(rowErrors).length > 0) {
            setSaveError('Fix the highlighted rows before saving.');
            return;
        }

        setSaving(true);
        setSaveError(null);
        try {
            const res = await fetch('./api/bulk_create_holidays.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    holidays: rows.map(r => ({
                        name: r.name,
                        holiday_date: r.holiday_date,
                        country_code: r.country_code,
                        holiday_type: r.holiday_type,
                        description: r.description
                    }))
                })
            });
            const json = await res.json();
            if (json.success) {
                setSaveResult({ created: json.created });
                onSaved();
            } else if (json.errors) {
                const byIndex = {};
                json.errors.forEach(e => { byIndex[rows[e.index]?._rowId] = e.message; });
                setServerErrors(byIndex);
                setSaveError('Some rows could not be saved — see the highlighted rows below.');
            } else {
                setSaveError(json.error || 'Failed to save holidays.');
            }
        } catch (err) {
            setSaveError('Failed to save holidays.');
        } finally {
            setSaving(false);
        }
    };

    const handleCloseAttempt = () => {
        if (rows.length > 0 && !saveResult) {
            if (!window.confirm('Discard all unsaved holidays in this batch?')) return;
        }
        onClose();
    };

    if (saveResult) {
        return (
            <div className="modal-overlay" onClick={handleCloseAttempt}>
                <div className="modal-content bulk-holidays-modal bulk-success-modal" onClick={(e) => e.stopPropagation()}>
                    <div className="bulk-success-view">
                        <div className="bulk-success-icon">✓</div>
                        <h2>Holidays Created</h2>
                        <p>Successfully created {saveResult.created} holiday{saveResult.created === 1 ? '' : 's'}.</p>
                        <button className="btn-confirm" onClick={onClose}>Done</button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={handleCloseAttempt}>
            <div className="modal-content bulk-holidays-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Bulk Add Holidays</h2>
                    <button className="close-btn" onClick={handleCloseAttempt}>&times;</button>
                </div>

                <div className="bulk-tabs">
                    <button className={`bulk-tab-btn ${method === 'manual' ? 'is-active' : ''}`} onClick={() => setMethod('manual')}>Manual Entry</button>
                    <button className={`bulk-tab-btn ${method === 'import' ? 'is-active' : ''}`} onClick={() => setMethod('import')}>Import from Excel/CSV</button>
                    <button className={`bulk-tab-btn ${method === 'generate' ? 'is-active' : ''}`} onClick={() => setMethod('generate')}>Generate Official Holidays</button>
                </div>

                <div className="modal-body bulk-modal-body">
                    {method === 'manual' && (
                        <div className="bulk-method-panel">
                            <p className="section-desc">Add rows manually, then edit them directly in the table below.</p>
                            <button type="button" className="bulk-secondary-btn" onClick={addRow}>+ Add Row</button>
                        </div>
                    )}

                    {method === 'import' && (
                        <div className="bulk-method-panel">
                            <p className="section-desc">
                                Upload a .csv or .xlsx file with columns: Holiday Name, Date, Country, Holiday Type, Description.
                            </p>
                            <div className="bulk-import-controls">
                                <button type="button" className="bulk-secondary-btn" onClick={() => fileInputRef.current?.click()}>Choose File</button>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".csv,.xlsx"
                                    style={{ display: 'none' }}
                                    onChange={handleFileChange}
                                />
                                <button type="button" className="bulk-link-btn" onClick={handleDownloadTemplate}>Download Template</button>
                            </div>
                            {importError && <p className="forecast-error">{importError}</p>}
                            {importSummary && (
                                <p className="bulk-summary-text">
                                    Imported {importSummary.imported} holiday{importSummary.imported === 1 ? '' : 's'}
                                    {importSummary.ignoredEmpty > 0 ? ` (ignored ${importSummary.ignoredEmpty} empty row${importSummary.ignoredEmpty === 1 ? '' : 's'})` : ''}.
                                    Review the table below — rows with issues are highlighted.
                                </p>
                            )}
                        </div>
                    )}

                    {method === 'generate' && (
                        <div className="bulk-method-panel">
                            <p className="section-desc">Automatically load official public holidays for a country and year.</p>
                            <div className="bulk-generate-controls">
                                <select value={genCountry} onChange={(e) => setGenCountry(e.target.value)}>
                                    {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                                </select>
                                <input
                                    type="number"
                                    value={genYear}
                                    min="1970"
                                    max="2100"
                                    onChange={(e) => setGenYear(e.target.value)}
                                />
                                <button type="button" className="bulk-secondary-btn" onClick={handleGenerate} disabled={generating}>
                                    {generating ? 'Generating...' : 'Generate Holidays'}
                                </button>
                            </div>
                            {generateSummary?.error && <p className="forecast-error">{generateSummary.error}</p>}
                            {generateSummary && !generateSummary.error && (
                                <p className="bulk-summary-text">
                                    Generated {generateSummary.added} new holiday{generateSummary.added === 1 ? '' : 's'}.{' '}
                                    {generateSummary.skippedInDb > 0 ? `${generateSummary.skippedInDb} already existed in the calendar and ${generateSummary.skippedInDb === 1 ? 'was' : 'were'} skipped. ` : ''}
                                    {generateSummary.alreadyStaged > 0 ? `${generateSummary.alreadyStaged} ${generateSummary.alreadyStaged === 1 ? 'was' : 'were'} already in this batch and skipped.` : ''}
                                </p>
                            )}
                        </div>
                    )}

                    <div className="bulk-table-wrapper">
                        {rows.length === 0 ? (
                            <div className="report-empty-state">No holidays staged yet. Use one of the methods above to add some.</div>
                        ) : (
                            <table className="bulk-table">
                                <thead>
                                    <tr>
                                        <th>Holiday Name</th>
                                        <th>Date</th>
                                        <th>Country</th>
                                        <th>Type</th>
                                        <th>Description</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => {
                                        const error = rowErrors[row._rowId] || serverErrors[row._rowId];
                                        return (
                                            <React.Fragment key={row._rowId}>
                                                <tr className={error ? 'bulk-row-error' : ''}>
                                                    <td>
                                                        <input
                                                            type="text"
                                                            value={row.name}
                                                            placeholder="Holiday name"
                                                            onChange={(e) => updateRow(row._rowId, 'name', e.target.value)}
                                                        />
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="date"
                                                            value={row.holiday_date}
                                                            onChange={(e) => updateRow(row._rowId, 'holiday_date', e.target.value)}
                                                        />
                                                    </td>
                                                    <td>
                                                        <select value={row.country_code} onChange={(e) => updateRow(row._rowId, 'country_code', e.target.value)}>
                                                            <option value="" disabled>Select...</option>
                                                            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.flag} {c.name}</option>)}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <select value={row.holiday_type} onChange={(e) => updateRow(row._rowId, 'holiday_type', e.target.value)}>
                                                            <option value="" disabled>Select...</option>
                                                            {HOLIDAY_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                                                        </select>
                                                    </td>
                                                    <td>
                                                        <input
                                                            type="text"
                                                            value={row.description}
                                                            placeholder="Optional"
                                                            onChange={(e) => updateRow(row._rowId, 'description', e.target.value)}
                                                        />
                                                    </td>
                                                    <td className="bulk-row-actions">
                                                        <button type="button" title="Duplicate row" onClick={() => duplicateRow(row._rowId)}>⧉</button>
                                                        <button type="button" title="Delete row" onClick={() => deleteRow(row._rowId)}>🗑</button>
                                                    </td>
                                                </tr>
                                                {error && (
                                                    <tr className="bulk-row-error-subrow">
                                                        <td colSpan={6}>⚠ {error}</td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                            </table>
                        )}
                    </div>
                </div>

                <div className="modal-footer bulk-modal-footer">
                    <span className="bulk-count-label">{rows.length} holiday{rows.length === 1 ? '' : 's'} ready to save</span>
                    {saveError && <span className="bulk-save-error">{saveError}</span>}
                    <div className="holiday-modal-footer-right">
                        <button type="button" className="btn-cancel" onClick={clearAll} disabled={rows.length === 0}>Clear All</button>
                        <button type="button" className="btn-confirm" onClick={handleSaveAll} disabled={saving}>
                            {saving ? 'Saving...' : 'Save Holidays'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default BulkAddHolidaysModal;
