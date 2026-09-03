const express = require('express');
const router = express.Router();
const { makeRequest } = require('../utils/anypointClient');
const { requireAuth } = require('../middleware/authMiddleware');

router.use(requireAuth);

// ── GET /api/graph/dependencies ───────────────────────────────────────────────
// Builds a dependency graph of Mule apps → API Manager instances for a given
// org + environment.
//
// Steps:
//   1. Fetch all API Manager instances for orgId+envId
//   2. Fetch all CH1 + CH2 apps for the same org+env
//   3. Build a clientId → app lookup from deployment properties
//   4. Fetch contracts for each API (batched, failures silently skipped)
//   5. Join contract clientIds to the app lookup
//   6. Return { nodes, edges, summary }
//
// Query params:
//   orgId  (required)
//   envId  (required)
router.get('/dependencies', async (req, res) => {
  const { orgId, envId } = req.query;
  const token = req.session?.token;

  if (!orgId || !envId) {
    return res.status(400).json({ error: 'orgId and envId are required query parameters' });
  }

  try {
    // ── 1. API instances ──────────────────────────────────────────────────────
    const apiRes = await makeRequest(
      token, 'GET',
      `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis`,
      null,
      { limit: 100, offset: 0 }
    );
    const apis = apiRes?.assets || [];

    // ── 2. Applications (CH2 + CH1) ───────────────────────────────────────────
    const [ch2Res, ch1Res] = await Promise.allSettled([
      makeRequest(token, 'GET',
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`,
        null, { pageSize: 200 }),
      makeRequest(token, 'GET',
        `/cloudhub/api/v2/applications`,
        null, { orgId, environmentId: envId }),
    ]);

    const ch2Apps = (ch2Res.status === 'fulfilled' ? ch2Res.value?.items || [] : [])
      .map(a => ({ ...a, _type: 'CH2' }));
    const ch1Apps = (ch1Res.status === 'fulfilled' ? ch1Res.value || [] : [])
      .map(a => ({ ...a, _type: 'CH1' }));
    const apps = [...ch2Apps, ...ch1Apps];

    // ── 3. Build clientId → app lookup ────────────────────────────────────────
    const clientIdToApp = {};
    apps.forEach(app => {
      const props = app.application?.properties || app.properties || {};
      const cid =
        props['anypoint.platform.client_id'] ||
        props['client_id'] ||
        props['clientId'] ||
        '';
      if (cid) clientIdToApp[cid.trim()] = app;
    });

    // ── 4. Fetch contracts per API (batches of 10) ────────────────────────────
    const edges = [];
    const BATCH = 10;

    for (let i = 0; i < apis.length; i += BATCH) {
      await Promise.allSettled(
        apis.slice(i, i + BATCH).map(async (api) => {
          try {
            const cRes = await makeRequest(
              token, 'GET',
              `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${api.id}/contracts`,
              null, {}
            );
            const contracts = cRes?.contracts || [];
            contracts.forEach(contract => {
              // Anypoint returns clientId at multiple depths depending on API Manager version
              const cid =
                contract.application?.clientId ||
                contract.application?.client_id ||
                contract.clientId ||
                '';
              if (!cid) return;
              const consumingApp = clientIdToApp[cid.trim()];
              if (!consumingApp) return;
              const appNodeId = `app-${consumingApp.id || consumingApp.domain || consumingApp.name}`;
              const apiNodeId = `api-${api.id}`;
              edges.push({
                id: `${appNodeId}->${apiNodeId}`,
                source: appNodeId,
                target: apiNodeId,
                contractStatus: contract.status || 'APPROVED',
                appName: consumingApp.name || consumingApp.domain || '',
                apiName: api.assetId || String(api.id),
                slaTier: contract.tier?.name || '',
              });
            });
          } catch (_) {
            // Contract fetch failure for a single API is non-fatal — skip it
          }
        })
      );
    }

    // Deduplicate edges (same app→api pair may appear from multiple contracts)
    const seenEdges = new Set();
    const uniqueEdges = edges.filter(e => {
      if (seenEdges.has(e.id)) return false;
      seenEdges.add(e.id);
      return true;
    });

    // ── 5. Build node sets ────────────────────────────────────────────────────
    const apiNodeIds  = new Set(uniqueEdges.map(e => e.target));
    const appNodeIds  = new Set(uniqueEdges.map(e => e.source));

    const apiNodes = apis
      .filter(api => apiNodeIds.has(`api-${api.id}`))
      .map(api => ({
        id: `api-${api.id}`,
        label: api.assetId || String(api.id),
        type: 'api',
        meta: {
          apiId: api.id,
          assetId: api.assetId,
          assetVersion: api.assetVersion,
          productVersion: api.productVersion,
          orgId,
          envId,
        },
      }));

    const appNodes = apps
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

    const nodes = [...appNodes, ...apiNodes];

    res.json({
      nodes,
      edges: uniqueEdges,
      summary: {
        apis: apiNodes.length,
        apps: appNodes.length,
        edges: uniqueEdges.length,
      },
    });
  } catch (err) {
    console.error('[Graph] dependencies error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;