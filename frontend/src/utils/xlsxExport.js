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
 * Excel's hard per-cell string limit (a 16-bit signed length field —
 * 2^15-1). Microsoft Excel silently truncates/"repairs" cells that exceed
 * this and still opens the file; stricter OOXML readers (Zoho Sheets,
 * some LibreOffice/Google Sheets import paths) treat it as a structural
 * violation and refuse the file outright ("we found a problem with some
 * content... repair"). exportCps.js's AllPropertiesCatalog sheet
 * concatenates an app's entire property set into one cell
 * (`propsToString()`), which can exceed this for apps with large CPS
 * property sets (certs, JSON blobs, many secure keys) — this is the most
 * likely real-world trigger for that error, so every row is sanitized
 * here before it reaches the XLSX writer, for every exporter in the app.
 */
const MAX_CELL_CHARS = 32767;
const TRUNCATION_SUFFIX = '…[TRUNCATED]';

/**
 * Excel's own hard cap on column width (`!cols[].wch`) is 255 characters;
 * values beyond that are an out-of-range attribute on `<col width="...">`
 * that Excel clamps silently but, again, stricter readers may reject.
 * Capped well under that ceiling since no realistic column needs to be
 * wider than this to stay readable.
 */
const MAX_COL_WIDTH = 80;

/**
 * Truncate any string value exceeding Excel's per-cell character limit,
 * leaving everything else untouched. Mutates nothing — returns new row
 * objects.
 *
 * @param {Array<Record<string, any>>} rows
 * @returns {Array<Record<string, any>>}
 */
function clampCellStrings(rows) {
  return rows.map((row) => {
    let changed = false;
    const next = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'string' && v.length > MAX_CELL_CHARS) {
        next[k] = v.slice(0, MAX_CELL_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
        changed = true;
      } else {
        next[k] = v;
      }
    }
    return changed ? next : row;
  });
}

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
    wch: Math.min(Math.max(h.length, ...rows.map((r) => String(r[h] ?? '').length)) + 2, MAX_COL_WIDTH),
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
  const safeRows = clampCellStrings(rows);
  const ws = XLSX.utils.json_to_sheet(safeRows, headers ? { header: headers } : undefined);
  const resolvedHeaders = headers || (safeRows[0] ? Object.keys(safeRows[0]) : []);
  if (colWidths === 'auto') {
    if (resolvedHeaders.length && safeRows.length) ws['!cols'] = autoSizeColumns(safeRows, resolvedHeaders);
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
  const safeAoa = aoa.map((row) => row.map((cell) =>
    (typeof cell === 'string' && cell.length > MAX_CELL_CHARS)
      ? cell.slice(0, MAX_CELL_CHARS - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX
      : cell
  ));
  const ws = XLSX.utils.aoa_to_sheet(safeAoa);
  if (Array.isArray(colWidths)) {
    ws['!cols'] = colWidths.map((w) => ({ wch: Math.min(w, MAX_COL_WIDTH) }));
  }
  return ws;
}

/**
 * Assemble a workbook from one or more named worksheets and trigger the
 * browser download. Sheet names are sanitized/truncated automatically.
 *
 * Two SheetJS writer quirks are disabled here because they produced files
 * that Excel opens fine but stricter OOXML readers (Zoho Sheet, some
 * LibreOffice/Google Sheets import paths) flag as corrupt and offer to
 * "repair":
 *   - `bookSST: true` forces a proper Shared Strings Table
 *     (xl/sharedStrings.xml) with `t="s"` cell references. Without it,
 *     SheetJS writes plain string cells as `t="str"` — a type ECMA-376
 *     reserves for cached *formula* results, not literal strings.
 *   - `ignoreEC: false` suppresses the `<ignoredErrors>` "number stored as
 *     text" annotation SheetJS otherwise adds for the *entire* used range
 *     on any sheet containing at least one string cell — even when most
 *     cells in that range are plainly non-numeric text (e.g. headers).
 *     This is purely an Excel UI hint (the little green corner triangle);
 *     dropping it does not change any cell data.
 *
 * @param {Array<{name: string, worksheet: XLSX.WorkSheet}>} sheets
 * @param {string} filename
 */
export function writeWorkbook(sheets, filename) {
  const wb = XLSX.utils.book_new();
  sheets.forEach(({ name, worksheet }) => {
    XLSX.utils.book_append_sheet(wb, worksheet, sanitizeSheetName(name));
  });
  XLSX.writeFile(wb, filename, { bookSST: true, ignoreEC: false });
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
