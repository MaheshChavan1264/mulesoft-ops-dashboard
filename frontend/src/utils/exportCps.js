import {
  getCloudhub2AppDetail, getCloudhub1AppDetail, getPrivateSpaceDetail,
  getCloudhub2Schedulers, getCloudhub1StaticIps, getCloudhub1Schedules,
} from '../services/applicationsService';
import { postCpsCredentialsRaw, fetchCpsProperties } from '../services/cpsService';
import { extractCpsResponseEntries, flattenCpsResponse, normaliseCpsUrl } from './cpsHelpers';
import { rowsToWorksheet, writeWorkbook } from './xlsxExport';
import { getErrorMessage } from '../services/http';
import cronstrue from 'cronstrue';

const SECRET_PATTERNS = /password|secret|passwd|token|credential|\.key$|keypassword|keystorepassword|truststore\.password|ssl\.password|msk\.password/i;

function isSecretKey(k) {
  return SECRET_PATTERNS.test(k);
}

function decodeCron(expr) {
  if (!expr || typeof expr !== 'string' || expr.startsWith('${')) return '';
  try {
    return cronstrue.toString(expr, { throwExceptionOnParseError: true });
  } catch {
    return '';
  }
}

function maskSecrets(props) {
  const result = {};
  for (const [k, v] of Object.entries(props || {})) {
    result[k] = isSecretKey(k) ? '****' : v;
  }
  return result;
}

function propsToString(props) {
  return Object.entries(props || {})
    .map(([k, v]) => `${k}:${v}`)
    .join(',');
}

function extractHosts(props) {
  const hostKeys = ['https.host', 'http.host', 'host', 'hostname'];
  for (const k of hostKeys) {
    if (props[k]) return props[k];
  }
  return '';
}

function extractApiUsers(props) {
  const userPairs = [];
  for (const [k, v] of Object.entries(props || {})) {
    // Match keys that end in username/user/login/email with or without dot prefix
    if (/(^|\.)username$/i.test(k) || /(^|\.)user$/i.test(k) || /(^|\.)login$/i.test(k) || /(^|\.)email$/i.test(k)) {
      if (!isSecretKey(String(v))) userPairs.push(`${k}:${v}`);
    }
  }
  return userPairs.join(',');
}

function extractHostsSecure(props) {
  const hostPairs = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (typeof v !== 'string' || !v || isSecretKey(k)) continue;
    // Match host, endpoint, url, domain, servers, server, address
    if (/(^|\.)+(host|endpoint|url|domain|servers|server|address|bootstrap\.servers)$/i.test(k)) {
      hostPairs.push(`${k}:${v}`);
    }
  }
  return hostPairs.join(',');
}

/**
 * The exact ARM/runtime property keys Splunk integration uses in this org's
 * deployed apps (confirmed list — not inferred/pattern-guessed). Looked up
 * case-insensitively since ARM property casing can vary slightly between
 * deployments/teams.
 */
const SPLUNK_PROP_KEYS = {
  accessKeyId: 'splunk.aws.firehose.accessKeyId',
  bufferSize: 'splunk.aws.firehose.bufferSize',
  deliveryStream: 'splunk.aws.firehose.deliveryStream',
  maxPutRecordDelay: 'splunk.aws.firehose.maxPutRecordDelay',
  maxRetries: 'splunk.aws.firehose.maxRetries',
  region: 'splunk.aws.firehose.region',
  secretKey: 'splunk.aws.firehose.secretKey',
  index: 'splunk.index',
  indexTrace: 'splunk.index.trace',
};

/**
 * Extract the known Splunk ARM/runtime properties for one app — the exact
 * 9 keys in SPLUNK_PROP_KEYS above — plus a catch-all `other` map for any
 * additional `splunk.*` key that isn't one of those 9, so a deployment
 * using an unexpected/extra Splunk key still shows up somewhere instead of
 * being silently dropped.
 *
 * Unlike every other secret in this export, Splunk values are NEVER masked
 * here (not even accessKeyId/secretKey) — this sheet is meant to show
 * exactly what's configured in each app's ARM/runtime properties as-is.
 *
 * @param {Record<string, any>} allProps  merged ARM/runtime properties for one app
 * @returns {{
 *   accessKeyId: string, secretKey: string, deliveryStream: string,
 *   bufferSize: string, maxPutRecordDelay: string, maxRetries: string,
 *   region: string, index: string, indexTrace: string,
 *   other: Record<string,string>, hasAny: boolean
 * }}
 */
