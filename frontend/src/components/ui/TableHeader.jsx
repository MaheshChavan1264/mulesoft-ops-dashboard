import React from 'react';

/**
 * TableHeader
 *
 * Shared `<thead>` wrapper that unifies the background/blur/sticky treatment
 * hand-copied (with drifting opacity values: /95, /80, /60, /40, none) across
 * ApplicationsPage, ApplicationDetailPage, CpsManagerPage and GlobalSearchPage
 * — see FRONTEND_ARCHITECTURE_REVIEW.md finding "<TableHeader>".
 *
 * The `<tr>`/`<th>` content (column labels, sort handlers, checkboxes, etc.)
 * stays fully custom per table — only the `<thead>`-level background/blur/
 * sticky classes are centralized here, since those are what actually drifted.
 *
 * Two tones are supported, matching the two patterns actually in use:
 *   - static (default): `bg-gray-50/80 dark:bg-gray-800/60` — small,
 *     non-scrolling tables (property lists, endpoints, etc.)
 *   - sticky: `bg-gray-50/95 dark:bg-gray-900/90 backdrop-blur-sm` plus
 *     `sticky top-0 z-10` — headers pinned above a scrollable table body
 *
 * Props:
 *   sticky     {boolean}  pins the header and switches to the stronger/
 *                            blurred background tone (default false)
 *   className  {string}     extra classes on the `<thead>`
 *   children   {ReactNode}  the `<tr>` (and `<th>`s) for this header
 */
export default function TableHeader({ sticky = false, className = '', children }) {
  const tone = sticky
    ? 'sticky top-0 z-10 bg-gray-50/95 dark:bg-gray-900/90 backdrop-blur-sm'
    : 'bg-gray-50/80 dark:bg-gray-800/60';
  return (
    <thead className={`${tone} ${className}`}>
      {children}
    </thead>
  );
}
