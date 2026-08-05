import * as XLSX from 'xlsx';
import api from '../services/api';

const SECRET_PATTERNS = /password|secret|passwd|token|credential|\.key$|keypassword|keystorepassword|truststore\.password|ssl\.password|msk\.password/i;

function isSecretKey(k) {
  return SECRET_PATTERNS.test(k);
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
    if (/\.(username|user|login|email)$/i.test(k) && !isSecretKey(v)) {
      userPairs.push(`${k}:${v}`);
    }
  }
  return userPairs.join(',');
}

function extractHostsSecure(props) {
  const hostPairs = [];
  for (const [k, v] of Object.entries(props || {})) {
    if (/\.(host|endpoint|url|domain)$/i.test(k) && typeof v === 'string' && !isSecretKey(v)) {
      hostPairs.push(`${k}:${v}`);
    }
  }
  return hostPairs.join(',');
}

function normalisePropsArray(raw, appKey) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.responses)) return raw.responses;
  if (Array.isArray(raw?.properties)) {
    // Could be wrapper or flat array of entries
    return raw.properties.every(p => p.key) ? raw.properties : [{ key: appKey, properties: raw.properties }];
  }
  if (raw && typeof raw === 'object') {
    return [{ key: appKey, properties: raw }];
  }
  return [];
}

/**
 * Fetch CPS data for a single app.
 * Returns { nonSecure, secureGroups } or throws.
 */
async function fetchAppCps(app, cpsBaseUrl, bgOrgId, cpsEnvOverride) {
  const isCh2 = app.deploymentType === 'CloudHub 2.0';
  const depType = isCh2 ? 'ch2' : 'ch1';

  // Step 1: Fetch full app details from Anypoint to get runtime properties (cps.projectName, cps.prefix)
  let runtimeProps = {};
  try {
    const envId = app.environment?.id;
    if (isCh2) {
      const res = await api.get(`/applications/cloudhub2/${bgOrgId}/${envId}/${app.id}`);
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
    } else {
      const res = await api.get(`/applications/cloudhub1/${envId}/${app.id}`, { params: { orgId: bgOrgId } });
      runtimeProps = res.data?.properties || {};
    }
  } catch { /* fall back to summary data */ }

  const allProps = { ...runtimeProps, ...(app.runtimeProps || {}), ...(app.properties || {}) };

  // Use env override from modal first, then runtime props (cps.prefix), then fallback
  const cpsEnv = cpsEnvOverride || allProps['cps.prefix'] || allProps['cps.environment'] || 'prod';
  // cps.projectName is the authoritative CPS key — NOT the app name or app.id
  const cpsKey = allProps['cps.projectName'] || allProps['cloudhub.api.name'] || app.name;

  // Fetch non-secure — throw on error so the caller can record it in the export
  const nsRes = await api.get('/cps/fetch', { params: {
    baseUrl: cpsBaseUrl, type: 'non-secure', environment: cpsEnv,
    keys: cpsKey, deploymentType: depType, bgOrgId
  }});
  const nsRaw = nsRes.data;

  // Debug: log raw response to console
  console.log(`[CPS Export] app="${app.name}" key="${cpsKey}" env="${cpsEnv}" rawResponse:`, JSON.stringify(nsRaw).substring(0, 500));

  const arr = normalisePropsArray(nsRaw, cpsKey);
  const match = arr.find(p => p.key === cpsKey) || arr[0];
  const inner = match?.properties || match;
  let flatNs = (inner && typeof inner === 'object' && !Array.isArray(inner)) ? inner : {};

  // If flatNs is still empty, the response structure is unexpected — store raw response for debugging
  if (Object.keys(flatNs).length === 0) {
    throw new Error(`Empty properties for "${cpsKey}". Raw response: ${JSON.stringify(nsRaw).substring(0, 300)}`);
  }

  const secureKeyStr = flatNs['cps.secure.properties'] || '';
  const secureKeys = secureKeyStr.split(',').map(s => s.trim()).filter(Boolean);

  // Fetch secure groups
  const secureGroups = [];
  if (secureKeys.length > 0) {
    try {
      const sr = await api.get('/cps/fetch', { params: {
        baseUrl: cpsBaseUrl, type: 'secure', environment: cpsEnv,
        keys: secureKeyStr, deploymentType: depType, bgOrgId
      }});
      const raw = sr.data;
      const arr = normalisePropsArray(raw, secureKeys[0]);
      for (const entry of arr) {
        secureGroups.push({ key: entry.key, properties: entry.properties || {} });
      }
    } catch { /* secure fetch failed */ }
  }

  return { flatNs, secureGroups, cpsEnv, cpsKey };
}

