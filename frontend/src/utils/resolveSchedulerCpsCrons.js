import {
  getCloudhub2AppDetail, getCloudhub1AppDetail,
} from '../services/applicationsService';
import { fetchCpsProperties, resolveAndPostCpsCredentials } from '../services/cpsService';
import { extractCpsConfig, flattenCpsResponse, mergeAppProps, guessCpsEnvFromAppEnvironment } from './cpsHelpers';
import { mapWithConcurrency } from './concurrencyPool';

/**
 * Resolves `${cps.property}` placeholder cron/timezone values for a batch of
 * apps' schedulers, by fetching each app's runtime properties + CPS
 * non-secure/secure properties — the same per-app resolution the
 * Infrastructure tab's "Get Cron Expressions" button does for one app at a
 * time (see features/applications/tabs/InfrastructureTab.jsx), generalized
 * to run across every app that has an unresolved placeholder visible on the
 * Schedulers dashboard at once.
 *
 * By default fetches BOTH non-secure and secure properties (full manual-
 * resolve behavior, used by the "Resolve CPS Crons" button and the per-row
 * "Resolve from CPS" link). Pass `{ secure: false }` for the lightweight,
 * automatic background variant (see SchedulersPage.jsx's auto-resolve
 * effect) that only fetches non-secure properties — cheap enough (one app-
 * detail call + one non-secure CPS call per app, no secret-bearing fetch)
 * to run unattended for a small, bounded batch of currently-visible rows
 * without the cost/security concerns a full automatic secure-property
 * fetch across the whole dashboard would raise.
 *
 * @param {Array<{appId:string, envId:string, bgId:string, deploymentType:string}>} apps
 *   One entry per unique app (already deduped by the caller).
 * @param {object} creds
 * @param {boolean} creds.hasCredentials
 * @param {(clientId:string) => string|undefined} creds.getSecret
 * @param {() => Array<{clientId:string, clientSecret:string}>} creds.getAllCredentials
 * @param {number} [concurrency=5]
 * @param {object} [opts]
 * @param {boolean} [opts.secure=true]  fetch secure CPS properties too
 * @returns {Promise<Map<string, {props: Record<string,string>, error?: string}>>}
 *   Keyed by appId.
 */
export async function resolveSchedulerCpsPropsForApps(apps, { hasCredentials, getSecret, getAllCredentials }, concurrency = 5, opts = {}) {
  const { secure = true } = opts;
  const results = await mapWithConcurrency(apps, concurrency, async (app) => {
    const isCh2 = app.deploymentType === 'CloudHub 2.0';
    const detailRes = isCh2
      ? await getCloudhub2AppDetail(app.bgId, app.envId, app.appId)
      : await getCloudhub1AppDetail(app.envId, app.appId, app.bgId);

    const { cpsBaseUrl, cpsKey, cpsEnv: rawCpsEnv, cpsClientId } = extractCpsConfig(detailRes.data);
    if (!cpsBaseUrl) throw new Error('No CPS URL configured for this app');
    // Same fallback ApplicationDetailPage/InfrastructureTab rely on
    // (derived.cpsEnv) — many apps never set an explicit cps.prefix/
    // cps.environment ARM property, so without this the CPS fetch below
    // silently queried with an empty `environment` and got back whichever
    // environment's bucket the CPS server defaults to (often not the one
    // this app's placeholders actually live in), making resolution look
    // like it "never finds" a property that genuinely is in CPS.
    const cpsEnv = rawCpsEnv || guessCpsEnvFromAppEnvironment(detailRes.data?.environment?.name, detailRes.data?.environment?.type);

    if (hasCredentials) {
      await resolveAndPostCpsCredentials({
        cpsBaseUrl, cpsClientId, scopeId: app.bgId, hasCredentials, getSecret, getAllCredentials,
      });
    }

    const effectiveKey = cpsKey || app.appId;
    const nsRaw = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'non-secure', keys: effectiveKey, environment: cpsEnv, bgOrgId: app.bgId });
    const flatNs = flattenCpsResponse(nsRaw, effectiveKey);

    const secureKeyStr = flatNs['cps.secure.properties'] || '';
    let flatSecure = {};
    if (secure && secureKeyStr) {
      try {
        const secureRaw = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'secure', keys: secureKeyStr, environment: cpsEnv, bgOrgId: app.bgId });
        const groups = Array.isArray(secureRaw?.responses) ? secureRaw.responses
          : Array.isArray(secureRaw?.properties) ? secureRaw.properties
          : Array.isArray(secureRaw) ? secureRaw : [];
        groups.forEach((g) => Object.assign(flatSecure, g.properties || {}));
      } catch { /* secure fetch failed — non-secure props still useful */ }
    }

    // ARM runtime properties as the lowest-priority fallback — mirrors
    // exportCps.js's `fetchedAllProps` and InfrastructureTab's `allProps`
    // source, so a placeholder resolvable from the app's own deployment
    // properties (not pushed into CPS at all) still resolves here instead
    // of only working on the per-app Infrastructure tab.
    return { ...mergeAppProps(detailRes.data), ...flatNs, ...flatSecure };
  });

  const byAppId = new Map();
  results.forEach((r, i) => {
    const appId = apps[i].appId;
    if (r.status === 'fulfilled') byAppId.set(appId, { props: r.value });
    else byAppId.set(appId, { props: {}, error: r.reason?.message || 'Failed to fetch CPS properties' });
  });
  return byAppId;
}

/**
 * Resolves a single `${propName}` placeholder string against a flat props
 * map, with a case-insensitive fallback — mirrors the exact resolution
 * logic in InfrastructureTab.jsx / utils/exportCps.js so a value resolved
 * here looks identical to one resolved on the per-app tab.
 *
 * @param {string} value
 * @param {Record<string,string>} props
 * @returns {{resolved: string, wasResolved: boolean}}
 */
export function resolvePlaceholder(value, props) {
  if (!value || typeof value !== 'string') return { resolved: value, wasResolved: false };
  const resolved = value.replace(/\$\{([^}]+)\}/g, (match, propName) =>
    props[propName] ?? props[propName.toLowerCase()] ?? match
  );
  return { resolved, wasResolved: resolved !== value };
}
