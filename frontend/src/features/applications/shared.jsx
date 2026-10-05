import React, { useState } from 'react';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import { Check, Copy, Eye, EyeOff, AlertTriangle, Zap, Trash2, X, Power } from 'lucide-react';
import CopyBtn from '../../components/shared/CopyBtn';
import ConfirmActionModal from '../../components/ui/ConfirmActionModal';
import { ACTION_CONFIG } from '../../utils/appUtils';

/**
 * Shared UI primitives and confirm-dialogs for the Application Detail page's
 * tabs — extracted out of pages/ApplicationDetailPage.jsx (which otherwise
 * mixed these generic building blocks with the ~2500-line tab bodies) so
 * every features/applications/tabs/*.jsx file can import them without
 * depending on the page component itself — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */

/* ── Cron next-run calculator ──────────────────────────── */
/**
 * Computes the next scheduled run date from a cron expression.
 * Supports:
 *   5-field Unix cron  : min hr dom mon dow
 *   6-field Quartz cron: sec min hr dom mon dow
 *   7-field Quartz cron: sec min hr dom mon dow year
 * Returns a Date object, or null if the expression cannot be parsed / matched.
 */
export function getNextCronRun(cronExpr) {
  if (!cronExpr || typeof cronExpr !== 'string') return null;
  try {
    const parts = cronExpr.trim().replace(/\s+/g, ' ').split(' ');
    if (parts.length < 5 || parts.length > 7) return null;

    // Parse one cron field into a Set of valid integer values.
    // Returns null for wildcards (* or ?) meaning "any value matches".
    const parseField = (field, min, max) => {
      if (field === '*' || field === '?') return null;
      const vals = new Set();
      for (const seg of field.split(',')) {
        if (seg.includes('/')) {
          const [rangePart, stepStr] = seg.split('/');
          const step = Math.max(1, parseInt(stepStr, 10));
          let start = min, end = max;
          if (rangePart !== '*' && rangePart !== '') {
            if (rangePart.includes('-')) {
              const [a, b] = rangePart.split('-').map(Number);
              start = a; end = b;
            } else {
              start = parseInt(rangePart, 10);
            }
          }
          for (let i = start; i <= end; i += step) vals.add(i);
        } else if (seg.includes('-')) {
          const [a, b] = seg.split('-').map(Number);
          for (let i = a; i <= b; i++) vals.add(i);
        } else {
          const n = parseInt(seg, 10);
          if (!isNaN(n)) vals.add(n);
        }
      }
      return vals.size > 0 ? vals : null;
    };

    let secF, minF, hrF, domF, monF, dowF;
    if (parts.length === 5) {
      // Unix cron: min hr dom mon dow  (seconds fixed to 0)
      secF = new Set([0]);
      minF = parseField(parts[0], 0, 59);
      hrF  = parseField(parts[1], 0, 23);
      domF = parseField(parts[2], 1, 31);
      monF = parseField(parts[3], 1, 12);
      dowF = parseField(parts[4], 0, 6); // 0=Sun…6=Sat
    } else {
      // Quartz cron: sec min hr dom mon dow [year]
      secF = parseField(parts[0], 0, 59);
      minF = parseField(parts[1], 0, 59);
      hrF  = parseField(parts[2], 0, 23);
      domF = parseField(parts[3], 1, 31);
      monF = parseField(parts[4], 1, 12);
      // Quartz dow: 1=SUN…7=SAT  →  JS getDay(): 0=SUN…6=SAT
      const rawDow = parseField(parts[5], 1, 7);
      dowF = rawDow ? new Set([...rawDow].map(d => d - 1)) : null;
    }

    // hit(set, val) → true if set is null (wildcard) or contains val
    const hit = (set, val) => set === null || set.has(val);
    // nextHigher(set, cur) → lowest value in set that is > cur, or null if none
    const nextHigher = (set, cur) => {
      const arr = [...set].filter(v => v > cur).sort((a, b) => a - b);
      return arr.length > 0 ? arr[0] : null;
    };

    // DOM/DOW OR-logic: when both are restricted (non-wildcard), Quartz says "either can trigger"
    const domRaw = parts.length === 5 ? parts[2] : parts[3];
    const dowRaw = parts.length === 5 ? parts[4] : parts[5];
    const domWild = domRaw === '*' || domRaw === '?';
    const dowWild = dowRaw === '*' || dowRaw === '?';

    // Quartz supports special tokens in DOM/DOW ('L' = last day/weekday,
    // 'W' = nearest weekday, '#' = nth weekday-of-month) that parseField()
    // above does not understand — unparseable segments are silently dropped,
    // which can make a restricted field look like a wildcard and compute a
    // confidently-wrong next-run time instead of surfacing that this
    // expression can't be evaluated. Bail to "unknown" (null) instead.
    // 'W' is checked narrowly (not adjacent to another letter) so it doesn't
    // false-positive on weekday abbreviations like "WED".
    const hasSpecialToken = (f) => /[L#]/i.test(f) || /(^|[^A-Za-z])W([^A-Za-z]|$)/i.test(f);
    if (hasSpecialToken(domRaw) || hasSpecialToken(dowRaw)) return null;

    const d = new Date();
    d.setMilliseconds(0);
    d.setSeconds(d.getSeconds() + 1); // start searching from the next second

    const limit = new Date(d.getTime() + 366 * 24 * 3600 * 1000); // search up to 1 year ahead

    while (d <= limit) {
      // ── Month (JS 0-indexed → cron 1-indexed) ────────────────────────────
      if (!hit(monF, d.getMonth() + 1)) {
        const nxt = nextHigher(monF, d.getMonth() + 1);
        if (nxt === null) { d.setFullYear(d.getFullYear() + 1, 0, 1); d.setHours(0, 0, 0); }
        else              { d.setMonth(nxt - 1, 1); d.setHours(0, 0, 0); }
        continue;
      }
      // ── Day-of-month / Day-of-week ────────────────────────────────────────
      const domOk = hit(domF, d.getDate());
      const dowOk = hit(dowF, d.getDay());
      const dayOk = (!domWild && !dowWild) ? (domOk || dowOk)  // both specified → OR
                  : domWild                 ? dowOk              // only DOW matters
                  :                          domOk;              // only DOM matters
      if (!dayOk) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0); continue; }
      // ── Hour ──────────────────────────────────────────────────────────────
      if (!hit(hrF, d.getHours())) {
        const nxt = nextHigher(hrF, d.getHours());
        if (nxt === null) { d.setDate(d.getDate() + 1); d.setHours(0, 0, 0); }
        else              { d.setHours(nxt, 0, 0); }
        continue;
      }
      // ── Minute ────────────────────────────────────────────────────────────
      if (!hit(minF, d.getMinutes())) {
        const nxt = nextHigher(minF, d.getMinutes());
        if (nxt === null) { d.setHours(d.getHours() + 1, 0, 0); }
        else              { d.setMinutes(nxt, 0); }
        continue;
      }
      // ── Second ────────────────────────────────────────────────────────────
      if (!hit(secF, d.getSeconds())) {
        const nxt = nextHigher(secF, d.getSeconds());
        if (nxt === null) { d.setMinutes(d.getMinutes() + 1, 0); }
        else              { d.setSeconds(nxt); }
        continue;
      }
      return new Date(d); // all fields match → found next run
    }
    return null; // no match within 1 year
  } catch {
    return null;
  }
}