function extractSplunkProps(allProps) {
  const props = allProps || {};

  // Case-insensitive key lookup — ARM properties for the same logical key
  // can differ in case across deployments (same rationale as resolveProp()
  // elsewhere in this file).
  const lookup = (key) => {
    if (props[key] != null && props[key] !== '') return props[key];
    const lower = key.toLowerCase();
    for (const [k, v] of Object.entries(props)) {
      if (k.toLowerCase() === lower && v != null && v !== '') return v;
    }
    return '';
  };

  const raw = {};
  for (const [field, key] of Object.entries(SPLUNK_PROP_KEYS)) {
    raw[field] = lookup(key);
  }

  const knownKeysLower = new Set(Object.values(SPLUNK_PROP_KEYS).map((k) => k.toLowerCase()));
  const other = {};
  for (const [k, v] of Object.entries(props)) {
    if (!/splunk/i.test(k)) continue;
    if (knownKeysLower.has(k.toLowerCase())) continue; // already captured above
    if (v == null || v === '') continue;
    other[k] = String(v);
  }

  const hasAny = Object.values(raw).some((v) => v !== '' && v != null) || Object.keys(other).length > 0;

  return {
    accessKeyId: raw.accessKeyId !== '' ? String(raw.accessKeyId) : '',
    secretKey: raw.secretKey !== '' ? String(raw.secretKey) : '',
    deliveryStream: raw.deliveryStream !== '' ? String(raw.deliveryStream) : '',
    bufferSize: raw.bufferSize !== '' ? String(raw.bufferSize) : '',
    maxPutRecordDelay: raw.maxPutRecordDelay !== '' ? String(raw.maxPutRecordDelay) : '',
    maxRetries: raw.maxRetries !== '' ? String(raw.maxRetries) : '',
    region: raw.region !== '' ? String(raw.region) : '',
    index: raw.index !== '' ? String(raw.index) : '',
    indexTrace: raw.indexTrace !== '' ? String(raw.indexTrace) : '',
    other,
    hasAny,
  };
}


function normalisePropsArray(raw, appKey) {
  const arr = extractCpsResponseEntries(raw);
  if (arr) return arr;
  if (raw && typeof raw === 'object') {
    return [{ key: appKey, properties: raw }];
  }
  return [];
}

/**
 * Fetch CPS data for a single app.
 * Returns { nonSecure, secureGroups } or throws.
 */
const isMasked = (v) => !v || /^\*+$/.test(String(v).trim());

// ── Credential-POST mutex ──────────────────────────────────────────────────
// postCpsCredentialsRaw() writes into the backend's Express session (see
// backend/src/utils/cpsCredStore.js), and the session store does a full
// read-at-request-start / overwrite-whole-blob-at-request-end cycle with no
// merge (backend/src/utils/sqliteSessionStore.js `set()` — plain
// `INSERT ... ON CONFLICT DO UPDATE SET sess = excluded.sess`). Apps here are
// processed in parallel batches (see `batchSize` below), so without this
// queue two apps' concurrent `POST /cps/credentials` calls can race: both
// load the same session, write different `cpsCreds` keys in memory, and
// whichever response finishes last overwrites the stored row — silently
// discarding the other app's just-posted credential. That app's subsequent
// `GET /cps/fetch` then fails with "CPS credentials not configured" even
// though the right CPS URL and credentials were posted correctly moments
// earlier. Serializing the POST calls through this queue closes the race
// completely while every GET call (ARM detail, schedulers, CPS property
// fetches) stays fully parallel — only this cheap, infrequent write is
// single-filed.
let credPostQueue = Promise.resolve();
function postCredentialsSerialized(payload) {
  const run = credPostQueue.then(() => postCpsCredentialsRaw(payload));
  credPostQueue = run.catch(() => {});
  return run;
}

