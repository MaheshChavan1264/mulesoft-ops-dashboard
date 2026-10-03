import React from 'react';
import { Check } from 'lucide-react';

/**
 * CheckboxTile
 *
 * Shared custom checkbox box ("w-[18px] h-[18px] rounded-md border...")
 * previously hand-copied with only the accent color changed across
 * BgFilterModal, EnvFilterModal (3 sub-components), and CpsExportModal's
 * BgEnvSelector — see FRONTEND_ARCHITECTURE_REVIEW.md §2 finding
 * "<CheckboxTile>". Centralizing it also means the keyboard/ARIA
 * accessibility behavior (role="checkbox", tabIndex, Enter/Space toggle)
 * only needs to be correct in one place.
 *
 * This component is purely the *visual box* (decorative by default, since
 * most call sites wrap it in a `<label>`/`<div>` that already carries the
 * `role="checkbox"` semantics on the whole row). Pass `interactive` to make
 * the box itself focusable/keyboard-operable when it's used standalone
 * (not inside an already-interactive row).
 *
 * Props:
 *   checked        {boolean}
 *   indeterminate  {boolean}  shows a "–" dash instead of a checkmark
 *   accent         {'blue'|'emerald'|'amber'} default 'blue'
 *   size           {'sm'|'md'} 'sm' = 16px (w-4 h-4, group headers),
 *                   'md' = 18px (leaf rows) — default 'md'
 *   onClick        {function} optional — if provided, the tile becomes
 *                   interactive (role="checkbox", tabIndex, keyboard toggle)
 *   className      {string}   extra classes
 */
const ACCENT = {
  blue: { on: 'bg-blue-600 border-blue-500 shadow-sm shadow-blue-500/40', mixed: 'bg-blue-100 dark:bg-blue-500/20 border-blue-300 dark:border-blue-400/40', off: 'border-gray-300 dark:border-gray-600 hover:border-blue-500', dash: 'text-blue-600 dark:text-blue-400' },
  emerald: { on: 'bg-emerald-500 border-emerald-400 shadow-sm shadow-emerald-500/40', mixed: 'bg-emerald-100 dark:bg-emerald-500/20 border-emerald-300 dark:border-emerald-400/40', off: 'border-gray-300 dark:border-gray-600 hover:border-emerald-500', dash: 'text-emerald-600 dark:text-emerald-400' },
  amber: { on: 'bg-amber-500 border-amber-400 shadow-sm shadow-amber-500/40', mixed: 'bg-amber-100 dark:bg-amber-500/20 border-amber-300 dark:border-amber-400/40', off: 'border-gray-300 dark:border-gray-600 hover:border-amber-500', dash: 'text-amber-600 dark:text-amber-400' },
};

const SIZE = {
  sm: { box: 'w-4 h-4', icon: 9 },
  md: { box: 'w-[18px] h-[18px]', icon: 11 },
};

function CheckboxTile({
  checked = false,
  indeterminate = false,
  accent = 'blue',
  size = 'md',
  onClick,
  className = '',
}) {
  const cls = ACCENT[accent] || ACCENT.blue;
  const sz = SIZE[size] || SIZE.md;
  const stateCls = checked ? cls.on : indeterminate ? cls.mixed : cls.off;

  const box = (
    <div
      aria-hidden={!onClick ? 'true' : undefined}
      className={`${sz.box} rounded-md border flex items-center justify-center flex-shrink-0 transition-all ${stateCls} ${className}`}
    >
      {checked && <Check size={sz.icon} className="text-white" />}
      {!checked && indeterminate && <span className={`text-[8px] font-bold leading-none ${cls.dash}`}>–</span>}
    </div>
  );

  if (!onClick) return box;

  return (
    <div
      role="checkbox"
      aria-checked={checked ? true : indeterminate ? 'mixed' : false}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick(e);
        }
      }}
      className="focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 rounded-md"
      style={{ display: 'inline-flex' }}
    >
      {box}
    </div>
  );
}

// Rendered per-row in BG/env filter lists (dozens of tiles at once) —
// memoized so toggling one tile doesn't re-render every sibling tile.
export default React.memo(CheckboxTile);