/* ── Micro components ──────────────────────────────────── */

// CopyBtn is imported from components/shared/CopyBtn (hover-fade shared component).
// CopyGroupBtn is unique to this page — always visible, orange tint, used for JSON copying.

// Always-visible copy button (no hover-fade) — used only in the secure group header
export const CopyGroupBtn = ({ text }) => {
  const [done, copy] = useCopyToClipboard(1500);
  return (
    <button onClick={() => copy(text)} className="flex items-center gap-1 p-1.5 rounded-lg text-sforange-600 dark:text-sforange-400 hover:text-sforange-700 dark:hover:text-sforange-300 hover:bg-sforange-100 dark:hover:bg-sforange-500/10 transition-all flex-shrink-0" title="Copy as JSON">
      {done ? <Check size={10} className="text-emerald-600"/> : <Copy size={10}/>}
    </button>
  );
};

export const SecretVal = ({ value }) => {
  const [show, setShow] = useState(false);
  const isSecret = /^\*+$/.test(String(value));
  return (
    <span className="flex items-center gap-1.5">
      <span className="font-mono text-xs text-gray-700 dark:text-gray-300 break-all">{show || !isSecret ? String(value) : '••••••••••••'}</span>
      {isSecret && (
        <button onClick={() => setShow(!show)} className="text-gray-400 dark:text-gray-500 hover:text-sf-600 dark:hover:text-sf-400 flex-shrink-0 transition-colors">
          {show ? <EyeOff size={11}/> : <Eye size={11}/>}
        </button>
      )}
    </span>
  );
};