async function fetchAppCps(app, cpsBaseUrl, bgOrgId, cpsEnvOverride, getCredential, getAllCredentials, needsCpsFetch = true) {
  const isCh2 = app.deploymentType === 'CloudHub 2.0';
  const depType = isCh2 ? 'ch2' : 'ch1';

  // Step 1: Fetch full app details — get runtime properties AND schedulers in one call
  let runtimeProps = {};
  let schedulers = [];
  let staticIPList = [];
  // Use app-specific bgId if available (set when building apps from BG/Env selector)
  const effectiveBgOrgId = app._bgId || bgOrgId;
  try {
    const envId = app.environment?.id;
    if (isCh2) {
      const res = await getCloudhub2AppDetail(effectiveBgOrgId, envId, app.id);
      const cfg = res.data?.application?.configuration || {};
      const propsSvc = cfg['mule.agent.application.properties.service'] || {};
      const ds = res.data?.target?.deploymentSettings || {};
      runtimeProps = {
        ...propsSvc.properties,
        ...ds.properties,
        ...ds.environmentVariables,
        ...ds.environmentVars,
        ...res.data?.properties
      };
      // CH2 static IPs:
      // If deployed to a Private Space (targetId is a UUID), fetch outboundStaticIps from Private Spaces API.
      // Otherwise (Shared Space, targetId is a region name), fall back to replica list.
      const targetId = res.data?.target?.targetId || '';
      const isPrivateSpace = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(targetId);
      if (isPrivateSpace) {
        try {
          const psRes = await getPrivateSpaceDetail(effectiveBgOrgId, targetId);
          const outboundIPs = psRes.data?.network?.outboundStaticIps || [];
          if (Array.isArray(outboundIPs)) staticIPList = outboundIPs.filter(Boolean);
        } catch { /* not a private space or no access — fall through */ }
      }
      // Fallback: replica list (shared space or private space fetch failed)
      if (!staticIPList.length) {
        const replicaList = res.data?.replicas || [];
        staticIPList = replicaList.map(r => r.ipAddress || r.publicIpAddress).filter(Boolean);
      }
      // CH2 schedulers from dedicated endpoint — returns { items: [{flowName, type, expression, enabled}] }
      try {
        const schedRes = await getCloudhub2Schedulers(effectiveBgOrgId, envId, app.id);
        schedulers = schedRes.data?.items || schedRes.data?.schedulers || (Array.isArray(schedRes.data) ? schedRes.data : []);
      } catch { /* no schedulers */ }
    } else {
      const res = await getCloudhub1AppDetail(envId, app.id, effectiveBgOrgId);
      runtimeProps = res.data?.properties || {};
      // CH1 static IPs — try dedicated endpoint first
      try {
        const sipRes = await getCloudhub1StaticIps(envId, app.id, effectiveBgOrgId);
        const sipArr = Array.isArray(sipRes.data) ? sipRes.data
          : (sipRes.data?.staticIps || sipRes.data?.staticIPs || sipRes.data?.items || []);
        staticIPList = sipArr.map(s => typeof s === 'string' ? s : (s.ipAddress || s.staticIPAddress || s.address || s.ip)).filter(Boolean);
      } catch { /* 404 or other — will check inline fields below */ }
      // Fallback: inline fields on the main app detail response
      // (this is what the Application Detail Page uses when /static-ips returns 404)
      if (!staticIPList.length) {
        const rawIPs = res.data?.staticIPs || res.data?.staticIps || res.data?.staticIPAddresses || res.data?.ipAddresses || [];
        if (Array.isArray(rawIPs)) staticIPList = rawIPs.map(s => typeof s === 'string' ? s : (s.ipAddress || s.address || s.ip)).filter(Boolean);
      }
      // CH1 schedulers from dedicated endpoint
      try {
        const schedRes = await getCloudhub1Schedules(envId, app.id, effectiveBgOrgId);
        schedulers = Array.isArray(schedRes.data) ? schedRes.data : (schedRes.data?.schedules || []);
      } catch { /* no schedulers */ }
    }
  } catch { /* fall back to summary data */ }

  const allProps = { ...runtimeProps, ...(app.runtimeProps || {}), ...(app.properties || {}) };

  // Sheets like Splunk Details / Schedule Catalog / Static IPs Catalog are
  // sourced entirely from the ARM/Runtime Manager calls above — when none of
  // the selected sheets need actual CPS property values, skip the CPS
  // credential posting and property fetches below entirely.
  if (!needsCpsFetch) {
    return { flatNs: {}, secureGroups: [], cpsEnv: '', cpsKey: '', schedulers, allProps, staticIPList };
  }

  // CPS URL and env always come from the app's own ARM runtime properties.
  // The modal's URL/env fields are NOT used — they are for display only.
  const cpsEnv = allProps['cps.prefix'] || allProps['cps.environment'] || 'prod';
  // cps.projectName is the authoritative CPS key — NOT the app name or app.id
  const cpsKey = allProps['cps.projectName'] || allProps['cloudhub.api.name'] || app.name;

  // Everything below this point talks to the CPS config server, which is a
  // separate, independently-flaky dependency from the ARM/Runtime Manager
  // calls above. A failure here (missing CPS URL, unreachable server, empty
  // response, etc.) must NOT discard the ARM/runtime data already fetched —
  // schedulers, static IPs and allProps (which is what the Splunk Details
  // sheet reads from) are gathered above and are independently valid even
  // when CPS itself fails. So this whole block is wrapped and, on failure,
  // we return normally with `cpsError` set instead of throwing — the caller
  // uses `cpsError` to blank only the CPS-backed sheets (AllPropertiesCatalog /
  // Host_APIUsersCatalog), leaving ScheduleCatalog / StaticIPsCatalog /
  // SplunkDetails populated from the already-fetched ARM data.
  try {
    const effectiveCpsBaseUrl = allProps['cps.configServerBaseUrl'] || allProps['config.server.base.url'];
    if (!effectiveCpsBaseUrl) throw new Error(`No CPS URL in runtime properties for "${app.name}"`);

    const normUrl = normaliseCpsUrl(effectiveCpsBaseUrl);

    // ── Per-app credential resolution ────────────────────────────────────────
    // Strategy 1: get the specific cps.clientId from ARM props → look up secret in CSV
    // Strategy 2 (fallback): masked / not in CSV → post all CSV creds as url::clientId entries
    const cpsClientId = allProps['cps.clientId'] || allProps['cps.client_id'] ||
                        allProps['cps.client.id'] || allProps['cps.apiClientId'] || '';

    // Post every loaded CSV credential pair as a `${normUrl}::${clientId}` fallback
    // entry — shared by both the "specific clientId not in CSV" and the
    // "clientId masked/absent" branches below (previously duplicated verbatim).
    const postAllCredentialsFallback = async () => {
      if (!getAllCredentials) return;
      const allCreds = getAllCredentials();
      if (!allCreds.length) return;
      const credMap = {};
      for (const { clientId, clientSecret } of allCreds) credMap[`${normUrl}::${clientId}`] = { clientId, clientSecret };
      try { await postCredentialsSerialized({ credentials: credMap }); } catch { /* non-fatal */ }
    };

    if (cpsClientId && !isMasked(cpsClientId) && getCredential) {
      const secret = getCredential(cpsClientId);
      if (secret) {
        const credMap = {
          [`${normUrl}::${effectiveBgOrgId}`]: { clientId: cpsClientId, clientSecret: secret },
          [normUrl]: { clientId: cpsClientId, clientSecret: secret },
        };
        if (getAllCredentials) {
          const allCreds = getAllCredentials();
          for (const { clientId, clientSecret } of allCreds) {
            if (clientId !== cpsClientId) {
              credMap[`${normUrl}::${clientId}`] = { clientId, clientSecret };
            }
          }
        }
        try { await postCredentialsSerialized({ credentials: credMap }); } catch { /* non-fatal */ }
      } else {
        // Specific clientId not in CSV — fall back to all credentials
        await postAllCredentialsFallback();
      }
    } else {
      // clientId is masked or absent — post all as url::clientId fallback entries
      await postAllCredentialsFallback();
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Fetch non-secure — throw on error so the caller can record it in the export
    const nsRaw = await fetchCpsProperties({
      baseUrl: normUrl, type: 'non-secure', environment: cpsEnv,
      keys: cpsKey, deploymentType: depType, bgOrgId: effectiveBgOrgId
    });

    const flatNs = flattenCpsResponse(nsRaw, cpsKey);

    // If flatNs is empty, the response structure is unexpected — store raw response for debugging
    if (Object.keys(flatNs).length === 0) {
      throw new Error(`Empty properties for "${cpsKey}". Raw response: ${JSON.stringify(nsRaw).substring(0, 300)}`);
    }

    const secureKeyStr = flatNs['cps.secure.properties'] || '';
    const secureKeys = secureKeyStr.split(',').map(s => s.trim()).filter(Boolean);

    // Fetch secure groups
    const secureGroups = [];
    if (secureKeys.length > 0) {
      try {
        const raw = await fetchCpsProperties({
          baseUrl: normUrl, type: 'secure', environment: cpsEnv,
          keys: secureKeyStr, deploymentType: depType, bgOrgId: effectiveBgOrgId
        });
        const arr = normalisePropsArray(raw, secureKeys[0]);
        for (const entry of arr) {
          secureGroups.push({ key: entry.key, properties: entry.properties || {} });
        }
      } catch { /* secure fetch failed */ }
    }

    return { flatNs, secureGroups, cpsEnv, cpsKey, schedulers, allProps, staticIPList };
  } catch (cpsError) {
    return { flatNs: {}, secureGroups: [], cpsEnv, cpsKey, schedulers, allProps, staticIPList, cpsError };
  }
}

// ── Row builder (shared between sequential and batch paths) ─────────────
function buildRows(app, fetchResult, allPropsRows, hostApiRows, scheduleRows, staticIPsRows, splunkRows) {
  const { flatNs, secureGroups, schedulers: fetchedSchedulers, allProps: fetchedAllProps, staticIPList: fetchedStaticIPs, cpsError } = fetchResult;
  // cpsError means the CPS config-server calls failed for this app (bad/missing
  // CPS URL, unreachable server, empty response, etc.) — see fetchAppCps().
  // The ARM-sourced sheets below are unaffected; only the CPS-backed columns
  // (allPropsRows.properties / hostApiRows.notAccessible) show the failure.
  const cpsErrorMsg = cpsError ? `ERROR: ${getErrorMessage(cpsError)}` : '';
  const staticIPsEnabled = app.staticIPsEnabled != null ? (app.staticIPsEnabled ? 'Yes' : 'No') : '—';
  const staticIPs = fetchedStaticIPs?.length > 0 ? fetchedStaticIPs.join(', ') : '—';
  const cloudhubVersion = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
  const appStatus = app.status || '—';
  const hostsNonSecure = extractHosts(flatNs);

  const flatSecure = {};
  for (const g of secureGroups) Object.assign(flatSecure, g.properties || {});

  const resolveProp = (val) => {
    if (!val) return val;
    // Mirror InfrastructureTab.jsx's resolution exactly: a global replace
    // (handles placeholders embedded in a larger string, not just a value
    // that IS a placeholder) with a case-insensitive fallback — real CPS
    // property keys can differ in case from the `${...}` reference used in
    // the deployed app's scheduler config, so an exact-case-only lookup
    // silently leaves the raw placeholder in the export.
    return String(val).replace(/\$\{([^}]+)\}/g, (match, propName) =>
      flatNs[propName] ||
      flatNs[propName.toLowerCase()] ||
      flatSecure[propName] ||
      flatSecure[propName.toLowerCase()] ||
      (fetchedAllProps && (fetchedAllProps[propName] || fetchedAllProps[propName.toLowerCase()])) ||
      match
    );
  };

  const schedEnv = app._envName || app.environment?.name || '—';
  for (const s of (fetchedSchedulers || [])) {
    const innerSchedulers = Array.isArray(s.schedulers) ? s.schedulers : [];
    const cronSched = innerSchedulers.find(x => /cron/i.test(x.type || '')) || innerSchedulers[0];
    const fixedSched = innerSchedulers.find(x => /fixed/i.test(x.type || '')) || null;
    const rawCron = cronSched?.expression || s.schedule?.cronExpression || s.schedule?.expression || s.cronExpression || s.expression || s.schedulerConfig?.cronExpression || s.schedulerConfig?.expression || '';
    const rawPeriod = fixedSched?.period || fixedSched?.frequency || s.schedule?.period || s.schedule?.frequency || s.frequency || s.period || '';
    const rawTimeUnit = fixedSched?.timeUnit || s.schedule?.timeUnit || s.timeUnit || '';
    const rawTimeZone = cronSched?.timeZone || s.schedule?.timeZone || s.timeZone || '';
    const resolvedCron = resolveProp(rawCron);
    scheduleRows.push({
      environment: schedEnv,
      apiDomainName: app.name,
      scheduleName: s.flow || s.flowName || s.name || s.schedulerName || '',
      enabled: s.enabled !== false ? 'true' : 'false',
      scheduleCronExpression: resolvedCron,
      decodedCronExpression: decodeCron(resolvedCron),
      scheduleTimeZone: resolveProp(rawTimeZone),
      scheduleTimeUnit: resolveProp(rawTimeUnit),
      schedulePeriod: String(resolveProp(String(rawPeriod)))
    });
  }

  const environment = app._envName || app.environment?.name || '—';

  // Splunk AWS Firehose access key — sourced from ARM runtime properties (not CPS)
  const splunkAccessKeyId = fetchedAllProps?.['splunk.aws.firehose.accessKeyId'] || '';

  if (secureGroups.length === 0) {
    allPropsRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: flatNs['cps.secure.properties'] || '', properties: cpsErrorMsg, splunkAccessKeyId });
    hostApiRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: flatNs['cps.secure.properties'] || '', hostsSecure: '', apiUsers: '', notAccessible: cpsErrorMsg });
  } else {
    for (const group of secureGroups) {
      const maskedSec = maskSecrets(group.properties);
      allPropsRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: group.key, properties: propsToString(maskedSec), splunkAccessKeyId });
      hostApiRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure, cpsSecureKey: group.key, hostsSecure: extractHostsSecure(group.properties), apiUsers: extractApiUsers(group.properties), notAccessible: '' });
    }
  }
  // One row per app in the dedicated StaticIPs sheet
  if (staticIPsRows) {
    staticIPsRows.push({
      apiName: app.name,
      environment: app._envName || app.environment?.name || '—',
      cloudhubVersion,
      appStatus,
      staticIPsEnabled,
      staticIPs,
    });
  }

  // One row per app in the dedicated Splunk Details sheet — scanned from the
  // same ARM/runtime properties already fetched for the catalogs above
  // (no extra network call). See extractSplunkProps() for the exact 9
  // property keys read; `otherSplunkProperties` catches any additional
  // splunk.* key outside that known set.
  if (splunkRows) {
    const sp = extractSplunkProps(fetchedAllProps);
    splunkRows.push({
      environment,
      apiName: app.name,
      cloudhubVersion,
      appStatus,
      splunkConfigured: sp.hasAny ? 'Yes' : 'No',
      accessKeyId: sp.accessKeyId,
      secretKey: sp.secretKey,
      deliveryStream: sp.deliveryStream,
      bufferSize: sp.bufferSize,
      maxPutRecordDelay: sp.maxPutRecordDelay,
      maxRetries: sp.maxRetries,
      region: sp.region,
      index: sp.index,
      indexTrace: sp.indexTrace,
      otherSplunkProperties: propsToString(sp.other),
    });
  }
}

