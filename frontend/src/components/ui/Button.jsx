import React from 'react';
import { RefreshCw } from 'lucide-react';

/**
 * Button
 *
 * Shared action-button primitive. Collapses the "Cancel"/"primary submit"
 * className strings that were previously hand-copied into every modal
 * footer (see FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #2/#8 and §4) and
 * the `{loading ? <spinner/> : <icon/>}` ternary that was duplicated 12+
 * times across CPS components.
 *
 * Props:
 *   variant        {'primary'|'secondary'|'danger'} default 'primary'
 *   accent         {'blue'|'emerald'|'red'|'amber'|'purple'|'slate'} color for
 *                  the 'primary' variant's gradient fill (ignored for other variants)
 *   colorClassName {string}  full literal color/shadow class string that
 *                  completely replaces the `accent` lookup — needed for
 *                  callers (e.g. ACTION_CONFIG's start/stop/restart `bulkCls`)
 *                  that already own a complete, pre-defined gradient/shadow
 *                  class string outside this component's fixed palette.
 *   loading        {boolean}  shows a spinning RefreshCw instead of `icon`
 *   icon           {Component} lucide-react icon rendered before `children`
 *   size           {'sm'|'md'} default 'md'
 *   disabled       {boolean}
 *   className      {string}   extra classes appended last (can override)
 *   ...rest        forwarded to the underlying <button>
 */
const PRIMARY_ACCENT = {
  blue: 'bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 shadow-blue-500/30 hover:shadow-blue-500/40',
  emerald: 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 shadow-emerald-500/30 hover:shadow-emerald-500/40',
  red: 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 shadow-red-500/30 hover:shadow-red-500/40',
  amber: 'bg-gradient-to-b from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 shadow-amber-500/30 hover:shadow-amber-500/40',
  purple: 'bg-gradient-to-b from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 shadow-purple-500/30 hover:shadow-purple-500/40',
  slate: 'bg-gradient-to-b from-slate-500 to-slate-600 hover:from-slate-400 hover:to-slate-500 shadow-slate-500/30 hover:shadow-slate-500/40',
};

const SIZE_CLASS = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
};

export default function Button({
  variant = 'primary',
  accent = 'blue',
  colorClassName,
  loading = false,
  icon: Icon,
  size = 'md',
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  const base = `flex items-center gap-2 ${SIZE_CLASS[size] || SIZE_CLASS.md} font-semibold rounded-xl disabled:opacity-50 transition-all duration-200`;

  let variantCls;
  if (colorClassName) {
    variantCls = `text-white ${colorClassName} shadow-md hover:shadow-lg ring-1 ring-inset ring-white/20 hover:-translate-y-0.5 active:translate-y-0`;
  } else if (variant === 'secondary') {
    variantCls = 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700';
  } else if (variant === 'danger') {
    variantCls = `text-white ${PRIMARY_ACCENT.red} shadow-md hover:shadow-lg ring-1 ring-inset ring-white/20 hover:-translate-y-0.5 active:translate-y-0`;
  } else {
    variantCls = `text-white ${PRIMARY_ACCENT[accent] || PRIMARY_ACCENT.blue} shadow-md hover:shadow-lg ring-1 ring-inset ring-white/20 hover:-translate-y-0.5 active:translate-y-0`;
  }

  return (
    <button disabled={disabled || loading} className={`${base} ${variantCls} ${className}`} {...rest}>
      {loading
        ? <RefreshCw size={13} className="animate-spin" />
        : Icon && <Icon size={13} />}
      {children}
    </button>
  );
}