export const TAG_COLORS = {
  cyan:   'text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20 bg-sfteal-50 dark:bg-sfteal-500/10',
  blue:   'text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20 bg-sf-50 dark:bg-sf-500/10',
  purple: 'text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20 bg-sfpurple-50 dark:bg-sfpurple-500/10',
  green:  'text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20 bg-emerald-50 dark:bg-emerald-500/10',
  red:    'text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20 bg-red-50 dark:bg-red-500/10',
  orange: 'text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20 bg-sforange-50 dark:bg-sforange-500/10',
  gray:   'text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60 bg-gray-100/60 dark:bg-gray-800/60',
};

export const MetaTag = ({ children, color = 'cyan' }) => (
  <span className={`font-mono text-[11px] px-2 py-0.5 rounded-md border font-medium ${TAG_COLORS[color] || TAG_COLORS.gray} leading-none`}>{children}</span>
);

// Solid dot colors for the small namespace indicator in the Properties table —
// kept separate from TAG_COLORS (which mixes bg/text/border for pill chips).
export const NS_DOT_COLORS = {
  blue: 'bg-sf-400 dark:bg-sf-500',
  cyan: 'bg-sfteal-400 dark:bg-sfteal-500',
  purple: 'bg-sfpurple-400 dark:bg-sfpurple-500',
  green: 'bg-emerald-400 dark:bg-emerald-500',
  orange: 'bg-sforange-400 dark:bg-sforange-500',
  red: 'bg-red-400 dark:bg-red-500',
};

