import React from 'react';

/**
 * StatTile
 *
 * Hero-style stat tile — surfaces a handful of facts at a glance instead of
 * burying them in a flat KV list. Extracted from `features/applications/
 * shared.jsx` (where it originated for the Overview tab) up into
 * `components/ui` so it can be reused outside the applications feature
 * (e.g. the shared ApiSpecPanel used by both ApplicationDetailPage and
 * ExchangePage) — mirrors the same promotion already done for GlassCard
 * (see Card.jsx's header comment). `features/applications/shared.jsx`
 * re-exports this for every existing import site, so no caller needed to
 * change.
 *
 * Props:
 *   icon    {Component}  lucide-react icon rendered in the tile's chip
 *   label   {string}     Small uppercase label
 *   value   {ReactNode}  Main value (shown as em-dash when null/undefined)
 *   sub     {ReactNode}  Optional secondary line
 *   accent  {string}     One of STAT_TILE_ACCENTS keys (default 'blue')
 */
export const STAT_TILE_ACCENTS = {
  blue:    { chip:'bg-gradient-to-br from-sf-500 to-sf-600 shadow-sf-500/30',             ring:'group-hover:border-sf-300/70 dark:group-hover:border-sf-500/40' },
  teal:    { chip:'bg-gradient-to-br from-sfteal-500 to-sfteal-600 shadow-sfteal-500/30',  ring:'group-hover:border-sfteal-300/70 dark:group-hover:border-sfteal-500/40' },
  purple:  { chip:'bg-gradient-to-br from-sfpurple-500 to-sfpurple-600 shadow-sfpurple-500/30', ring:'group-hover:border-sfpurple-300/70 dark:group-hover:border-sfpurple-500/40' },
  emerald: { chip:'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30', ring:'group-hover:border-emerald-300/70 dark:group-hover:border-emerald-500/40' },
  amber:   { chip:'bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-500/30',     ring:'group-hover:border-amber-300/70 dark:group-hover:border-amber-500/40' },
  red:     { chip:'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30',           ring:'group-hover:border-red-300/70 dark:group-hover:border-red-500/40' },
  gray:    { chip:'bg-gray-300 dark:bg-gray-700',                                          ring:'group-hover:border-gray-300/70 dark:group-hover:border-gray-600/50' },
};

export const StatTile = ({ icon: Icon, label, value, sub, accent='blue' }) => {
  const a = STAT_TILE_ACCENTS[accent] || STAT_TILE_ACCENTS.blue;
  return (
    <div className={`group relative rounded-2xl border border-gray-200/70 dark:border-gray-700/60 bg-white/70 dark:bg-gray-900/50 backdrop-blur-md px-4 py-3.5 shadow-sm hover:shadow-lg transition-all duration-300 ${a.ring}`}>
      <div className="flex items-center gap-3">
        <div className={`flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 text-white shadow-md ${a.chip}`}>
          <Icon size={16} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase">{label}</p>
          <p className="text-sm font-semibold text-gray-800 dark:text-gray-100 truncate" title={typeof value === 'string' ? value : undefined}>
            {value ?? <span className="text-gray-400 dark:text-gray-600 font-normal">—</span>}
          </p>
          {sub && <p className="text-[11px] text-gray-400 dark:text-gray-500 truncate mt-0.5">{sub}</p>}
        </div>
      </div>
    </div>
  );
};

export default StatTile;
