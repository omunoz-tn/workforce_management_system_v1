/**
 * xls.js — styled Excel exports, the counterpart to csv.js.
 *
 * CSV carries data but no appearance. When an export has to arrive with its colours and
 * formats intact — the Bonus list's currency tints, header fills, number formats — the
 * bundled SheetJS build cannot help: writing cell styles is a feature of its paid edition.
 * What CAN carry styles with no dependency at all is Excel's own oldest trick: an .xls file
 * whose content is an HTML table. Excel has opened these since 1997, rendering the inline
 * CSS as cell formatting, and `mso-number-format` turns a cell into a real, summable number
 * with a display format rather than a piece of text that merely looks like one.
 *
 * The one cost: recent Excel shows a "file format and extension don't match" prompt the
 * first time such a file is opened, because the bytes are HTML. Answering Yes opens it
 * normally. That prompt is the price of colours without a paid library, and worth saying
 * out loud rather than discovering.
 *
 * The caller builds the <table> (that is where the domain's colours live); this module owns
 * the envelope Excel expects and the download itself.
 */

/** Escapes a value for use inside the generated HTML. Applied to every dynamic value. */
export const escapeXlsValue = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

/**
 * Wraps a table in the Office envelope: the namespaces and the conditional XML block are
 * what make Excel treat the file as a workbook with a named sheet instead of a web page.
 */
export const buildXlsDocument = (sheetName, tableHtml) => {
    const name = escapeXlsValue(String(sheetName).slice(0, 31)); // Excel's sheet-name limit.
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:x="urn:schemas-microsoft-com:office:excel"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">
<!--[if gte mso 9]><xml>
<x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
<x:Name>${name}</x:Name>
<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook>
</xml><![endif]-->
</head>
<body>
${tableHtml}
</body>
</html>`;
};

/**
 * Hands the user the .xls file. Same shape as downloadCsv, and the BOM is there for the
 * same reason: without it Excel reads "Muñoz" as mojibake.
 */
export const downloadXls = (filename, sheetName, tableHtml) => {
    const blob = new Blob(['\uFEFF' + buildXlsDocument(sheetName, tableHtml)], {
        type: 'application/vnd.ms-excel;charset=utf-8;'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};