export const PulseDot = ({ active }) => (
  <span className="relative flex h-2 w-2 flex-shrink-0">
    {active && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"/>}
    <span className={`relative inline-flex rounded-full h-2 w-2 ${active ? 'bg-emerald-400' : 'bg-gray-300 dark:bg-gray-600'}`}/>
  </span>
);

export const KVRow = ({ label, value, mono, secret }) => (
  <div className="group relative flex items-start gap-3 py-2.5 px-4 rounded-xl hover:bg-sf-50/50 dark:hover:bg-sf-500/5 transition-colors -mx-4">
    <span className="absolute left-0.5 top-1/2 -translate-y-1/2 w-0.5 h-0 group-hover:h-4 rounded-full bg-sf-400 dark:bg-sf-500 transition-all duration-200"/>
    <span className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex-shrink-0 w-40 pt-0.5">{label}</span>
    <div className="flex items-start gap-1.5 flex-1 min-w-0">
      {secret ? <SecretVal value={value}/> :
        <span className={`${mono?'font-mono text-xs text-gray-700 dark:text-gray-300':'text-sm text-gray-700 dark:text-gray-300'} break-all leading-relaxed`}>
          {value != null && value !== '' ? value : <span className="text-gray-400 dark:text-gray-600">—</span>}
        </span>
      }
      {value && <CopyBtn text={String(value)}/>}
    </div>
  </div>
);

// GlassCard/CARD_ACCENTS moved to components/ui/Card.jsx (shared across the
// whole app, not just Application Detail tabs) — see
// FRONTEND_ARCHITECTURE_REVIEW.md §10 "Components That Should Be Shared".
// Re-exported here under their old names so existing imports from
// `features/applications/*` keep working without touching every call site.
export { CARD_ACCENTS, default as GlassCard } from '../../components/ui/Card';

export const HERO_ACTION_ACCENTS = {
  sf:      { chip:'bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400',             chipHover:'group-hover:bg-sf-600 group-hover:text-white',             text:'group-hover:text-sf-700 dark:group-hover:text-sf-300' },
  sfteal:  { chip:'bg-sfteal-100 dark:bg-sfteal-500/15 text-sfteal-600 dark:text-sfteal-400', chipHover:'group-hover:bg-sfteal-600 group-hover:text-white',    text:'group-hover:text-sfteal-700 dark:group-hover:text-sfteal-300' },
  emerald: { chip:'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', chipHover:'group-hover:bg-emerald-600 group-hover:text-white', text:'group-hover:text-emerald-700 dark:group-hover:text-emerald-300' },
};

export const HeroActionBtn = ({ icon: Icon, label, accent='sf', onClick, title }) => {
  const a = HERO_ACTION_ACCENTS[accent] || HERO_ACTION_ACCENTS.sf;
  return (
    <button type="button" onClick={onClick} title={title}
      className="group flex items-center gap-2 pl-1.5 pr-3 py-1.5 rounded-xl text-xs font-medium text-gray-500 dark:text-gray-400 bg-white/70 dark:bg-gray-800/60 border border-gray-200/70 dark:border-gray-700/60 hover:border-transparent hover:bg-white dark:hover:bg-gray-800 hover:shadow-md transition-all">
      <span className={`flex items-center justify-center w-6 h-6 rounded-lg transition-all duration-200 ${a.chip} ${a.chipHover}`}>
        <Icon size={12} />
      </span>
      <span className={`transition-colors ${a.text}`}>{label}</span>
    </button>
  );
};

export const STAT_TILE_ACCENTS = {
  blue:    { chip:'bg-gradient-to-br from-sf-500 to-sf-600 shadow-sf-500/30',             ring:'group-hover:border-sf-300/70 dark:group-hover:border-sf-500/40' },
  teal:    { chip:'bg-gradient-to-br from-sfteal-500 to-sfteal-600 shadow-sfteal-500/30',  ring:'group-hover:border-sfteal-300/70 dark:group-hover:border-sfteal-500/40' },
  purple:  { chip:'bg-gradient-to-br from-sfpurple-500 to-sfpurple-600 shadow-sfpurple-500/30', ring:'group-hover:border-sfpurple-300/70 dark:group-hover:border-sfpurple-500/40' },
  emerald: { chip:'bg-gradient-to-br from-emerald-500 to-emerald-600 shadow-emerald-500/30', ring:'group-hover:border-emerald-300/70 dark:group-hover:border-emerald-500/40' },
  amber:   { chip:'bg-gradient-to-br from-amber-500 to-amber-600 shadow-amber-500/30',     ring:'group-hover:border-amber-300/70 dark:group-hover:border-amber-500/40' },
  red:     { chip:'bg-gradient-to-br from-red-500 to-red-600 shadow-red-500/30',           ring:'group-hover:border-red-300/70 dark:group-hover:border-red-500/40' },
  gray:    { chip:'bg-gray-300 dark:bg-gray-700',                                          ring:'group-hover:border-gray-300/70 dark:group-hover:border-gray-600/50' },
};

// Hero-style stat tile used atop the Overview tab — surfaces the handful of facts
// that matter most at a glance, instead of burying them in a flat KV list.
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

// Groups KVRows within a card under a small uppercase section label with a divider —
// turns a long flat list of facts into scannable, named clusters.
export const SectionLabel = ({ icon: Icon, children }) => (
  <div className="flex items-center gap-1.5 pt-1 pb-1.5 mt-1 first:mt-0">
    {Icon && <Icon size={10} className="text-gray-400 dark:text-gray-500" />}
    <span className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase">{children}</span>
    <span className="flex-1 h-px bg-gray-100 dark:bg-gray-800" />
  </div>
);

/* ── Action helpers ────────────────────────────────────── */
// availableActions and ACTION_CONFIG are imported from utils/appUtils.
// Use detailCls (detail-page border style) instead of btnCls for action buttons here.

export function AppConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, appName } = state;
  const cfg = ACTION_CONFIG[action];
  const { Icon, label, bulkCls } = cfg;
  const dangerous = action === 'stop';
  return (
    <ConfirmActionModal
      icon={AlertTriangle}
      accent={dangerous ? 'red' : 'sf'}
      title={`${label} Application?`}
      colorClassName={bulkCls}
      confirmLabel={<><Icon size={13} /> Confirm {label}</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to <span className="font-semibold text-gray-900 dark:text-gray-100">{label.toLowerCase()}</span>{' '}
            <span className="font-mono text-sf-700 dark:text-sf-300 text-xs bg-sf-50 dark:bg-sf-500/15 px-1.5 py-0.5 rounded-md">{appName}</span>?
          </p>
          {dangerous && <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ This will stop all running flows and connections.</p>}
        </>
      }
    />
  );
}