function buildErrorRow(app, e, allPropsRows, hostApiRows, splunkRows) {
  const environment = app._envName || app.environment?.name || '—';
  const cloudhubVersion = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
  const appStatus = app.status || '—';
  const msg = `ERROR: ${getErrorMessage(e)}`;
  allPropsRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure: '', cpsSecureKey: '', properties: msg, splunkAccessKeyId: '' });
  hostApiRows.push({ environment, apiName: app.name, cloudhubVersion, appStatus, hostsNonSecure: '', cpsSecureKey: '', hostsSecure: '', apiUsers: '', notAccessible: msg });
  if (splunkRows) {
    splunkRows.push({
      environment, apiName: app.name, cloudhubVersion, appStatus, splunkConfigured: '—',
      accessKeyId: '', secretKey: '', deliveryStream: '', bufferSize: '', maxPutRecordDelay: '',
      maxRetries: '', region: '', index: '', indexTrace: '',
      otherSplunkProperties: msg,
    });
  }
}

/**
 * Canonical list of exportable sheets, shared with the UI (CpsExportModal)
 * so the sheet-selection checkboxes and the actual export logic can never
 * drift out of sync with each other. `id` is also the sheet name written
 * to the workbook.
 */
export const CPS_EXPORT_SHEETS = [
  { id: 'AllPropertiesCatalog', label: 'All Properties Catalog' },
  { id: 'Host_APIUsersCatalog', label: 'Host / API Users Catalog' },
  { id: 'ScheduleCatalog', label: 'Schedule Catalog' },
  { id: 'StaticIPsCatalog', label: 'Static IPs Catalog' },
  { id: 'SplunkDetails', label: 'Splunk Details' },
];
const DEFAULT_SHEET_IDS = CPS_EXPORT_SHEETS.map((s) => s.id);

