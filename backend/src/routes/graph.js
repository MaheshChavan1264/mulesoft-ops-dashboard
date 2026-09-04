const express = require('express');
const router = express.Router();
const { createClient } = require('../utils/anypointClient');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// ── Simple in-memory graph cache ──────────────────────────────────────────────
// Avoids re-running 100+ Anypoint HTTP calls on every "Build Graph" click.
// TTL: 2 minutes. Pass ?noCache=true to bypass.
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

// ── Normalise an app name for fuzzy matching ──────────────────────────────────
// Strips common version AND environment suffixes so that:
//   "orders-sapi-v1"   matches "orders-sapi"
//   "orders-sapi-dev"  matches "orders-sapi-prod"
//   "orders-sapi-uat"  matches "orders-sapi"
function normaliseName(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    // Strip environment suffixes: -dev, -sit, -uat, -prod, -sandbox, -staging, -qa, -test, -local
    .replace(/[-_](dev|sit|uat|prod|sandbox|staging|qa|test|local|hotfix|release)$/i, '')
    // Strip version tags: -v1, -v2, -v2.1, -1.0.0
    .replace(/-v?\d+(\.\d+)*$/, '')
    // Strip trailing separators
    .replace(/[-_\s]+$/, '');
}

// ── GET /api/graph/dependencies ───────────────────────────────────────────────
// Builds a dependency graph of Mule apps → API Manager instances for a given
// org + environment.
//
// Matching strategy (contract application → deployed app):
//   1. Exact name match  (case-insensitive)
//   2. Normalised name match  (strips version/env suffixes)
//   3. Substring match  (only when normalised name is ≥ 5 chars to prevent
//      false positives from short tokens like "api", "app", "service")
//   If none match, the contract app is included as a 'client' node.
//
// Query params:
//   orgId    (required)
//   envId    (required)
//   noCache  (optional) — pass 'true' to force a fresh fetch
router.get('/dependencies', async (req, res) => {
  const { orgId, envId, noCache } = req.query;
  const client = createClient(req.session.token);

  if (!orgId || !envId) {
    return res.status(400).json({ error: 'orgId and envId are required query parameters' });
  }

  // ── Serve from cache if available ─────────────────────────────────────────
  if (noCache !== 'true') {
    const cached = getCached(orgId, envId);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }
  }

  const debug = {
    apis: 0,
    ch2Apps: 0,          // FIX: now properly updated below
    ch1Apps: 0,          // FIX: now properly updated below
    contractsChecked: 0, // FIX: now properly updated below
    contractsFetched: 0, // FIX: now properly updated below
    contractErrors: [],  // FIX: now populated on contract fetch failure
    edges: 0,
  };

  try {
    // ── 1. API instances (paginated) ──────────────────────────────────────────
    // FIX: replaced single-page fetch (limit=100) with a pagination loop so
    // orgs with >100 API instances are fully captured.
    //
    // IMPORTANT — response structure:
    //   { assets: [ { id: <assetGroupId>, assetId: "...", apis: [ { id: <instanceId>, ... } ] } ] }
    //
    // The contracts endpoint uses the INSTANCE id (nested inside asset.apis[]),
    // NOT the asset-group id at the top level. We flatten all nested instances
    // and carry the parent assetId/assetVersion down so the rest of the code
    // can use apiInst.id as the correct API Manager instance ID.
    const apis = [];
    const PAGE_SIZE = 100;
    let offset = 0;
    let totalApis = Infinity;

    while (apis.length < totalApis) {
      const apiRes = await client.get(
        `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis`,
        { params: { limit: PAGE_SIZE, offset } }
      );
      const assets = apiRes.data?.assets || [];
      totalApis = typeof apiRes.data?.total === 'number' ? apiRes.data.total : assets.length;
      if (assets.length === 0) break;

      // Flatten nested api instances. Each asset may have asset.apis[] containing
      // the actual API Manager instances with their own numeric ids. Fall back to
      // treating the asset itself as the instance if no nested apis[] found.
      for (const asset of assets) {
        if (Array.isArray(asset.apis) && asset.apis.length > 0) {
          for (const inst of asset.apis) {
            apis.push({
              ...inst,
              // Ensure assetId and version are available even if omitted on child
              assetId: inst.assetId || asset.assetId,
              assetVersion: inst.assetVersion || asset.assetVersion,
              productVersion: inst.productVersion || asset.productVersion,
            });
          }
        } else {
          // Older API / single-instance format — asset IS the instance
          apis.push(asset);
        }
      }

      offset += assets.length;
      if (assets.length < PAGE_SIZE) break; // last page
    }

    debug.apis = apis.length;
    console.log(`[Graph] orgId=${orgId} envId=${envId} → ${apis.length} API instances (after flattening nested apis[])`);

    // ── 2. Deployed applications (CH2 + CH1) ─────────────────────────────────
    // FIX: CH1 API requires org/env as request HEADERS (X-ANYPNT-ORG-ID /
    // X-ANYPNT-ENV-ID), not as query parameters. Using query params caused the
    // filter to be silently ignored, returning all orgs or nothing.
    const [ch2Res, ch1Res] = await Promise.allSettled([
      client.get(
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`,
        { params: { pageSize: 200 } }
      ),
      client.get(
        `/cloudhub/api/v2/applications`,
        {
          headers: {
            'X-ANYPNT-ORG-ID': orgId,
            'X-ANYPNT-ENV-ID': envId,
          },
        }
      ),
    ]);

    const ch2Apps = (ch2Res.status === 'fulfilled' ? ch2Res.value.data?.items || [] : [])
      .map(a => ({ ...a, _type: 'CH2' }));
    const ch1Apps = (ch1Res.status === 'fulfilled'
      ? Array.isArray(ch1Res.value.data) ? ch1Res.value.data : (ch1Res.value.data?.data || [])
      : []).map(a => ({ ...a, _type: 'CH1' }));

    // FIX: debug counters for CH2/CH1 are now properly set
    debug.ch2Apps = ch2Apps.length;
    debug.ch1Apps = ch1Apps.length;

    const deployedApps = [...ch2Apps, ...ch1Apps];

    // ── 3. Build name → deployed app lookup (for fuzzy matching) ─────────────
    const nameToApp = {};
    deployedApps.forEach(app => {
      const name = (app.name || app.domain || '').toLowerCase().trim();
      if (name) nameToApp[name] = app;
    });

    // Lookup helper: exact → normalised → careful substring
    function findDeployedApp(contractAppName) {
      if (!contractAppName) return null;
      const raw = contractAppName.toLowerCase().trim();

      // 1. Exact match (case-insensitive)
      if (nameToApp[raw]) return nameToApp[raw];

      // 2. Normalised match (strips version/env suffixes)
      const norm = normaliseName(raw);
      for (const [key, app] of Object.entries(nameToApp)) {
        if (normaliseName(key) === norm) return app;
      }

      // 3. Substring match — FIX: guard with minimum length (≥5 chars) to
      //    prevent short tokens like "api", "app", "svc" from matching
      //    any app that happens to contain those characters.
      if (norm.length >= 5) {
        for (const [key, app] of Object.entries(nameToApp)) {
          const keyNorm = normaliseName(key);
          if (keyNorm.includes(norm) || norm.includes(keyNorm)) return app;
        }
      }

      return null;
    }

    // ── 4. Fetch contracts per API (batches of 10) ────────────────────────────
    const edges = [];
    const clientNodeMap = {}; // contractAppName → synthetic 'client' node
    const BATCH = 10;

    // FIX: contractsChecked is now set to the actual count before fetching
    debug.contractsChecked = apis.length;

    for (let i = 0; i < apis.length; i += BATCH) {
      await Promise.allSettled(
        apis.slice(i, i + BATCH).map(async (apiInst) => {
          try {
            const cRes = await client.get(
              `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInst.id}/contracts`
            );
            const contracts = cRes.data?.contracts || [];

            // FIX: contractsFetched is now incremented for each contract found
            debug.contractsFetched += contracts.length;

            contracts.forEach(contract => {
              const contractAppName = contract.application?.name || '';
              if (!contractAppName) return;

              const deployedApp = findDeployedApp(contractAppName);

              let sourceId, sourceLabel;
              if (deployedApp) {
                sourceId    = `app-${deployedApp.id || deployedApp.domain || deployedApp.name}`;
                sourceLabel = deployedApp.name || deployedApp.domain || contractAppName;
              } else {
                // Unknown client — create a synthetic node keyed by app name
                const key = contractAppName.toLowerCase().trim();
                sourceId    = `client-${key}`;
                sourceLabel = contractAppName;
                if (!clientNodeMap[sourceId]) {
                  clientNodeMap[sourceId] = {
                    id: sourceId,
                    label: contractAppName,
                    type: 'client',
                    status: null,
                    deploymentType: null,
                    meta: { contractApp: contractAppName },
                  };
                }
              }

              const apiNodeId = `api-${apiInst.id}`;
              const edgeId = `${sourceId}->${apiNodeId}`;

              edges.push({
                id: edgeId,
                source: sourceId,
                target: apiNodeId,
                contractStatus: contract.status || 'APPROVED',
                appName: sourceLabel,
                apiName: apiInst.assetId || String(apiInst.id),
                slaTier: contract.tier?.name || '',
              });
            });
          } catch (err) {
            // FIX: contract fetch failures are now recorded in debug.contractErrors
            // instead of being silently swallowed.
            const msg = `API ${apiInst.id} (${apiInst.assetId || 'unknown'}): ${err.message}`;
            debug.contractErrors.push(msg);
            console.warn(`[Graph] contract fetch failed — ${msg}`);
          }
        })
      );
    }

    // Deduplicate edges (same app → same API)
    const seenEdges = new Set();
    const uniqueEdges = edges.filter(e => {
      if (seenEdges.has(e.id)) return false;
      seenEdges.add(e.id);
      return true;
    });

    // ── 5. Build node sets ────────────────────────────────────────────────────
    const apiNodeIds = new Set(uniqueEdges.map(e => e.target));
    const appNodeIds = new Set(uniqueEdges.map(e => e.source));

    // API nodes (only those with at least one contract edge)
    const apiNodes = apis
      .filter(apiInst => apiNodeIds.has(`api-${apiInst.id}`))
      .map(apiInst => ({
        id: `api-${apiInst.id}`,
        label: apiInst.assetId || String(apiInst.id),
        type: 'api',
        meta: {
          apiId: apiInst.id,
          assetId: apiInst.assetId,
          assetVersion: apiInst.assetVersion,
          productVersion: apiInst.productVersion,
          orgId,
          envId,
        },
      }));

    // Matched deployed app nodes
    const deployedAppNodes = deployedApps
      .filter(app => appNodeIds.has(`app-${app.id || app.domain || app.name}`))
      .map(app => ({
        id: `app-${app.id || app.domain || app.name}`,
        label: app.name || app.domain || String(app.id),
        type: 'app',
        status: app.status || app.desiredStatus || 'UNKNOWN',
        deploymentType: app._type,
        meta: {
          appId: app.id || app.domain,
          status: app.status || app.desiredStatus || 'UNKNOWN',
          deploymentType: app._type,
          orgId,
          envId,
        },
      }));

    // Unmatched client nodes (contract apps with no deployed counterpart)
    const clientNodes = Object.values(clientNodeMap)
      .filter(n => appNodeIds.has(n.id));

    const allAppNodes = [...deployedAppNodes, ...clientNodes];

    debug.edges = uniqueEdges.length;
    console.log(`[Graph] result: ${apiNodes.length} apis, ${allAppNodes.length} apps (${deployedAppNodes.length} matched, ${clientNodes.length} unmatched), ${uniqueEdges.length} edges`);

    const result = {
      nodes: [...allAppNodes, ...apiNodes],
      edges: uniqueEdges,
      summary: {
        apis: apiNodes.length,
        apps: allAppNodes.length,
        edges: uniqueEdges.length,
        matched: deployedAppNodes.length,
        unmatched: clientNodes.length,
      },
      debug,
    };

    // Store in cache for subsequent requests
    setCache(orgId, envId, result);

    res.json(result);
  } catch (err) {
    console.error('[Graph] dependencies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;