/**
 * Main export function.
 * @param {Array} apps - list of apps from /applications/summary
 * @param {string} bgOrgId - selected BG org ID
 * @param {string} cpsBaseUrl - CPS server base URL (user-specified in modal)
 * @param {string} cpsEnvOverride - CPS environment override (e.g. 'prod', 'uat')
 * @param {Function} onProgress - callback(current, total, appName)
 * @param {Function} onComplete - callback()
 * @param {Function} onError - callback(msg)
 */
export async function exportCpsProperties({ apps, bgOrgId, cpsBaseUrl, cpsEnvOverride, onProgress, onComplete, onError }) {
  const allPropsRows = [];
  const hostApiRows = [];
  const scheduleRows = [];

  // Process all apps — use the user-specified CPS base URL
  const total = apps.length;

  for (let i = 0; i < apps.length; i++) {
    const app = apps[i];

    onProgress?.(i + 1, total, app.name);

    try {
      const { flatNs, secureGroups } = await fetchAppCps(app, cpsBaseUrl, bgOrgId, cpsEnvOverride);
      const maskedNs = maskSecrets(flatNs);
      const hostsNonSecure = extractHosts(flatNs);

      if (secureGroups.length === 0) {
        // No secure groups — one row with empty cpsSecureKey and empty properties
        allPropsRows.push({
          apiName: app.name,
          hostsNonSecure,
          cpsSecureKey: flatNs['cps.secure.properties'] || '',
          properties: ''
        });
        hostApiRows.push({
          apiName: app.name,
          hostsNonSecure,
          cpsSecureKey: flatNs['cps.secure.properties'] || '',
          hostsSecure: '',
          apiUsers: '',
          notAccessible: ''
        });
      } else {
        // One row per secure group — properties column = ONLY that secure key's properties
        for (const group of secureGroups) {
          const maskedSec = maskSecrets(group.properties);
          allPropsRows.push({
            apiName: app.name,
            hostsNonSecure,
            cpsSecureKey: group.key,
            properties: propsToString(maskedSec)  // only this secure group's props
          });
          hostApiRows.push({
            apiName: app.name,
            hostsNonSecure,
            cpsSecureKey: group.key,
            hostsSecure: extractHostsSecure(group.properties),
            apiUsers: extractApiUsers(group.properties),
            notAccessible: ''
          });
        }
      }
    } catch (e) {
      // App failed — add a placeholder row
      allPropsRows.push({
        apiName: app.name,
        hostsNonSecure: '',
        cpsSecureKey: '',
        properties: `ERROR: ${e.response?.data?.error || e.message}`
      });
      hostApiRows.push({
        apiName: app.name,
        hostsNonSecure: '',
        cpsSecureKey: '',
        hostsSecure: '',
        apiUsers: '',
        notAccessible: `ERROR: ${e.response?.data?.error || e.message}`
      });
    }

    // Add scheduler rows (from app summary data which already has schedulers)
    const schedulers = app.schedulers || [];
    for (const s of schedulers) {
      scheduleRows.push({
        apiDomainName: app.name,
        scheduleName: s.flow || s.flowName || s.name || '',
        enabled: s.enabled !== false ? 'true' : 'false',
        scheduleCronExpression: s.schedule?.cronExpression || s.expression || s.cronExpression || '',
        scheduleTimeZone: s.schedule?.timeZone || s.timeZone || '',
        scheduleTimeUnit: s.timeUnit || s.schedule?.timeUnit || '',
        schedulePeriod: String(s.frequency || s.schedule?.period || '')
      });
    }
  }

  // Build XLSX workbook
  const wb = XLSX.utils.book_new();

  // Sheet 1: AllPropertiesCatalog
  const ws1 = XLSX.utils.json_to_sheet(allPropsRows, {
    header: ['apiName', 'hostsNonSecure', 'cpsSecureKey', 'properties']
  });
  XLSX.utils.book_append_sheet(wb, ws1, 'AllPropertiesCatalog');

  // Sheet 2: Host_APIUsersCatalog
  const ws2 = XLSX.utils.json_to_sheet(hostApiRows, {
    header: ['apiName', 'hostsNonSecure', 'cpsSecureKey', 'hostsSecure', 'apiUsers', 'notAccessible']
  });
  XLSX.utils.book_append_sheet(wb, ws2, 'Host_APIUsersCatalog');

  // Sheet 3: ScheduleCatalog
  const ws3 = XLSX.utils.json_to_sheet(scheduleRows, {
    header: ['apiDomainName', 'scheduleName', 'enabled', 'scheduleCronExpression', 'scheduleTimeZone', 'scheduleTimeUnit', 'schedulePeriod']
  });
  XLSX.utils.book_append_sheet(wb, ws3, 'ScheduleCatalog');

  // Download
  const date = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `CPS-Properties-Export-${date}.xlsx`);
  onComplete?.();
}