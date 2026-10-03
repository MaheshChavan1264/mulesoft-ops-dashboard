import React from 'react';

/**
 * SkeletonTable
 *
 * Loading placeholder for an actual `<table>` body — consolidates the
 * hand-copied skeleton `<tr>` markup found in ApplicationsPage — see
 * FRONTEND_ARCHITECTURE_REVIEW.md finding "<SkeletonTable>".
 *
 * Renders `rows` animated `<tr>`s, each with `cols` cells. Pass a
 * `colWidths` array (one entry per column, px numbers) to vary the skeleton
 * bar widths per column; columns beyond the array just reuse a default width.
 *
 * Props:
 *   rows        {number}  number of skeleton rows (default 8)
 *   cols        {number}  number of columns (default 1)
 *   colWidths   {number[]} optional per-column pixel widths for the bar
 */
export function SkeletonTable({ rows = 8, cols = 1, colWidths = [] }) {
  return (
    <tbody>
      {[...Array(rows)].map((_, i) => (
        <tr key={i} className="border-t border-gray-100 dark:border-gray-700/60 animate-pulse">
          {[...Array(cols)].map((_, c) => (
            <td key={c} className="px-4 py-3.5">
              <div
                className="h-3 rounded bg-gray-100 dark:bg-gray-700"
                style={{ width: `${colWidths[c] ?? (100 + ((i + c) % 5) * 30)}px` }}
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

/**
 * SkeletonListRows
 *
 * Loading placeholder for the "icon + two text lines (+ optional badge)"
 * list-row pattern duplicated across ApiManagerPage and ExchangePage — see
 * FRONTEND_ARCHITECTURE_REVIEW.md finding "<SkeletonTable>".
 *
 * Props:
 *   rows       {number}   number of skeleton rows (default 6)
 *   showBadge  {boolean}  render a trailing pill placeholder (default false)
 */
export function SkeletonListRows({ rows = 6, showBadge = false }) {
  return (
    <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
      {[...Array(rows)].map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5 animate-pulse">
          <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-700 flex-shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 rounded bg-gray-100 dark:bg-gray-700" style={{ width: `${120 + (i % 4) * 40}px` }} />
            <div className="h-2.5 w-24 rounded bg-gray-100 dark:bg-gray-700" />
          </div>
          {showBadge && <div className="h-5 w-16 rounded-full bg-gray-100 dark:bg-gray-700 flex-shrink-0" />}
        </div>
      ))}
    </div>
  );
}

export default SkeletonTable;
