import React from 'react';
import { Copy, Check } from 'lucide-react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

/**
 * CopyBtn
 *
 * A small inline button that copies `text` to the clipboard and briefly
 * shows a green check-mark confirmation.
 *
 * This component was independently re-implemented in ApplicationsPage,
 * ApplicationDetailPage, CpsComparisonPage, CpsManagerPage, and
 * GlobalSearchPage — all with the same behaviour but slightly different
 * styling. This canonical version supports every visual variant through
 * props so none of those call sites need their own local copy.
 *
 * Props:
 *   text        {string}   The text to copy.
 *   fade        {boolean}  When true (default), the button is invisible
 *                          until the parent element is hovered (requires the
 *                          parent to have the `group` Tailwind class).
 *                          When false, the button is always visible.
 *   size        {number}   Icon size in px (default: 11).
 *   hoverColor  {'gray'|'sf'} Hover tint — 'gray' (default) for light-only
 *                          surfaces, 'sf' for dark-mode-aware brand-blue hover
 *                          (used by CpsComparisonPage/CpsManagerPage/GlobalSearchPage).
 *   padding     {string}   Tailwind padding class (default: 'p-1').
 *   duration    {number}   Milliseconds the check-mark stays visible (default: 1500).
 *   className   {string}   Additional classes for the button element.
 */
function CopyBtn({ text, fade = true, size = 11, hoverColor = 'gray', padding = 'p-1', duration = 1500, className = '' }) {
  const [done, copy] = useCopyToClipboard(duration);

  const handleClick = (e) => {
    e.stopPropagation();
    copy(text);
  };

  const hoverCls = hoverColor === 'sf'
    ? 'text-gray-400 dark:text-gray-500 hover:text-sf-600 dark:hover:text-sf-400'
    : 'text-gray-400 hover:text-gray-700 hover:bg-gray-200/60';

  const baseClass = [
    padding, 'rounded transition-all flex-shrink-0', hoverCls,
    fade ? 'opacity-0 group-hover:opacity-100' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button onClick={handleClick} title="Copy" className={baseClass}>
      {done
        ? <Check size={size} className="text-emerald-600 dark:text-emerald-400" />
        : <Copy size={size} />}
    </button>
  );
}

// Dropped into dozens of table rows at once — memoized so hovering/updating
// one row's CopyBtn doesn't force every sibling CopyBtn to re-render.
export default React.memo(CopyBtn);