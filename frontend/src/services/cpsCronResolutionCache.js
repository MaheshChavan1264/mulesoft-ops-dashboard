/**
 * Tiny cross-page cache for CPS-resolved scheduler cron/timezone values.
 *
 * The Schedulers dashboard (SchedulersPage) shows the raw `${cps.property}`
 * placeholder for any app's scheduler whose cron/timezone comes from a CPS
 * secure property — resolving it there would mean fetching CPS secure
 * properties (which needs app-specific credentials) for every visible app
 * on a hot aggregate endpoint, which is far too expensive to do automatically.
 * The per-app Infrastructure tab (features/applications/tabs/InfrastructureTab.jsx)
 * already does this resolution on-demand via its "Get Cron Expressions"
 * button, scoped to one app at a time.
 *
 * This module remembers that one-time per-app resolution so that if the
 * user resolves an app's CPS cron on the Infrastructure tab (e.g. via the
 * Schedulers dashboard's "Resolve from CPS →" link) and then navigates back,
 * the dashboard shows the real value instead of the placeholder — without
 * ever needing to fetch CPS credentials itself.
 *
 * Lives in module scope (survives navigation, cleared on refresh) — same
 * lifetime contract as services/apiCache.js.
 */
const resolved = new Map(); // `${appId}|${schedulerKey}` -> { cron, timeZone }

/** @param {string} appId @param {string} schedulerKey @param {{cron?: string, timeZone?: string}} value */
export function rememberResolvedSchedule(appId, schedulerKey, value) {
  if (!appId || !schedulerKey || !value) return;
  resolved.set(`${appId}|${schedulerKey}`, value);
}

/** @returns {{cron?: string, timeZone?: string}|null} */
export function getResolvedSchedule(appId, schedulerKey) {
  if (!appId || !schedulerKey) return null;
  return resolved.get(`${appId}|${schedulerKey}`) || null;
}
