/**
 * csv.js — one CSV writer for the whole app.
 *
 * There were two hand-rolled versions before this: the Holidays export quoted its fields
 * correctly, while EmployeeProjectsReport joins raw values with commas, so a single comma
 * in a project name splits that row into the wrong columns. Everything new should come
 * through here.
 */

/**
 * Quotes a field and doubles any quote inside it, per RFC 4180. Applied to every value
 * rather than only the suspicious ones: free-text fields are exactly where a stray comma,
 * quote or newline shows up, and quoting unconditionally costs nothing.
 */
export const escapeCsvValue = (value) =>
    `"${(value ?? '').toString().replace(/"/g, '""')}"`;

/** Rows (arrays of values) to a CSV string, CRLF-terminated as Excel expects. */
export const buildCsv = (rows) =>
    rows.map(row => row.map(escapeCsvValue).join(',')).join('\r\n');

/**
 * Hands the user a CSV file.
 *
 * The leading BOM is what makes Excel read the file as UTF-8; without it accented names
 * ("Muñoz", "Peña") arrive mangled. The object URL is revoked afterwards so the blob is
 * not retained for the life of the page.
 */
export const downloadCsv = (filename, rows) => {
    const blob = new Blob(['\uFEFF' + buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