// `label` is the human-readable identifier to display (e.g. real
// schedulerKey + app name) — defaults to `schedulerKey` for callers (like
// InfrastructureTab, scoped to a single app) where schedulerKey IS already
// the real, unambiguous Anypoint identifier. Callers that key this modal by
// something else (e.g. SchedulersPage's cross-app composite rowKey, needed
// because schedulerKey alone can collide between apps) must pass `label`
// explicitly or users would see that internal id instead of a real name.
export function SchedulerConfirmModal({ schedulerKey, label, onConfirm, onCancel, loading }) {
  if (!schedulerKey) return null;
  return (
    <ConfirmActionModal
      icon={Zap}
      accent="purple"
      title="Run Scheduler Now?"
      colorClassName="bg-gradient-to-b from-sfpurple-500 to-sfpurple-600 hover:from-sfpurple-400 hover:to-sfpurple-500 shadow-sfpurple-500/30 hover:shadow-sfpurple-500/40"
      confirmLabel={<><Zap size={13} /> Run Now</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to trigger{' '}
            <span className="font-mono text-sfpurple-700 dark:text-sfpurple-300 text-xs bg-sfpurple-50 dark:bg-sfpurple-500/15 px-1.5 py-0.5 rounded-md">{label || schedulerKey}</span>{' '}
            immediately?
          </p>
          <p className="text-amber-600 dark:text-amber-400 text-xs mt-2 font-medium">⚠ This will execute the scheduler flow outside its normal schedule.</p>
        </>
      }
    />
  );
}

