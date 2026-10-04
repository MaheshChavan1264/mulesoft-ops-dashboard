/**
 * Centralized semantic accent-color system.
 *
 * Several independent "accent → Tailwind class" lookup tables were
 * previously hand-copied across the codebase — most notably `ENV_TAG_COLOR`
 * (ApiManagerPage), the identically-shaped inline object in ApplicationsPage,
 * and `ENV_TAG` (CpsComparisonPage), which were all byte-for-byte the same
 * `{ production: ..., sandbox: ... }` map — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4/§10. A single canonical source avoids
 * the three copies drifting independently.
 *
 * This module intentionally only centralizes mappings that were verified
 * duplicates; it is not a forced rewrite of every per-page accent table
 * (e.g. ApplicationDetailPage's CARD_ACCENTS/STAT_TILE_ACCENTS carry extra
 * page-specific fields and are left as-is to avoid unrelated behavior
 * changes). New call sites needing an environment-type → chip-color class
 * should import ENV_TAG_COLOR from here instead of redefining it.
 */

/**
 * Environment-type → "tag/chip" background+text classes.
 * Pairs with utils/appUtils.js's ENV_BADGE (dot-color classes) — the two
 * are kept separate because ENV_BADGE is a single background-color utility
 * for a small status dot, while ENV_TAG_COLOR is a bg+text pair for a
 * pill/chip label.
 */
export const ENV_TAG_COLOR = {
  production: 'bg-sfgreen-100 text-sfgreen-600',
  sandbox: 'bg-sforange-100 text-sforange-600',
};

/**
 * Generic semantic accent palette — {chip, text, border} Tailwind class
 * fragments per color name, aligned with the same palette used by
 * components/ui/Modal.jsx and components/ui/Button.jsx so badges/pills
 * built from this table visually match modal headers/buttons using the
 * same accent name.
 */
export const ACCENT_PALETTE = {
  blue: { chip: 'bg-blue-100 dark:bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-200/60 dark:border-blue-400/30' },
  sf: { chip: 'bg-sf-50 dark:bg-sf-500/10', text: 'text-sf-600 dark:text-sf-400', border: 'border-sf-200/60 dark:border-sf-400/30' },
  emerald: { chip: 'bg-emerald-100 dark:bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-200/60 dark:border-emerald-400/30' },
  red: { chip: 'bg-red-100 dark:bg-red-500/15', text: 'text-red-600 dark:text-red-400', border: 'border-red-200/60 dark:border-red-400/30' },
  amber: { chip: 'bg-amber-100 dark:bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-200/60 dark:border-amber-400/30' },
  purple: { chip: 'bg-purple-100 dark:bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-200/60 dark:border-purple-400/30' },
  slate: { chip: 'bg-slate-100 dark:bg-slate-500/15', text: 'text-slate-600 dark:text-slate-400', border: 'border-slate-200/60 dark:border-slate-400/30' },
};

/**
 * Resolve the {chip, text, border} class fragments for a given accent name,
 * falling back to 'slate' for unknown names.
 * @param {string} accent
 */
export function getAccentClasses(accent) {
  return ACCENT_PALETTE[accent] || ACCENT_PALETTE.slate;
}

/**
 * Contract-status → badge classes (bg+text+border), aligned with
 * components/ui/StatusBadge.jsx's app-status pill convention
 * (`border-X-200/80 dark:border-X-400/30`).
 *
 * Previously defined independently in features/api-manager/ContractCard.jsx
 * (badge pill) and features/applications/tabs/ContractsTab.jsx (table-cell
 * badge) with slightly different border opacities — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #17.
 */
export const CONTRACT_STATUS_COLOR = {
  APPROVED: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/80 dark:border-emerald-400/30',
  REVOKED: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200/80 dark:border-red-400/30',
  PENDING: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-500/10 border-amber-200/80 dark:border-amber-400/30',
  UNKNOWN: 'text-gray-600 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/40 border-gray-200/80 dark:border-gray-600/40',
};

/**
 * Normalise a raw Anypoint contract status string (which can be
 * 'ACTIVE'/'APPROVED', 'PENDING'/'PENDING_APPROVAL', 'REVOKED', or
 * anything else) and resolve the matching badge classes from
 * `CONTRACT_STATUS_COLOR`.
 * @param {string} [rawStatus]
 */
export function getContractStatusClasses(rawStatus) {
  const status = (rawStatus || 'ACTIVE').toUpperCase();
  if (status === 'ACTIVE' || status === 'APPROVED') return CONTRACT_STATUS_COLOR.APPROVED;
  if (status === 'REVOKED') return CONTRACT_STATUS_COLOR.REVOKED;
  if (status === 'PENDING' || status === 'PENDING_APPROVAL') return CONTRACT_STATUS_COLOR.PENDING;
  return CONTRACT_STATUS_COLOR.UNKNOWN;
}
