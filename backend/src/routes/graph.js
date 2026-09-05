const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('../utils/anypointClient');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

const CACHE_TTL_MS = 2 * 60 * 1000;
const graphCache = new Map();

function getCached(orgId, envId) {
  const key = `${orgId}:${envId}`;
  const entry = graphCache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data;
  graphCache.delete(key);
  return null;
}
function setCache(orgId, envId, data) {
  graphCache.set(`${orgId}:${envId}`, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

function normaliseName(name) {
  return (name || '').toLowerCase().trim()
    .replace(/[-_](dev|sit|uat|prod|sandbox|staging|qa|test|local|hotfix|release)$/i, '')
    .replace(/-v?\d+(\.\d+)*$/, '')
    .replace(/[-_\s]+$/, '');
}

function normaliseUrl(url = '') {
  return url.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
}

function extractArmProps(detail) {
  const ds = detail?.target?.deploymentSettings || {};
  const appCfg = detail?.application?.configuration || {};
  const ps = appCfg['mule.agent.application.properties.service'] || {};
  return {
    ...(detail?.properties || {}),
    ...(ps.properties || {}),
    ...(ds.runtimeProperties || {}),
    ...(ds.properties || {}),
    ...(ds.environmentVariables || ds.environmentVars || {}),
  };
}

function flattenCpsProps(data) {
  if (!data) return {};
  const flat = {};
  const arr = Array.isArray(data?.responses) ? data.responses : Array.isArray(data) ? data : null;
  if (arr) {
    arr.forEach(entry => {
      const inner = entry?.properties;
      if (inner && typeof inner === 'object' && !Array.isArray(inner)) Object.assign(flat, inner);
    });
  } else if (data && typeof data === 'object') {
    const first = Object.values(data)[0];
    if (first && typeof first === 'object') Object.assign(flat, first);
    else Object.assign(flat, data);
  }
  return flat;
}

function getSessionCpsCred(session, rawBaseUrl, bgOrgId) {
  const creds = session.cpsCreds || {};
  const norm = normaliseUrl(rawBaseUrl);
  if (bgOrgId) {
    const c = creds[`${norm}::${bgOrgId}`];
    if (c?.clientId && c?.clientSecret) return c;
  }
  const byUrl = creds[norm];
  if (byUrl?.clientId && byUrl?.clientSecret) return byUrl;
  const fallback = Object.entries(creds).find(([k, v]) =>
    k.startsWith(`${norm}::`) && v?.clientId && v?.clientSecret
  );
  if (fallback) return fallback[1];
  // Last resort: graph-scan bulk credentials posted by ApiGraphPage
  const graphScan = Object.entries(creds).find(([k, v]) =>
    k.startsWith('graph-scan::') && v?.clientId && v?.clientSecret
  );
  return graphScan ? graphScan[1] : null;
}

function extractHostname(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) {
    try { return new URL(v).hostname || null; } catch { return null; }
  }
  if (/^[a-z0-9-]+\.[a-z0-9.\-]+(:\d+)?(\/.*)?$/i.test(v)) {
    return v.split('/')[0].split(':')[0];
  }
  return null;
}

function matchHostnameToApp(hostname, appByNorm) {
  if (!hostname) return null;
  const sub = hostname.split('.')[0];
  const norm = normaliseName(sub);
  if (!norm || norm.length < 3) return null;
  if (appByNorm[norm]) return appByNorm[norm];
  for (const [key, app] of Object.entries(appByNorm)) {
    if (key.length < 4) continue;
    if (norm === key || norm.startsWith(key) || key.startsWith(norm)) return app;
  }
  return null;
}

// Property key patterns indicating infrastructure (not API connections)
const INFRA_KEY_PATTERNS = /password|secret|\.jks|truststore|keystore|bootstrap\.servers|\.pgp\.|ssl\.|\.db\.|msk\.|zookeeper|\.kafka\.|\.alias$|\.path$|\.type$/i;

// Property key patterns indicating a URL/endpoint value
const URL_KEY_PATTERNS = /\.(url|base[_.\-]?url|uri|host|endpoint|address|server|location|baseuri|baseurl|apiurl|service[_.\-]?url)$/i;

/**
 * Check if a secure group contains meaningful API connection info
 * (at least one host/URL value that isn't pure infrastructure).
 */
function isApiConnectionGroup(groupKey, properties) {
  // Skip groups that are clearly infrastructure-only
  if (/^(https?-jks|jks-tls|pgp-cred|db-cred|kafka-cred|truststore|keystore|msk-cred|ssl-cred|binaries)/i.test(groupKey)) {
    return false;
  }
  return Object.entries(properties || {}).some(([k, v]) => {
    if (INFRA_KEY_PATTERNS.test(k)) return false;
    return extractHostname(String(v || '')) !== null;
  });
}

/**
 * Helper: ensure a source app node exists in the map.
 */
function ensureSourceNode(map, srcId, app) {
  if (!map.has(srcId)) {
    map.set(srcId, {
      id: srcId,
      label: app.name || app.domain || String(app.id),
      type: 'app',
      status: app.status || app.desiredStatus || 'UNKNOWN',
      deploymentType: app._type,
      meta: { appId: app.id || app.domain, deploymentType: app._type, status: app.status || 'UNKNOWN' },
    });
  }
}

// ── GET /api/graph/dependencies ───────────────────────────────────────────────
// CPS-based service dependency graph.
//
// Discovery strategy (in priority order):
//   1. Secure group KEY name → matches deployed app name
//      e.g. "sapi-coupa-lookup-commons" → "sapi-coupa-lookup" → matches "sapi-coupa-lookup-v2-uw2-ut"
//   2. Secure group property VALUES containing host/URL → match to deployed app or external
//   3. Non-secure property VALUES containing host/URL → same matching
//
// Requires CPS credentials posted via POST /api/cps/credentials (done by ApiGraphPage).
router.get('/dependencies', async (req, res) => {
  const { orgId, envId, noCache } = req.query;
  const client = createClient(req.session.token);

  if (!orgId || !envId) {
    return res.status(400).json({ error: 'orgId and envId are required' });
  }

  if (noCache !== 'true') {
    const cached = getCached(orgId, envId);
    if (cached) return res.json({ ...cached, cached: true });
  }

  const debug = { ch2Apps: 0, ch1Apps: 0, cpsConfigFound: 0, cpsUrlsFound: 0, secureGroupsScanned: 0, edges: 0, errors: [] };

  try {
    // ── 1. Fetch deployed apps ────────────────────────────────────────────────
    const [ch2Res, ch1Res] = await Promise.allSettled([
      client.get(
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`,
        { params: { pageSize: 200 } }
      ),
      client.get(`/cloudhub/api/v2/applications`, {
        headers: { 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': envId },
      }),
    ]);

    const ch2Apps = (ch2Res.status === 'fulfilled' ? ch2Res.value.data?.items || [] : []).map(a => ({ ...a, _type: 'CH2' }));
    const ch1Apps = (ch1Res.status === 'fulfilled'
      ? Array.isArray(ch1Res.value.data) ? ch1Res.value.data : (ch1Res.value.data?.data || [])
      : []).map(a => ({ ...a, _type: 'CH1' }));

    debug.ch2Apps = ch2Apps.length;
    debug.ch1Apps = ch1Apps.length;
    const deployedApps = [...ch2Apps, ...ch1Apps];

    // Build normalised app name lookup
    const appByNorm = {};
    deployedApps.forEach(app => {
      const name = (app.name || app.domain || '').toLowerCase();
      if (name) {
        appByNorm[name] = app;
        const norm = normaliseName(name);
        if (norm) appByNorm[norm] = app;
      }
    });

    // ── 2. Fan-out: ARM → CPS non-secure → CPS secure ─────────────────────────
    const sourceAppNodes = new Map();
    const targetNodes = new Map();
    const edges = [];
    const seenEdges = new Set();
    const BATCH = 5;

    /** Add an edge (source → target) if not already seen. */
    function addEdge(srcId, srcApp, targetId, targetNode, edgeId, cpsKey, cpsValue) {
      const dedupKey = `${srcId}->${targetId}`;
      if (seenEdges.has(dedupKey)) return;
      seenEdges.add(dedupKey);
      ensureSourceNode(sourceAppNodes, srcId, srcApp);
      if (!targetNodes.has(targetId)) targetNodes.set(targetId, targetNode);
      edges.push({
        id: edgeId || dedupKey,
        source: srcId,
        target: targetId,
        edgeType: targetNode.type === 'app' ? 'internal' : 'external',
        cpsKey,
        cpsValue,
        appName: srcApp.name || srcApp.domain,
        targetName: targetNode.label,
      });
      debug.edges++;
    }

    for (let i = 0; i < deployedApps.length; i += BATCH) {
      await Promise.allSettled(
        deployedApps.slice(i, i + BATCH).map(async (app) => {
          try {
            // Step A: ARM detail
            let armProps = {};
            if (app._type === 'CH2') {
              const r = await client.get(
                `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${app.id}`
              );
              armProps = extractArmProps(r.data);
            } else {
              const appName = app.domain || app.name;
              const r = await client.get(`/cloudhub/api/applications/${appName}`, {
                headers: { 'X-ANYPNT-ORG-ID': orgId, 'X-ANYPNT-ENV-ID': envId },
              });
              armProps = r.data?.properties || {};
            }

            const cpsBaseUrl = armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'] ||
              armProps['cps.baseUrl'] || armProps['cps.url'] || '';
            const cpsKey = armProps['cps.projectName'] || armProps['cloudhub.api.name'] || app.name || '';
            const cpsEnv = armProps['cps.prefix'] || armProps['cps.environment'] || '';

            if (!cpsBaseUrl || !cpsKey) return;
            debug.cpsConfigFound++;

            const cred = getSessionCpsCred(req.session, cpsBaseUrl, orgId);
            if (!cred) return;

            const cpsHost = normaliseUrl(cpsBaseUrl).replace(/^https?:\/\//, '');
            const srcId = `app-${app.id || app.domain || app.name}`;

            // Step B: fetch CPS non-secure
            const nsUrl = `${normaliseUrl(cpsBaseUrl)}/api/v2/properties/non-secure`;
            const nsRes = await axios.get(nsUrl, {
              headers: { client_id: cred.clientId, client_secret: cred.clientSecret, 'Content-Type': 'application/json' },
              params: { ...(cpsEnv && { environment: cpsEnv }), keys: cpsKey },
              timeout: 12000,
              validateStatus: () => true,
            });
            if (nsRes.status !== 200) return;
            const nsFlat = flattenCpsProps(nsRes.data);

            // Step C: scan non-secure values for URLs/hostnames
            for (const [key, value] of Object.entries(nsFlat)) {
              if (typeof value !== 'string') continue;
              const hostname = extractHostname(value);
              if (!hostname) continue;
              if (hostname.includes(cpsHost) || cpsHost.includes(hostname)) continue;
              if (hostname.includes('anypoint.mulesoft') || hostname.includes('mulesoft.com')) continue;
              if (hostname === 'localhost' || hostname === '127.0.0.1') continue;

              debug.cpsUrlsFound++;
              const matched = matchHostnameToApp(hostname, appByNorm);
              if (matched) {
                const tId = `app-${matched.id || matched.domain || matched.name}`;
                if (tId !== srcId) {
                  addEdge(srcId, app, tId,
                    { id: tId, label: matched.name || matched.domain, type: 'app', status: matched.status || 'UNKNOWN', deploymentType: matched._type, meta: { appId: matched.id || matched.domain, deploymentType: matched._type } },
                    `${srcId}->${tId}::ns:${key}`, key, value
                  );
                }
              } else {
                const extId = `ext-${hostname}`;
                addEdge(srcId, app, extId,
                  { id: extId, label: hostname, type: 'external', meta: { hostname, exampleUrl: value } },
                  `${srcId}->${extId}::ns:${key}`, key, value
                );
              }
            }

            // Step D: fetch and scan SECURE properties
            // The secure group KEY NAME typically matches an API app name directly.
            // e.g. "sapi-coupa-lookup-commons" → "sapi-coupa-lookup" → deployed app
            const secStr = nsFlat['cps.secure.properties'] || nsFlat['cps.secureProperties'] || '';
            if (!secStr.trim()) return;

            const secUrl = `${normaliseUrl(cpsBaseUrl)}/api/v2/properties/secure`;
            const secRes = await axios.get(secUrl, {
              headers: { client_id: cred.clientId, client_secret: cred.clientSecret, 'Content-Type': 'application/json' },
              params: { ...(cpsEnv && { environment: cpsEnv }), keys: secStr.trim() },
              timeout: 15000,
              validateStatus: () => true,
            });
            if (secRes.status !== 200) return;

            const secGroups = Array.isArray(secRes.data?.responses) ? secRes.data.responses : [];
            debug.secureGroupsScanned += secGroups.length;

            for (const group of secGroups) {
              const groupKey = group.key || '';
              const groupProps = group.properties || {};
              if (typeof groupProps === 'string') continue; // "COULD NOT ACCESS"

              // Strategy 1: match GROUP KEY NAME to a deployed app
              if (groupKey && isApiConnectionGroup(groupKey, groupProps)) {
                const groupNorm = normaliseName(groupKey);
                if (groupNorm && groupNorm.length >= 5) {
                  // Try hostname matcher first (treats groupNorm as if it were a hostname subdomain)
                  let matchedByKey = null;
                  for (const [k, a] of Object.entries(appByNorm)) {
                    if (k.length < 5) continue;
                    const kNorm = normaliseName(k);
                    if (groupNorm === kNorm || groupNorm.startsWith(kNorm) || kNorm.startsWith(groupNorm)) {
                      matchedByKey = a;
                      break;
                    }
                  }
                  if (matchedByKey) {
                    const tId = `app-${matchedByKey.id || matchedByKey.domain || matchedByKey.name}`;
                    if (tId !== srcId) {
                      addEdge(srcId, app, tId,
                        { id: tId, label: matchedByKey.name || matchedByKey.domain, type: 'app', status: matchedByKey.status || 'UNKNOWN', deploymentType: matchedByKey._type, meta: { appId: matchedByKey.id || matchedByKey.domain, deploymentType: matchedByKey._type } },
                        `${srcId}->${tId}::sec-key:${groupKey}`,
                        `[secure] ${groupKey}`, groupKey
                      );
                    }
                  }
                }
              }

              // Strategy 2: scan property VALUES in secure group
              for (const [propKey, propValue] of Object.entries(groupProps)) {
                if (typeof propValue !== 'string') continue;
                if (INFRA_KEY_PATTERNS.test(propKey)) continue; // skip passwords, JKS, bootstrap servers
                const h = extractHostname(propValue);
                if (!h) continue;
                if (h.includes(cpsHost) || cpsHost.includes(h)) continue;
                if (h.includes('anypoint.mulesoft') || h.includes('mulesoft.com')) continue;
                if (h === 'localhost' || h === '127.0.0.1') continue;

                debug.cpsUrlsFound++;
                const matched = matchHostnameToApp(h, appByNorm);
                if (matched) {
                  const tId = `app-${matched.id || matched.domain || matched.name}`;
                  if (tId !== srcId) {
                    addEdge(srcId, app, tId,
                      { id: tId, label: matched.name || matched.domain, type: 'app', status: matched.status || 'UNKNOWN', deploymentType: matched._type, meta: { appId: matched.id || matched.domain, deploymentType: matched._type } },
                      `${srcId}->${tId}::${propKey}`,
                      `[sec:${groupKey}] ${propKey}`, propValue
                    );
                  }
                } else {
                  const extId = `ext-${h}`;
                  addEdge(srcId, app, extId,
                    { id: extId, label: h, type: 'external', meta: { hostname: h, exampleUrl: propValue } },
                    `${srcId}->${extId}::${propKey}`,
                    `[sec:${groupKey}] ${propKey}`, propValue
                  );
                }
              }
            }
          } catch (err) {
            debug.errors.push(`${app.name || app.domain}: ${err.message}`);
          }
        })
      );
    }

    // ── 3. Build final node/edge sets ─────────────────────────────────────────
    const allNodesMap = new Map();
    for (const [id, node] of sourceAppNodes.entries()) allNodesMap.set(id, node);
    for (const [id, node] of targetNodes.entries()) { if (!allNodesMap.has(id)) allNodesMap.set(id, node); }

    const allNodeIds = new Set(allNodesMap.keys());
    const validEdges = edges.filter(e => allNodeIds.has(e.source) && allNodeIds.has(e.target));
    const allNodes = [...allNodesMap.values()];
    const internalCount = validEdges.filter(e => e.edgeType === 'internal').length;
    const externalCount = validEdges.filter(e => e.edgeType === 'external').length;

    console.log(
      `[Graph/CPS] orgId=${orgId} envId=${envId} — ` +
      `${deployedApps.length} apps, ${debug.cpsConfigFound} with CPS, ` +
      `${debug.secureGroupsScanned} secure groups, ` +
      `${allNodes.length} nodes, ${validEdges.length} edges (${internalCount} int + ${externalCount} ext)`
    );

    const result = {
      nodes: allNodes,
      edges: validEdges,
      summary: {
        apps: allNodes.filter(n => n.type === 'app').length,
        endpoints: allNodes.filter(n => n.type === 'external').length,
        edges: validEdges.length,
        internalEdges: internalCount,
        externalEdges: externalCount,
      },
      debug,
    };

    setCache(orgId, envId, result);
    res.json(result);
  } catch (err) {
    console.error('[Graph] dependencies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