// See SchedulerConfirmModal's comment re: `label` — same rationale applies
// here (`state.label` optional, falls back to the raw `schedulerKey`).
export function SchedulerToggleConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { schedulerKey, nextEnabled, label } = state;
  return (
    <ConfirmActionModal
      icon={Power}
      accent={nextEnabled ? 'emerald' : 'red'}
      title={nextEnabled ? 'Enable Scheduler?' : 'Disable Scheduler?'}
      colorClassName={nextEnabled
        ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 shadow-emerald-500/30 hover:shadow-emerald-500/40'
        : 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 shadow-red-500/30 hover:shadow-red-500/40'}
      confirmLabel={<><Power size={13} /> {nextEnabled ? 'Enable' : 'Disable'}</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to{' '}
            <span className={`font-semibold ${nextEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {nextEnabled ? 'enable' : 'disable'}
            </span>{' '}
            the scheduler{' '}
            <span className="font-mono text-sfpurple-700 dark:text-sfpurple-300 text-xs bg-sfpurple-50 dark:bg-sfpurple-500/15 px-1.5 py-0.5 rounded-md">{label || schedulerKey}</span>?
          </p>
          {!nextEnabled && (
            <p className="text-amber-600 dark:text-amber-400 text-xs mt-2 font-medium">⚠ The flow will no longer run on its schedule until re-enabled.</p>
          )}
        </>
      }
    />
  );
}

// `labels` (optional) is a display-text array parallel to `schedulerKeys` —
// see SchedulerConfirmModal's comment re: internal id vs. display label.
// Falls back to the raw key per-entry when omitted. List items are keyed by
// `${k}-${i}` (not just `k`) since `schedulerKeys` can legitimately contain
// the same raw value more than once across different apps.
export function BulkSchedulerToggleConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { schedulerKeys, nextEnabled, labels } = state;
  const count = schedulerKeys?.length || 0;
  return (
    <ConfirmActionModal
      icon={Power}
      accent={nextEnabled ? 'emerald' : 'red'}
      title={nextEnabled ? `Enable ${count} Scheduler${count !== 1 ? 's' : ''}?` : `Disable ${count} Scheduler${count !== 1 ? 's' : ''}?`}
      colorClassName={nextEnabled
        ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 shadow-emerald-500/30 hover:shadow-emerald-500/40'
        : 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 shadow-red-500/30 hover:shadow-red-500/40'}
      confirmLabel={<><Power size={13} /> {nextEnabled ? 'Enable All' : 'Disable All'}</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to{' '}
            <span className={`font-semibold ${nextEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
              {nextEnabled ? 'enable' : 'disable'}
            </span>{' '}
            these {count} scheduler{count !== 1 ? 's' : ''}?
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto">
            {(schedulerKeys || []).map((k, i) => (
              <span key={`${k}-${i}`} className="font-mono text-sfpurple-700 dark:text-sfpurple-300 text-[10px] bg-sfpurple-50 dark:bg-sfpurple-500/15 px-1.5 py-0.5 rounded-md">{labels?.[i] || k}</span>
            ))}
          </div>
          {!nextEnabled && (
            <p className="text-amber-600 dark:text-amber-400 text-xs mt-2 font-medium">⚠ These flows will no longer run on their schedule until re-enabled.</p>
          )}
        </>
      }
    />
  );
}

// Same `labels` convention as BulkSchedulerToggleConfirmModal above.
export function BulkSchedulerRunConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { schedulerKeys, labels } = state;
  const count = schedulerKeys?.length || 0;
  return (
    <ConfirmActionModal
      icon={Zap}
      accent="purple"
      title={`Run ${count} Scheduler${count !== 1 ? 's' : ''} Now?`}
      colorClassName="bg-gradient-to-b from-sfpurple-500 to-sfpurple-600 hover:from-sfpurple-400 hover:to-sfpurple-500 shadow-sfpurple-500/30 hover:shadow-sfpurple-500/40"
      confirmLabel={<><Zap size={13} /> Run All</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to trigger these {count} scheduler{count !== 1 ? 's' : ''} immediately?
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto">
            {(schedulerKeys || []).map((k, i) => (
              <span key={`${k}-${i}`} className="font-mono text-sfpurple-700 dark:text-sfpurple-300 text-[10px] bg-sfpurple-50 dark:bg-sfpurple-500/15 px-1.5 py-0.5 rounded-md">{labels?.[i] || k}</span>
            ))}
          </div>
          <p className="text-amber-600 dark:text-amber-400 text-xs mt-2 font-medium">⚠ This will execute each scheduler flow outside its normal schedule.</p>
        </>
      }
    />
  );
}

export function ContractConfirmModal({ state, onConfirm, onCancel, loading }) {
  if (!state) return null;
  const { action, appName } = state;
  const isRevoke = action === 'revoke';
  const isDelete = action === 'delete';
  const dangerous = isDelete || isRevoke;
  const confirmCls = isDelete
    ? 'bg-gradient-to-b from-red-600 to-red-700 hover:from-red-500 hover:to-red-600 shadow-red-500/30 hover:shadow-red-500/40'
    : isRevoke
    ? 'bg-gradient-to-b from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 shadow-red-500/30 hover:shadow-red-500/40'
    : 'bg-gradient-to-b from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 shadow-emerald-500/30 hover:shadow-emerald-500/40';
  return (
    <ConfirmActionModal
      icon={isDelete ? Trash2 : isRevoke ? X : Check}
      accent={dangerous ? 'red' : 'emerald'}
      title={isDelete ? 'Delete Contract?' : isRevoke ? 'Revoke Contract?' : 'Approve Contract?'}
      colorClassName={confirmCls}
      confirmLabel={isDelete ? <><Trash2 size={13} /> Delete</> : isRevoke ? <><X size={13} /> Revoke</> : <><Check size={13} /> Approve</>}
      loading={loading}
      onConfirm={onConfirm}
      onCancel={onCancel}
      message={
        <>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Are you sure you want to{' '}
            <span className={`font-semibold ${dangerous ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {isDelete ? 'permanently delete' : isRevoke ? 'revoke' : 'approve'}
            </span>{' '}
            the contract for{' '}
            <span className="font-mono text-sf-700 dark:text-sf-300 text-xs bg-sf-50 dark:bg-sf-500/15 px-1.5 py-0.5 rounded-md">{appName}</span>?
          </p>
          {isDelete && (
            <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ This action is irreversible. The contract will be permanently removed.</p>
          )}
          {isRevoke && !isDelete && (
            <p className="text-red-600 dark:text-red-400 text-xs mt-2 font-medium">⚠ The client application will immediately lose access to this API.</p>
          )}
        </>
      }
    />
  );
}
