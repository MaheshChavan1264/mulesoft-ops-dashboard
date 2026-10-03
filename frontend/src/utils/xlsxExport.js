import * as XLSX from 'xlsx';

/**
 * Shared XLSX export helpers.
 *
 * Four independent XLSX workbook-building implementations previously
 * existed — ApplicationsPage's `ExportAppsModal.doExport` (one sheet per
 * environment) and `exportAppsToXlsx` (single sheet), GlobalSearchPage's
 * `exportSummaryXlsx`/`exportGroupedXlsx` (AOA-based), and
 * utils/exportCps.js's 4-sheet workbook — each hand-rolling
 * `XLSX.utils.book_new()` / column auto-sizing / `writeFile()` boilerplate
 * independently. See FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #18.
 *
 * CSV export already has a single canonical helper (`utils/appUtils.js`'s
 * `downloadCsv`) — this module is the XLSX equivalent, so every exporter in
 * the app now goes through one of these two shared paths.
 */

/**
 * Sanitize a string for use as an Excel sheet name: strips the characters
 * Excel disallows (`/ \ ? * [ ] :`) and truncates to the 31-character limit.
 *
 * @param {string} name
 * @param {string} [fallback='Sheet']
 * @returns {string}
 */
export function sanitizeSheetName(name, fallback = 'Sheet') {
  const cleaned = (name || '').replace(/[/\\?*[\]:]/g, '').slice(0, 31);
  return cleaned || fallback;
}

/**
 * Compute `!cols` width entries that fit the widest cell (or header) in each
 * column, +2 characters of padding — the auto-sizing logic that was
 * duplicated between ApplicationsPage's two XLSX exporters.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {string[]} headers
 * @returns {Array<{wch:number}>}
 */
export function autoSizeColumns(rows, headers) {
  return headers.map((h) => ({
    wch: Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)) + 2,
  }));
}

/**
 * Build a worksheet from an array of plain objects (one row per object).
 *
 * @param {Array<Record<string, any>>} rows
 * @param {object} [opts]
 * @param {string[]} [opts.headers]  Explicit column order/subset; defaults
 *   to the keys of the first row (XLSX.utils.json_to_sheet's own default).
 * @param {'auto'|number[]|undefined} [opts.colWidths='auto']  'auto' sizes
 *   each column to its widest cell; an array sets explicit `wch` values in
 *   header order; `undefined` leaves column widths unset.
 * @returns {XLSX.WorkSheet}
 */
export function rowsToWorksheet(rows, { headers, colWidths = 'auto' } = {}) {
  const ws = XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : undefined);
  const resolvedHeaders = headers || (rows[0] ? Object.keys(rows[0]) : []);
  if (colWidths === 'auto') {
    if (resolvedHeaders.length && rows.length) ws['!cols'] = autoSizeColumns(rows, resolvedHeaders);
  } else if (Array.isArray(colWidths)) {
    ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  }
  return ws;
}

/**
 * Build a worksheet from an array-of-arrays (AOA) — used for hand-built
 * grids where cells don't map 1:1 to a flat object (e.g. multi-line cells,
 * blank separator rows between groups).
 *
 * @param {Array<Array<any>>} aoa
 * @param {object} [opts]
 * @param {number[]} [opts.colWidths]  Explicit `wch` values in column order.
 * @returns {XLSX.WorkSheet}
 */
export function aoaToWorksheet(aoa, { colWidths } = {}) {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (Array.isArray(colWidths)) {
    ws['!cols'] = colWidths.map((w) => ({ wch: w }));
  }
  return ws;
}

/**
 * Assemble a workbook from one or more named worksheets and trigger the
 * browser download. Sheet names are sanitized/truncated automatically.
 *
 * @param {Array<{name: string, worksheet: XLSX.WorkSheet}>} sheets
 * @param {string} filename
 */
export function writeWorkbook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, worksheet }) => {
    XLSX.utils.book_append_sheet(wb, worksheet, sanitizeSheetName(name));
  });
  XLSX.writeFile(wb, filename);
}

/**
 * Convenience one-liner for the common "single sheet from an array of
 * objects" case.
 *
 * @param {Array<Record<string, any>>} rows
 * @param {object} opts
 * @param {string} opts.filename
 * @param {string} [opts.sheetName='Sheet1']
 * @param {'auto'|number[]|undefined} [opts.colWidths='auto']
 */
export function exportRowsToXlsx(rows, { filename, sheetName = 'Sheet1', colWidths = 'auto' } = {}) {
  if (!rows || rows.length === 0) return;
  const ws = rowsToWorksheet(rows, { colWidths });
  writeWorkbook([{ name: sheetName, worksheet: ws }], filename);
}

/**
 * Build a timestamped filename, e.g. `timestampedFilename('apps-export')`
 * → `apps-export-2026-10-03.xlsx`, or with `{ time: true }` →
 * `apps-export-2026-10-03T14-05-00.xlsx`. Collapses the
 * `${new Date().toISOString().slice(...)}` one-liner that was repeated at
 * every export call site.
 *
 * @param {string} prefix
 * @param {string} [ext='xlsx']
 * @param {object} [opts]
 * @param {boolean} [opts.time=false]  Include time-of-day (colon-safe) instead of just the date.
 * @returns {string}
 */
export function timestampedFilename(prefix, ext = 'xlsx', { time = false } = {}) {
  const iso = new Date().toISOString();
  const stamp = time ? iso.slice(0, 19).replace(/:/g, '-') : iso.slice(0, 10);
  return `${prefix}-${stamp}.${ext}`;
}