/**
 * Main export function — processes apps in parallel batches for speed.
 * @param {Array}    apps             - list of apps from /applications/summary
 * @param {string}   bgOrgId          - selected BG org ID
 * @param {string}   cpsBaseUrl       - CPS server base URL override (per-app URL takes priority)
 * @param {string}   cpsEnvOverride   - CPS environment override (per-app cps.prefix takes priority)
 * @param {Function} onProgress       - callback(current, total, label)
 * @param {Function} getCredential    - (clientId) => secret | null
 * @param {Function} getAllCredentials - () => [{clientId, clientSecret}]
 * @param {number}   batchSize        - parallel concurrency per batch (default 10)
 * @param {string[]} sheetIds         - which sheets to include in the output workbook
 *                                      (ids from CPS_EXPORT_SHEETS) — defaults to all of them.
 *                                      ARM-only sheets (ScheduleCatalog, StaticIPsCatalog,
 *                                      SplunkDetails) are always built from the ARM/Runtime
 *                                      Manager calls regardless of this filter. CPS-backed
 *                                      sheets (AllPropertiesCatalog, Host_APIUsersCatalog)
 *                                      additionally require CPS credential posting + property
 *                                      fetches — those calls are skipped entirely when neither
 *                                      of those two sheets is selected, so an export limited to
 *                                      e.g. just "Splunk Details" only hits ARM, never CPS.
 */
