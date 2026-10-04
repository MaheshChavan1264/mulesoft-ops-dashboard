import React from 'react';

/**
 * Card
 *
 * Shared "glass" card shell — header chip/title/count + bordered body.
 * Extracted from `features/applications/shared.jsx`'s `GlassCard` (itself a
 * dedupe of the repeated ~190-char card wrapper string hand-rolled across
 * 15+ places in the Application Detail tabs, CPS pages, etc.) — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 "Components That Should Be Shared"
 * and Top-10-Tailwind-Improvements #2.
 *
 * Props:
 *   icon      {Component}  lucide-react icon rendered in the header chip
 *   title     {ReactNode}  Header title
 *   count     {number}     Optional badge count rendered top-right of header
 *   accent    {string}     One of CARD_ACCENTS keys (default 'gray')
 *   noPad     {boolean}    Skip the body's default px-5 py-4 padding
 *   children  {ReactNode}  Card body content
 */
export const CARD_ACCENTS = {
  blue:   { chip:'bg-gradient-to-br from-sf-500 to-sf-600 shadow-sf-500/30',             border:'border-sf-200/60 dark:border-sf-400/15',             headerBg:'bg-sf-50/60 dark:bg-sf-500/5',             badge:'bg-sf-100 dark:bg-sf-500/15 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20' },
  purple: { chip:'bg-gradient-to-br from-sfpurple-500 to-sfpurple-600 shadow-sfpurple-500/30', border:'border-sfpurple-200/60 dark:border-sfpurple-400/15', headerBg:'bg-sfpurple-50/60 dark:bg-sfpurple-500/5', badge:'bg-sfpurple-100 dark:bg-sfpurple-500/15 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20' },
  cyan:   { chip:'bg-gradient-to-br from-sfteal-500 to-sfteal-600 shadow-sfteal-500/30',  border:'border-sfteal-200/60 dark:border-sfteal-400/15',    headerBg:'bg-sfteal-50/60 dark:bg-sfteal-500/5',    badge:'bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20' },
  orange: { chip:'bg-gradient-to-br from-sforange-500 to-sforange-600 shadow-sforange-500/30', border:'border-sforange-200/60 dark:border-sforange-400/15', headerBg:'bg-sforange-50/60 dark:bg-sforange-500/5', badge:'bg-sforange-100 dark:bg-sforange-500/15 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' },
  green:  { chip:'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30', border:'border-emerald-200/60 dark:border-emerald-400/15', headerBg:'bg-emerald-50/60 dark:bg-emerald-500/5', badge:'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20' },
  gray:   { chip:'bg-gray-200/80 dark:bg-gray-700',                                       border:'border-gray-200/70 dark:border-gray-700/60',         headerBg:'bg-gray-50/70 dark:bg-gray-800/40',        badge:'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60' },
};

export default function Card({ icon: Icon, title, count, accent = 'gray', children, noPad }) {
  const a = CARD_ACCENTS[accent] || CARD_ACCENTS.gray;
  return (
    <div className={`group rounded-2xl border ${a.border} bg-white/70 dark:bg-gray-900/50 backdrop-blur-md shadow-lg shadow-gray-900/5 dark:shadow-black/20 hover:shadow-xl transition-all duration-300 overflow-hidden`}>
      <div className={`flex items-center gap-3 px-5 py-4 border-b ${a.border} ${a.headerBg}`}>
        {Icon && (
          <div className={`flex items-center justify-center w-7 h-7 rounded-lg flex-shrink-0 shadow-sm ${a.chip} ${accent === 'gray' ? 'text-gray-500 dark:text-gray-400' : 'text-white shadow-lg'}`}>
            <Icon size={13} />
          </div>
        )}
        <span className="text-gray-800 dark:text-gray-100 font-semibold text-sm">{title}</span>
        {count != null && <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-semibold border ${a.badge}`}>{count}</span>}
      </div>
      <div className={noPad ? '' : 'px-5 py-4'}>{children}</div>
    </div>
  );
}
