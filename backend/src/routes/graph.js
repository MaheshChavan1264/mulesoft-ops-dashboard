const express = require('express');
const router = express.Router();
const { createClient } = require('../utils/anypointClient');
const authMiddleware = require('../middleware/authMiddleware');

router.use(authMiddleware);

// ── Normalise an app name for fuzzy matching ──────────────────────────────────
// Strips common suffixes (-v1, -v2, -dev, etc.) and lowercases so that
// "orders-sapi-v1" matches "orders-sapi".
function normaliseName(name) {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/-v\d+(\.\d+)*$/, '')   // strip trailing version (-v1, -v2.1)
    .replace(/[-_\s]+$/, '');         // strip trailing separators
}

// ── GET /api/graph/dependencies ───────────────────────────────────────────────
// Builds a dependency graph of Mule apps → API Manager instances for a given
// org + environment.
//
// Matching strategy (contract application → deployed app):
//   1. Exact name match  (case-insensitive)
//   2. Normalised name match  (strips -v1/-v2 suffixes)
//   3. Substring match  (one name contains the other)
//   If none match, the contract app is still included as a 'client' node so the
//   graph is never empty when contracts exist.
//
// Query params:
//   orgId  (required)
//   envId  (required)
router.get('/dependencies', async (req, res) => {
  const { orgId, envId } = req.query;
  const client = createClient(req.session.token);

  if (!orgId || !envId) {
    return res.status(400).json({ error: 'orgId and envId are required query parameters' });
  }

  try {
    // ── 1. API instances ──────────────────────────────────────────────────────
    const apiRes = await client.get(
      `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis`,
      { params: { limit: 100, offset: 0 } }
    );
    const apis = apiRes.data?.assets || [];

    // ── 2. Deployed applications (CH2 + CH1) ──────────────────────────────────
    const [ch2Res, ch1Res] = await Promise.allSettled([
      client.get(
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`,
        { params: { pageSize: 200 } }
      ),
      client.get(
        `/cloudhub/api/v2/applications`,
        { params: { orgId, environmentId: envId } }
      ),
    ]);

    const ch2Apps = (ch2Res.status === 'fulfilled' ? ch2Res.value.data?.items || [] : [])
      .map(a => ({ ...a, _type: 'CH2' }));
    const ch1Apps = (ch1Res.status === 'fulfilled'
      ? Array.isArray(ch1Res.value.data) ? ch1Res.value.data : (ch1Res.value.data?.data || [])
      : []).map(a => ({ ...a, _type: 'CH1' }));
    const deployedApps = [...ch2Apps, ...ch1Apps];

    // ── 3. Build name → deployed app lookup (for fuzzy matching) ─────────────
    // Key: exact lowercase name
    const nameToApp = {};
    deployedApps.forEach(app => {
      const name = (app.name || app.domain || '').toLowerCase().trim();
      if (name) nameToApp[name] = app;
    });

    // Lookup helper: tries exact → normalised → substring match
    function findDeployedApp(contractAppName) {
      if (!contractAppName) return null;
      const raw = contractAppName.toLowerCase().trim();

      // 1. Exact match
      if (nameToApp[raw]) return nameToApp[raw];

      // 2. Normalised match (strips -v1, -v2)
      const norm = normaliseName(raw);
      for (const [key, app] of Object.entries(nameToApp)) {
        if (normaliseName(key) === norm) return app;
      }

      // 3. Substring match
      for (const [key, app] of Object.entries(nameToApp)) {
        const keyNorm = normaliseName(key);
        if (keyNorm.includes(norm) || norm.includes(keyNorm)) return app;
      }

      return null;
    }

    // ── 4. Fetch contracts per API (batches of 10) ────────────────────────────
    // For every contract we emit an edge using the contract application name as
    // the source node, whether or not it matched a deployed app.
    const edges = [];
    const clientNodeMap = {};   // contractAppName → client node (unmatched apps)
    const BATCH = 10;

    for (let i = 0; i < apis.length; i += BATCH) {
      await Promise.allSettled(
        apis.slice(i, i + BATCH).map(async (apiInst) => {
          try {
            const cRes = await client.get(
              `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiInst.id}/contracts`
            );
            const contracts = cRes.data?.contracts || [];
            contracts.forEach(contract => {
              const contractAppName = contract.application?.name || '';
              if (!contractAppName) return;

              // Try to find a matching deployed app
              const deployedApp = findDeployedApp(contractAppName);

              let sourceId, sourceLabel, sourceStatus, sourceType;
              if (deployedApp) {
                sourceId    = `app-${deployedApp.id || deployedApp.domain || deployedApp.name}`;
                sourceLabel = deployedApp.name || deployedApp.domain || contractAppName;
                sourceStatus= deployedApp.status || deployedApp.desiredStatus || 'UNKNOWN';
                sourceType  = deployedApp._type;
              } else {
                // Unknown client — create a synthetic node keyed by app name
                const key = contractAppName.toLowerCase().trim();
                sourceId    = `client-${key}`;
                sourceLabel = contractAppName;
                sourceStatus= null;
                sourceType  = null;
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
          } catch (_) {
            // Contract fetch failure for one API is non-fatal
          }
        })
      );
    }

    // Deduplicate edges
    const seenEdges = new Set();
    const uniqueEdges = edges.filter(e => {
      if (seenEdges.has(e.id)) return false;
      seenEdges.add(e.id);
      return true;
    });

    // ── 5. Build node sets ────────────────────────────────────────────────────
    const apiNodeIds = new Set(uniqueEdges.map(e => e.target));
    const appNodeIds = new Set(uniqueEdges.map(e => e.source));

    // API nodes (only those referenced by at least one edge)
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

    // Deployed app nodes (matched)
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

    res.json({
      nodes: [...allAppNodes, ...apiNodes],
      edges: uniqueEdges,
      summary: {
        apis: apiNodes.length,
        apps: allAppNodes.length,
        edges: uniqueEdges.length,
        matched: deployedAppNodes.length,
        unmatched: clientNodes.length,
      },
    });
  } catch (err) {
    console.error('[Graph] dependencies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
