import {
  getCloudhub2AppDetail, getCloudhub1AppDetail,
} from '../services/applicationsService';
import { fetchCpsProperties, resolveAndPostCpsCredentials } from '../services/cpsService';
import { extractCpsConfig, flattenCpsResponse } from './cpsHelpers';
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
 * Deliberately NOT run automatically on page load — this fetches CPS
 * secure properties (needs credentials) for potentially many apps, which is
 * exactly the cost the aggregate `/applications/schedulers/:orgId` endpoint
 * avoids by design (see backend's normalizeSchedulerRow comment). This is
 * only invoked by an explicit user click.
 *
 * @param {Array<{appId:string, envId:string, bgId:string, deploymentType:string}>} apps
 *   One entry per unique app (already deduped by the caller).
 * @param {object} creds
 * @param {boolean} creds.hasCredentials
 * @param {(clientId:string) => string|undefined} creds.getSecret
 * @param {() => Array<{clientId:string, clientSecret:string}>} creds.getAllCredentials
 * @param {number} [concurrency=5]
 * @returns {Promise<Map<string, {props: Record<string,string>, error?: string}>>}
 *   Keyed by appId.
 */
export async function resolveSchedulerCpsPropsForApps(apps, { hasCredentials, getSecret, getAllCredentials }, concurrency = 5) {
  const results = await mapWithConcurrency(apps, concurrency, async (app) => {
    const isCh2 = app.deploymentType === 'CloudHub 2.0';
    const detailRes = isCh2
      ? await getCloudhub2AppDetail(app.bgId, app.envId, app.appId)
      : await getCloudhub1AppDetail(app.envId, app.appId, app.bgId);

    const { cpsBaseUrl, cpsKey, cpsEnv, cpsClientId } = extractCpsConfig(detailRes.data);
    if (!cpsBaseUrl) throw new Error('No CPS URL configured for this app');

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
    if (secureKeyStr) {
      try {
        const secureRaw = await fetchCpsProperties({ baseUrl: cpsBaseUrl, type: 'secure', keys: secureKeyStr, environment: cpsEnv, bgOrgId: app.bgId });
        const groups = Array.isArray(secureRaw?.responses) ? secureRaw.responses
          : Array.isArray(secureRaw?.properties) ? secureRaw.properties
          : Array.isArray(secureRaw) ? secureRaw : [];
        groups.forEach((g) => Object.assign(flatSecure, g.properties || {}));
      } catch { /* secure fetch failed — non-secure props still useful */ }
    }

    return { ...flatNs, ...flatSecure };
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