export async function exportCpsProperties({ apps, bgOrgId, bgName, envName, cpsBaseUrl, cpsEnvOverride, onProgress, getCredential, getAllCredentials, batchSize = 10, sheetIds = DEFAULT_SHEET_IDS }) {
  const allPropsRows = [];
  const hostApiRows = [];
  const scheduleRows = [];
  const staticIPsRows = [];
  const splunkRows = [];

  // AllPropertiesCatalog / Host_APIUsersCatalog are the only sheets that need
  // actual CPS property values (secure + non-secure). ScheduleCatalog,
  // StaticIPsCatalog and SplunkDetails are built entirely from ARM/Runtime
  // Manager data already fetched per-app — when only those are selected,
  // skip the CPS credential posting + property fetch calls entirely.
  const selectedIds = new Set(sheetIds?.length ? sheetIds : DEFAULT_SHEET_IDS);
  const needsCpsFetch = selectedIds.has('AllPropertiesCatalog') || selectedIds.has('Host_APIUsersCatalog');

  const total = apps.length;
  const totalBatches = Math.ceil(total / batchSize);

  // ── Parallel batch processing ──────────────────────────────────────────
  // Pre-allocate results array to preserve original app order after batches run in parallel
  const results = new Array(total);
  let done = 0;

  for (let i = 0; i < total; i += batchSize) {
    const batchApps = apps.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;

    const settled = await Promise.allSettled(
      batchApps.map(app => fetchAppCps(app, cpsBaseUrl, bgOrgId, cpsEnvOverride, getCredential, getAllCredentials, needsCpsFetch))
    );

    settled.forEach((outcome, j) => {
      results[i + j] = { app: batchApps[j], outcome };
      done++;
    });

    onProgress?.(done, total, `Batch ${batchNum}/${totalBatches} complete (${done}/${total} apps)`);
  }
  // ── Build rows in original order ───────────────────────────────────────

  for (const { app, outcome } of results) {
    if (!app) continue;
    if (outcome.status === 'fulfilled') {
      try {
        buildRows(app, outcome.value, allPropsRows, hostApiRows, scheduleRows, staticIPsRows, splunkRows);
      } catch (e) {
        buildErrorRow(app, e, allPropsRows, hostApiRows, splunkRows);
        const siEnabled = app.staticIPsEnabled != null ? (app.staticIPsEnabled ? 'Yes' : 'No') : '—';
        const siVer = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
        staticIPsRows.push({ apiName: app.name, environment: app._envName || app.environment?.name || '—', cloudhubVersion: siVer, appStatus: app.status || '—', staticIPsEnabled: siEnabled, staticIPs: '—' });
      }
    } else {
      buildErrorRow(app, outcome.reason, allPropsRows, hostApiRows, splunkRows);
      const siEnabled = app.staticIPsEnabled != null ? (app.staticIPsEnabled ? 'Yes' : 'No') : '—';
      const siVer = app.deploymentType === 'CloudHub 2.0' ? 'CloudHub 2.0' : 'CloudHub 1.0';
      staticIPsRows.push({ apiName: app.name, environment: app._envName || app.environment?.name || '—', cloudhubVersion: siVer, appStatus: app.status || '—', staticIPsEnabled: siEnabled, staticIPs: '—' });
    }
  }

  // ── Export as Excel (.xlsx) — only the sheets selected via `sheetIds` ──
  const selected = selectedIds;
  const allSheets = [
    {
      id: 'AllPropertiesCatalog',
      worksheet: rowsToWorksheet(allPropsRows, {
        headers: ['environment', 'apiName', 'cloudhubVersion', 'splunkAccessKeyId', 'appStatus', 'hostsNonSecure', 'cpsSecureKey', 'properties'],
        colWidths: undefined,
      }),
    },
    {
      id: 'Host_APIUsersCatalog',
      worksheet: rowsToWorksheet(hostApiRows, {
        headers: ['environment', 'apiName', 'cloudhubVersion', 'appStatus', 'hostsNonSecure', 'cpsSecureKey', 'hostsSecure', 'apiUsers', 'notAccessible'],
        colWidths: undefined,
      }),
    },
    {
      id: 'ScheduleCatalog',
      worksheet: rowsToWorksheet(scheduleRows, {
        headers: ['environment', 'apiDomainName', 'scheduleName', 'enabled', 'scheduleCronExpression', 'decodedCronExpression', 'scheduleTimeZone', 'scheduleTimeUnit', 'schedulePeriod'],
        colWidths: undefined,
      }),
    },
    {
      id: 'StaticIPsCatalog',
      worksheet: rowsToWorksheet(staticIPsRows, {
        headers: ['apiName', 'environment', 'cloudhubVersion', 'appStatus', 'staticIPsEnabled', 'staticIPs'],
        colWidths: undefined,
      }),
    },
    {
      id: 'SplunkDetails',
      worksheet: rowsToWorksheet(splunkRows, {
        headers: ['environment', 'apiName', 'cloudhubVersion', 'appStatus', 'splunkConfigured', 'accessKeyId', 'secretKey', 'deliveryStream', 'bufferSize', 'maxPutRecordDelay', 'maxRetries', 'region', 'index', 'indexTrace', 'otherSplunkProperties'],
        colWidths: undefined,
      }),
    },
  ];
  const sheets = allSheets
    .filter((s) => selected.has(s.id))
    .map((s) => ({ name: s.id, worksheet: s.worksheet }));

  const date = new Date().toISOString().split('T')[0];
  const safeName = (s) => (s || '').replace(/[^a-zA-Z0-9-_]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const envPart = safeName(envName);
  const filename = ['CPS-Properties', envPart, date].filter(Boolean).join('-') + '.xlsx';
  writeWorkbook(sheets, filename);
}
