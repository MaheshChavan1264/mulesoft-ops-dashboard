import { useState, useCallback } from 'react';

/**
 * Parse a CSV file's text content into a lowercased array of app names.
 *
 * Auto-detects a header row by looking for a column named one of
 * appname/name/domain/application; if none is found, every non-empty line
 * is treated as a bare name (single-column CSV, no header).
 *
 * This exact parsing logic was previously duplicated character-for-character
 * between ApplicationsPage.jsx's `handleCsvUpload` and PingTestPage.jsx's
 * `handleCsvUpload` — see FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #14.
 *
 * @param {string} text  Raw CSV file content
 * @returns {string[]}   Lowercased app names
 */
export function parseCsvAppNames(text) {
  const lines = (text || '').split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];

  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const nameColIdx = header.findIndex((h) => ['appname', 'name', 'domain', 'application'].includes(h));

  let rawNames;
  if (nameColIdx >= 0) {
    // Has a recognised header — skip the header row and read that column.
    rawNames = lines.slice(1).map((l) => l.split(',')[nameColIdx]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
  } else {
    // No header match — treat every non-empty line as a name (single-column CSV).
    rawNames = lines.map((l) => l.split(',')[0]?.trim().replace(/^"|"$/g, '')).filter(Boolean);
  }
  return rawNames.map((n) => n.toLowerCase());
}

/**
 * Match a pool of app objects (each with a `.name`) against a list of
 * lowercased CSV names, optionally restricted to a Set of environment IDs.
 *
 * @param {Array<{name:string, environment?:{id:string}}>} appPool
 * @param {string[]} csvNames          Lowercased names (see parseCsvAppNames)
 * @param {object} [opts]
 * @param {'exact'|'fuzzy'} [opts.mode='fuzzy']  'exact' requires csvNames to
 *   include the app's lowercased name verbatim; 'fuzzy' matches if either
 *   string contains the other (handles partial/truncated CSV name columns).
 * @param {Set<string>} [opts.envFilterSet]  When non-empty, restrict the
 *   pool to apps whose environment.id is in this set before matching.
 * @returns {Array} matched apps
 */
export function matchAppsByCsvNames(appPool, csvNames, { mode = 'fuzzy', envFilterSet } = {}) {
  const pool = envFilterSet && envFilterSet.size > 0
    ? appPool.filter((a) => envFilterSet.has(a.environment?.id))
    : appPool;

  if (mode === 'exact') {
    return pool.filter((a) => csvNames.includes(a.name.toLowerCase()));
  }
  return pool.filter((a) =>
    csvNames.some((n) => a.name.toLowerCase().includes(n) || n.includes(a.name.toLowerCase()))
  );
}

/**
 * useCsvAppMatcher
 *
 * Shared "upload a CSV of app names, match against the current app list"
 * workflow — collapses the independent FileReader + parsing + matching
 * implementations previously duplicated in ApplicationsPage.jsx and
 * PingTestPage.jsx.
 *
 * Usage (fuzzy-only, PingTestPage-style):
 *   const { csvFileName, csvMatchedNames, handleCsvUpload, matchApps } = useCsvAppMatcher();
 *   const csvMatchedApps = useMemo(
 *     () => csvMatchedNames ? matchApps(apps, csvMatchedNames) : [],
 *     [apps, csvMatchedNames, matchApps]
 *   );
 *   <input type="file" onChange={handleCsvUpload} />
 *
 * @returns {{
 *   csvFileName: string,
 *   csvMatchedNames: string[]|null,
 *   handleCsvUpload: (e: React.ChangeEvent<HTMLInputElement>) => void,
 *   matchApps: (appPool: Array, csvNames?: string[], opts?: object) => Array,
 *   reset: () => void,
 * }}
 */
export function useCsvAppMatcher() {
  const [csvFileName, setCsvFileName] = useState('');
  const [csvMatchedNames, setCsvMatchedNames] = useState(null); // null = not uploaded yet

  const handleCsvUpload = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvMatchedNames(parseCsvAppNames(ev.target.result || ''));
    };
    reader.readAsText(file);
    e.target.value = ''; // allow re-uploading the same file
  }, []);

  const matchApps = useCallback(
    (appPool, csvNames = csvMatchedNames, opts) => matchAppsByCsvNames(appPool, csvNames || [], opts),
    [csvMatchedNames]
  );

  const reset = useCallback(() => {
    setCsvFileName('');
    setCsvMatchedNames(null);
  }, []);

  return { csvFileName, csvMatchedNames, handleCsvUpload, matchApps, reset };
}
