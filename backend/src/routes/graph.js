const express = require('express');
const router = express.Router();
const axios = require('axios');
const { createClient } = require('../utils/anypointClient');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// ── In-memory graph cache (TTL: 2 minutes) ────────────────────────────────────
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

// ── Name normalisation ────────────────────────────────────────────────────────
function normaliseName(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/[-_](dev|sit|uat|prod|sandbox|staging|qa|test|local|hotfix|release)$/i, '')
    .replace(/-v?\d+(\.\d+)*$/, '')
    .replace(/[-_\s]+$/, '');
}

// ── CPS helpers ───────────────────────────────────────────────────────────────

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
  return fallback ? fallback[1] : null;
}

/**
 * Extract a hostname candidate from a CPS property value.
 * Handles:
 *   - Full URLs:       https://orders-sapi-v1.cloudhub.io/api → orders-sapi-v1.cloudhub.io
 *   - Bare hostnames:  orders-sapi-v1.cloudhub.io            → orders-sapi-v1.cloudhub.io
 *   - host:port:       orders-sapi.example.com:8080           → orders-sapi.example.com
 */
function extractHostname(value) {
  const v = String(value || '').trim();
  if (!v) return null;
  // Full URL
  if (/^https?:\/\//i.test(v)) {
    try { return new URL(v).hostname || null; } catch { return null; }
  }
  // Bare hostname or host:port (contains a dot, no spaces, looks like a domain)
  if (/^[a-z0-9-]+\.[a-z0-9.\-]+(:\d+)?(\/.*)?$/i.test(v)) {
    return v.split('/')[0].split(':')[0];
  }
  return null;
}

/**
 * Try to match a hostname to a deployed app by comparing normalised segments.
 */
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

// Property key suffixes that strongly indicate a URL/endpoint value
const URL_KEY_PATTERNS = /\.(url|base[_.\-]?url|uri|host|endpoint|address|server|location|baseuri|baseurl|apiurl|service[_.\-]?url)$/i;

