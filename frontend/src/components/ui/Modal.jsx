import React from 'react';
import { X } from 'lucide-react';

/**
 * Modal
 *
 * Shared backdrop + card shell used by every modal dialog in the app.
 * Extracted from 7 near-identical hand-rolled implementations
 * (BgFilterModal, EnvFilterModal, CpsCreateModal, CpsDeleteProjectModal,
 * CpsImportModal, CpsExportModal, CpsSettingsModal) that had drifted into
 * two incompatible visual families (different backdrop opacity, corner
 * radius, and dark-mode support) — see FRONTEND_ARCHITECTURE_REVIEW.md §1
 * finding #8 and §2.
 *
 * This component always renders the "rounded-3xl / dark-mode aware" family
 * going forward, so every new/migrated modal looks and behaves identically.
 *
 * Props:
 *   onClose       {function}            Called on backdrop click or close button
 *   size          {'sm'|'md'|'lg'|'xl'} Max width — sm=max-w-md, md=max-w-xl,
 *                                       lg=max-w-2xl, xl=max-w-3xl (default 'md')
 *   icon          {Component}           lucide-react icon rendered in the header chip
 *   accent        {string}              Tailwind color name used for the header
 *                                       gradient/icon chip (e.g. 'blue', 'emerald', 'red')
 *   title         {ReactNode}           Header title
 *   subtitle      {ReactNode}           Header subtitle (optional)
 *   closeDisabled {boolean}             Disables the close button (e.g. while saving)
 *   headerExtra   {ReactNode}           Extra controls rendered in the header, just
 *                                       before the close button (e.g. an import button)
 *   footer        {ReactNode}           Footer content (typically Cancel + primary Button)
 *   children      {ReactNode}           Modal body content (scrollable)
 *   bodyClassName {string}              Extra classes for the scrollable body wrapper
 */
const SIZE_CLASS = {
  sm: 'max-w-md',
  base: 'max-w-lg',
  md: 'max-w-xl',
  lg: 'max-w-2xl',
  xl: 'max-w-3xl',
};

// Tailwind's JIT scanner only detects complete, literal class-name strings in
// the source — `bg-${accent}-100` would never match anything, so every
// accent variant must be spelled out in full here instead of interpolated.
const ACCENT_CLASS = {
  blue: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-blue-50/80 dark:from-blue-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-blue-100 dark:bg-blue-500/15 shadow-sm',
    icon: 'text-blue-600 dark:text-blue-400',
  },
  sf: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-sf-50/80 dark:from-sf-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-sf-50 dark:bg-sf-500/10 shadow-sm',
    icon: 'text-sf-600 dark:text-sf-400',
  },
  emerald: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-emerald-50/80 dark:from-emerald-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-emerald-100 dark:bg-emerald-500/15 shadow-sm',
    icon: 'text-emerald-600 dark:text-emerald-400',
  },
  red: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-red-50/80 dark:from-red-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-red-100 dark:bg-red-500/15 shadow-sm',
    icon: 'text-red-600 dark:text-red-400',
  },
  amber: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-amber-50/80 dark:from-amber-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-amber-100 dark:bg-amber-500/15 shadow-sm',
    icon: 'text-amber-600 dark:text-amber-400',
  },
  purple: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-purple-50/80 dark:from-purple-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-purple-100 dark:bg-purple-500/15 shadow-sm',
    icon: 'text-purple-600 dark:text-purple-400',
  },
  slate: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-slate-50/80 dark:from-slate-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-slate-100 dark:bg-slate-500/15 shadow-sm',
    icon: 'text-slate-600 dark:text-slate-400',
  },
  teal: {
    gradient: 'absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-teal-50/80 dark:from-teal-500/[0.07] to-transparent pointer-events-none',
    chip: 'p-3 rounded-2xl bg-teal-100 dark:bg-teal-500/15 shadow-sm',
    icon: 'text-teal-600 dark:text-teal-400',
  },
};

export default function Modal({
  onClose,
  size = 'md',
  icon: Icon,
  accent = 'blue',
  title,
  subtitle,
  closeDisabled = false,
  headerExtra,
  footer,
  children,
  bodyClassName = '',
}) {
  const accentCls = ACCENT_CLASS[accent] || ACCENT_CLASS.blue;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className={`bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700/80 rounded-3xl w-full ${SIZE_CLASS[size] || SIZE_CLASS.md} shadow-2xl flex flex-col max-h-[90vh] overflow-hidden`}>
        {(title || Icon) && (
          <div className="relative flex items-center justify-between px-6 py-5 border-b border-gray-100 dark:border-gray-700/60 flex-shrink-0">
            <div className={accentCls.gradient} />
            <div className="relative flex items-center gap-3.5">
              {Icon && (
                <div className={accentCls.chip}>
                  <Icon size={18} className={accentCls.icon} />
                </div>
              )}
              <div>
                {title && <h2 className="text-gray-900 dark:text-gray-100 font-bold text-base">{title}</h2>}
                {subtitle && <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <div className="relative flex items-center gap-2 flex-shrink-0">
              {headerExtra}
              <button
                onClick={onClose}
                aria-label="Close"
                disabled={closeDisabled}
                className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 p-1.5 rounded-xl transition-colors disabled:opacity-30 flex-shrink-0"
              >
                <X size={16} />
              </button>
            </div>
          </div>
        )}

        <div className={`overflow-y-auto flex-1 px-6 py-5 space-y-4 ${bodyClassName}`}>
          {children}
        </div>

        {footer && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-700/60 gap-3 flex-shrink-0 bg-gray-50/50 dark:bg-gray-900/30">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