// ── GET /api/graph/dependencies ───────────────────────────────────────────────
// CPS-based service dependency graph.
//
// For each deployed app this route:
//   1. Fetches ARM deployment detail to extract CPS config
//   2. Fetches CPS non-secure properties (using session credentials)
//   3. Scans property VALUES for http(s) URLs
//   4. Matches URLs to other deployed apps → 'app' target nodes
//      Unmatched URLs → 'external' endpoint nodes (hostname as label)
//
// Requires CPS credentials stored in session via POST /api/cps/credentials.
// Returns { noCpsCredentials: true } when no credentials are configured.
router.get('/dependencies', async (req, res) => {
  const { orgId, envId, noCache } = req.query;
  const client = createClient(req.session.token);

  if (!orgId || !envId) {
    return res.status(400).json({ error: 'orgId and envId are required' });
  }

  // Check CPS credentials before doing the expensive fan-out
  if (!req.session.cpsCreds || Object.keys(req.session.cpsCreds).length === 0) {
    return res.json({
      nodes: [], edges: [], summary: { apps: 0, endpoints: 0, edges: 0 },
      noCpsCredentials: true,
      debug: {},
    });
  }

  if (noCache !== 'true') {
    const cached = getCached(orgId, envId);
    if (cached) return res.json({ ...cached, cached: true });
  }

  const debug = { ch2Apps: 0, ch1Apps: 0, cpsConfigFound: 0, cpsUrlsFound: 0, edges: 0, errors: [] };

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

    const ch2Apps = (ch2Res.status === 'fulfilled' ? ch2Res.value.data?.items || [] : [])
      .map(a => ({ ...a, _type: 'CH2' }));
    const ch1Apps = (ch1Res.status === 'fulfilled'
      ? Array.isArray(ch1Res.value.data) ? ch1Res.value.data : (ch1Res.value.data?.data || [])
      : []).map(a => ({ ...a, _type: 'CH1' }));

    debug.ch2Apps = ch2Apps.length;
    debug.ch1Apps = ch1Apps.length;
    const deployedApps = [...ch2Apps, ...ch1Apps];

    // Build normalised app name lookup for URL → app matching
    const appByNorm = {};
    deployedApps.forEach(app => {
      const name = (app.name || app.domain || '').toLowerCase();
      if (name) {
        appByNorm[name] = app;
        const norm = normaliseName(name);
        if (norm) appByNorm[norm] = app;
      }
    });

    // ── 2. Fan-out: ARM detail → CPS config → CPS non-secure properties ───────
    const sourceAppNodes = new Map(); // id → node
    const targetNodes = new Map();    // id → node  (matched apps or external endpoints)
    const edges = [];
    const seenEdges = new Set();
    const BATCH = 5;

    for (let i = 0; i < deployedApps.length; i += BATCH) {
      await Promise.allSettled(
        deployedApps.slice(i, i + BATCH).map(async (app) => {
          try {
            // Step A: fetch ARM detail
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

            const cpsBaseUrl =
              armProps['cps.configServerBaseUrl'] || armProps['config.server.base.url'] ||
              armProps['cps.baseUrl'] || armProps['cps.url'] || '';
            const cpsKey =
              armProps['cps.projectName'] || armProps['cloudhub.api.name'] || app.name || '';
            const cpsEnv = armProps['cps.prefix'] || armProps['cps.environment'] || '';

            if (!cpsBaseUrl || !cpsKey) return;
            debug.cpsConfigFound++;

            const cred = getSessionCpsCred(req.session, cpsBaseUrl, orgId);
            if (!cred) return;

            // Step B: fetch CPS non-secure properties
            const nsUrl = `${normaliseUrl(cpsBaseUrl)}/api/v2/properties/non-secure`;
            const nsRes = await axios.get(nsUrl, {
              headers: {
                client_id: cred.clientId,
                client_secret: cred.clientSecret,
                'Content-Type': 'application/json',
              },
              params: { ...(cpsEnv && { environment: cpsEnv }), keys: cpsKey },
              timeout: 12000,
              validateStatus: () => true,
            });

            if (nsRes.status !== 200) return;
            const nsFlat = flattenCpsProps(nsRes.data);

            const srcId = `app-${app.id || app.domain || app.name}`;

            // Step C: scan property values for hostnames / URLs
            for (const [key, value] of Object.entries(nsFlat)) {
              if (typeof value !== 'string') continue;
              const v = String(value).trim();
              if (!v) continue;

              // Extract hostname from value (handles http:// URLs, bare hostnames, host:port)
              // Also check key name hints for connection properties
              const isConnectionKey = URL_KEY_PATTERNS.test(key);
              const hostname = extractHostname(v);
              if (!hostname && !isConnectionKey) continue;
              if (!hostname) continue;

              // Skip the CPS server itself
              const cpsHost = normaliseUrl(cpsBaseUrl).replace(/^https?:\/\//, '');
              if (hostname.includes(cpsHost) || cpsHost.includes(hostname)) continue;
              // Skip Anypoint / MuleSoft platform
              if (hostname.includes('anypoint.mulesoft') || hostname.includes('mulesoft.com') ||
                  hostname.includes('anypoint.com') || hostname.includes('cloudhub.io') && hostname.split('.').length > 3) {
                // Allow single-subdomain cloudhub.io (app deployments), skip platform domains
                if (!hostname.match(/^[^.]+\.cloudhub\.io$/)) continue;
              }
              // Skip clearly internal/localhost values
              if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('10.') ||
                  hostname.startsWith('192.168.') || hostname.startsWith('172.')) continue;

              debug.cpsUrlsFound++;

              // Try to match hostname to a deployed app
              let targetId, targetLabel, targetType;
              const matched = matchHostnameToApp(hostname, appByNorm);

              if (matched) {
                targetId = `app-${matched.id || matched.domain || matched.name}`;
                targetLabel = matched.name || matched.domain;
                targetType = 'app';
                if (targetId === srcId) continue;

                // Ensure target app node exists
                if (!targetNodes.has(targetId)) {
                  targetNodes.set(targetId, {
                    id: targetId,
                    label: targetLabel,
                    type: 'app',
                    status: matched.status || matched.desiredStatus || 'UNKNOWN',
                    deploymentType: matched._type,
                    meta: { appId: matched.id || matched.domain, deploymentType: matched._type },
                  });
                }
              } else {
                // External endpoint — use hostname as node key
                targetId = `ext-${hostname}`;
                targetLabel = hostname;
                targetType = 'external';

                if (!targetNodes.has(targetId)) {
                  targetNodes.set(targetId, {
                    id: targetId,
                    label: hostname,
                    type: 'external',
                    meta: { hostname, exampleUrl: v },
                  });
                }
              }

              const edgeId = `${srcId}->${targetId}::${key}`;
              // Deduplicate: same source → same target via same property key
              const dedupKey = `${srcId}->${targetId}`;
              if (seenEdges.has(dedupKey)) continue;
              seenEdges.add(dedupKey);

              // Ensure source app node exists
              if (!sourceAppNodes.has(srcId)) {
                sourceAppNodes.set(srcId, {
                  id: srcId,
                  label: app.name || app.domain || String(app.id),
                  type: 'app',
                  status: app.status || app.desiredStatus || 'UNKNOWN',
                  deploymentType: app._type,
                  meta: {
                    appId: app.id || app.domain,
                    deploymentType: app._type,
                    status: app.status || 'UNKNOWN',
                  },
                });
              }

              edges.push({
                id: edgeId,
                source: srcId,
                target: targetId,
                edgeType: targetType === 'app' ? 'internal' : 'external',
                cpsKey: key,
                cpsValue: v,
                appName: app.name || app.domain,
                targetName: targetLabel,
              });
              debug.edges++;
            }
          } catch (err) {
            debug.errors.push(`${app.name || app.domain}: ${err.message}`);
          }
        })
      );
    }

    // ── 3. Build final node/edge sets ─────────────────────────────────────────
    // Some target app nodes may also be source nodes — merge them
    const allNodesMap = new Map();

    // Add source app nodes first (they have full status info)
    for (const [id, node] of sourceAppNodes.entries()) {
      allNodesMap.set(id, node);
    }

    // Add target nodes (if a target is also a source, source version wins)
    for (const [id, node] of targetNodes.entries()) {
      if (!allNodesMap.has(id)) allNodesMap.set(id, node);
    }

    // Only keep edges where both nodes exist
    const allNodeIds = new Set(allNodesMap.keys());
    const validEdges = edges.filter(e => allNodeIds.has(e.source) && allNodeIds.has(e.target));

    const allNodes = [...allNodesMap.values()];
    const internalCount = validEdges.filter(e => e.edgeType === 'internal').length;
    const externalCount = validEdges.filter(e => e.edgeType === 'external').length;

    console.log(
      `[Graph/CPS] orgId=${orgId} envId=${envId} — ` +
      `${deployedApps.length} apps, ${debug.cpsConfigFound} with CPS, ` +
      `${allNodes.length} nodes, ${validEdges.length} edges ` +
      `(${internalCount} internal + ${externalCount} external)`
    );

    const result = {
      nodes: allNodes,
      edges: validEdges,
      summary: {
        apps: [...allNodesMap.values()].filter(n => n.type === 'app').length,
        endpoints: [...allNodesMap.values()].filter(n => n.type === 'external').length,
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