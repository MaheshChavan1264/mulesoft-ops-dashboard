const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const {
  isProductionEnv,
  parseCH2Apps,
  normalizeStatus,
  makeCh1Headers,
} = require('../utils/appHelpers');
const { sendProxyError } = require('../utils/responseHelpers');

// Get all applications for an environment (CloudHub 2.0)
router.get('/cloudhub2/:orgId/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 50, offset = 0 } = req.query;
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${req.params.orgId}/environments/${req.params.envId}/deployments`,
      { params: { limit, offset } }
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch CloudHub 2.0 applications');
  }
});

// Get a specific CloudHub 2.0 application — enriched with properties from separate endpoint
router.get('/cloudhub2/:orgId/:envId/:deploymentId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { orgId, envId, deploymentId } = req.params;

    // Fetch main deployment detail
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`
    );
    const deployment = response.data;

    // Try to fetch application properties from dedicated endpoint
    let extraProps = null;
    try {
      const propsRes = await client.get(
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/settings`
      );
      extraProps = propsRes.data;
    } catch { /* not all apps have this endpoint */ }

    // Merge extra props into the deployment response if found
    if (extraProps) {
      deployment._settings = extraProps;
    }

    res.json(deployment);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application');
  }
});

// Get CloudHub 2.0 app schedulers
router.get('/cloudhub2/:orgId/:envId/:deploymentId/schedulers', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { orgId, envId, deploymentId } = req.params;
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/schedulers`
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch schedulers');
  }
});

// Get all CloudHub 1.0 applications
router.get('/cloudhub1/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get('/cloudhub/api/applications', {
      headers: makeCh1Headers(req.params.envId, orgId),
    });
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch CloudHub 1.0 applications');
  }
});

// Get a specific CloudHub 1.0 application
router.get('/cloudhub1/:envId/:appName', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: makeCh1Headers(req.params.envId, orgId),
    });
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch CloudHub 1.0 application');
  }
});

// Get CloudHub 1.0 static IP assignments
// Note: this endpoint returns 404 for apps that don't have the /static-ips API available.
// The frontend handles 404 gracefully by falling back to ipAddresses[] in the main app detail.
router.get('/cloudhub1/:envId/:appName/static-ips', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/static-ips`,
      { headers: makeCh1Headers(req.params.envId, orgId) }
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    // 404 is expected for apps that don't have the static-ips endpoint — log at debug level only
    if (status !== 404) {
      console.error('Error fetching CH1 static IPs:', error.response?.data || error.message);
    }
    res.status(status).json({
      error: error.response?.data?.message || 'Failed to fetch static IPs'
    });
  }
});

// Get CloudHub 1.0 app schedules
router.get('/cloudhub1/:envId/:appName/schedules', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/schedules`,
      { headers: makeCh1Headers(req.params.envId, orgId) }
    );
    res.json(response.data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch schedules');
  }
});

// Get CloudHub 1.0 app properties
router.get('/cloudhub1/:envId/:appName/properties', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: makeCh1Headers(req.params.envId, orgId),
    });
    const app = response.data;
    res.json({
      appName: req.params.appName,
      properties: app.properties || {},
      workerType: app.workers?.type,
      workers: app.workers?.amount,
      muleVersion: app.muleVersion?.version,
      region: app.region,
      persistentQueues: app.persistentQueues,
      staticIPsEnabled: app.staticIPsEnabled,
      loggingCustomLog4JEnabled: app.loggingCustomLog4JEnabled,
      monitoringEnabled: app.monitoringEnabled
    });
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application properties');
  }
});

// Control action for CloudHub 1.0 (start / stop / restart)
// CH1 API status-change strategies (tried in order):
//   1. POST /cloudhub/api/applications/{domain}/status  { status: 'start'|'stop'|'restart' }
//   2. PUT  /cloudhub/api/applications/{domain}          { status: 'STARTED'|'STOPPED'|'RESTARTED' }
//   3. Restart = stop (strategy 2) → wait 4s → start (strategy 2)
router.post('/cloudhub1/:envId/:appName/action', authMiddleware, async (req, res) => {
  const { envId, appName } = req.params;
  const { action } = req.body; // 'start' | 'stop' | 'restart'
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }
  const orgId = req.query.orgId || req.orgId;
  const client = createClient(req.anypointToken);
  const headers = makeCh1Headers(envId, orgId);

  // Strategy 1: POST .../status with { status: 'start'|'stop'|'restart' }
  // This is the canonical CH1 REST API status-change endpoint
  const strategy1 = async (act) =>
    client.post(`/cloudhub/api/applications/${appName}/status`, { status: act }, { headers });

  // Strategy 2: PUT .../  with { status: 'STARTED'|'STOPPED'|'RESTARTED' }
  const statusMap = { start: 'STARTED', stop: 'STOPPED', restart: 'RESTARTED' };
  const strategy2 = async (act) =>
    client.put(`/cloudhub/api/applications/${appName}`, { status: statusMap[act] || act.toUpperCase() }, { headers });

  // Restart helper: execute a single-action fn for stop, wait, then start
  const doRestart = async (fn) => {
    await fn('stop');
    await new Promise((r) => setTimeout(r, 4000));
    await fn('start');
  };

  // Try strategy 1 first
  try {
    if (action === 'restart') {
      // CH1 may not have a native restart — try direct first, then stop→start
      try {
        await strategy1('restart');
      } catch {
        await doRestart(strategy1);
      }
    } else {
      await strategy1(action);
    }
    return res.json({ success: true, action, appName });
  } catch (e1) {
    // Strategy 1 failed — try strategy 2 (PUT with status field)
    try {
      if (action === 'restart') {
        try {
          await strategy2('restart');
        } catch {
          await doRestart(strategy2);
        }
      } else {
        await strategy2(action);
      }
      return res.json({ success: true, action, appName });
    } catch (e2) {
      console.error(`CH1 action ${action} failed for ${appName}:`, e2.response?.data || e2.message);
      return res.status(e2.response?.status || 500).json({
        error: e2.response?.data?.message || `Failed to ${action} application`
      });
    }
  }
});

// Control action for CloudHub 2.0 (start / stop / restart)
router.post('/cloudhub2/:orgId/:envId/:deploymentId/action', authMiddleware, async (req, res) => {
  const { orgId, envId, deploymentId } = req.params;
  const { action } = req.body; // 'start' | 'stop' | 'restart'
  if (!['start', 'stop', 'restart'].includes(action)) {
    return res.status(400).json({ error: `Invalid action: ${action}` });
  }
  const client = createClient(req.anypointToken);
  const base = `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}`;

  try {
    // Try dedicated action endpoint first (POST .../start, .../stop, .../restart)
    const response = await client.post(`${base}/${action}`);
    return res.json({ success: true, action, deploymentId, data: response.data });
  } catch (e1) {
    // Fallback for start/stop: PATCH desiredState
    // Fallback for restart: stop then start (RESTARTED is not a valid desiredState)
    try {
      if (action === 'restart') {
        // CH2 restart = stop → wait → start
        await client.patch(base, { application: { desiredState: 'STOPPED' } });
        await new Promise(r => setTimeout(r, 3000));
        await client.patch(base, { application: { desiredState: 'STARTED' } });
        return res.json({ success: true, action, deploymentId });
      }
      const stateMap = { start: 'STARTED', stop: 'STOPPED' };
      const response = await client.patch(base, {
        application: { desiredState: stateMap[action] }
      });
      return res.json({ success: true, action, deploymentId, data: response.data });
    } catch (e2) {
      console.error(`CH2 action ${action} failed for ${deploymentId}:`, e2.response?.data || e2.message);
      return res.status(e2.response?.status || 500).json({
        error: e2.response?.data?.message || `Failed to ${action} deployment`
      });
    }
  }
});

// Get CH2 Private Space details (includes network.outboundStaticIps)
// targetId is a UUID when deployed to a Private Space (not a region name like cloudhub-us-east-2)
router.get('/private-spaces/:orgId/:privateSpaceId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { orgId, privateSpaceId } = req.params;
    const response = await client.get(
      `/runtimefabric/api/organizations/${orgId}/privatespaces/${privateSpaceId}`
    );
    res.json(response.data);
  } catch (error) {
    const status = error.response?.status || 500;
    if (status !== 404) console.error('Error fetching private space:', error.response?.data || error.message);
    res.status(status).json({ error: error.response?.data?.message || 'Failed to fetch private space' });
  }
});

const SUMMARY_CACHE_TTL_MS   = 20 * 60 * 1000; // hard eviction window  (20 min)
const SUMMARY_CACHE_FRESH_MS  = 15 * 60 * 1000; // SWR freshness threshold (15 min)

/**
 * Core fetch-and-cache logic for the application summary.
 * Extracted so it can be called both synchronously (cache miss) and
 * fire-and-forget (SWR background refresh).
 *
 * @param {object} client     Anypoint HTTP client
 * @param {string} targetOrgId
 * @param {object} session    req.session (mutated to store result)
 * @returns {Promise<object>} responseData
 */
async function _fetchSummary(client, targetOrgId, session) {
  const envResponse = await client.get(
    `/accounts/api/organizations/${targetOrgId}/environments`
  );
  const allEnvironments = envResponse.data.data || [];
  const environments = allEnvironments.filter(isProductionEnv);

  const results = [];
  const errors = [];
  const accessibleEnvIds = new Set();

  await Promise.all(environments.map(async (env) => {
    let ch2Accessible = false;
    let ch1Accessible = false;

    try {
      const ch2Response = await client.get(
        `/amc/application-manager/api/v2/organizations/${targetOrgId}/environments/${env.id}/deployments`,
        { params: { limit: 500 } }
      );
      ch2Accessible = true;
      const apps = parseCH2Apps(ch2Response.data);
      apps.forEach((app) => {
        const runtimeStatus = app.application?.status || app.application?.state;
        const deploymentStatus = app.status || app.desiredStatus;
        const effectiveStatus = runtimeStatus || deploymentStatus;
        results.push({
          id: app.id,
          name: app.name,
          status: normalizeStatus(effectiveStatus),
          deploymentStatus: normalizeStatus(deploymentStatus),
          environment: { id: env.id, name: env.name, type: env.type },
          deploymentType: 'CloudHub 2.0',
          lastModifiedDate: app.lastModifiedDate || app.updatedAt,
          muleVersion: app.currentRuntimeVersion || app.lastSuccessfulRuntimeVersion,
          replicas: app.target?.replicas,
        });
      });
    } catch (e) {
      const status = e.response?.status;
      if (status !== 403 && status !== 401) ch2Accessible = true;
      if (status !== 403 && status !== 401) errors.push(`CH2 ${env.name}: ${e.message}`);
    }

    try {
      const ch1Response = await client.get('/cloudhub/api/applications', {
        headers: makeCh1Headers(env.id, targetOrgId),
      });
      ch1Accessible = true;
      const raw = ch1Response.data;
      const ch1Apps = Array.isArray(raw) ? raw : (raw.applications || raw.data || []);
      ch1Apps.forEach((app) => {
        if (!results.find((r) => r.name === (app.domain || app.name))) {
          results.push({
            id: app.domain || app.name,
            name: app.domain || app.name,
            status: normalizeStatus(app.status),
            environment: { id: env.id, name: env.name, type: env.type },
            deploymentType: 'CloudHub 1.0',
            lastModifiedDate: app.lastUpdateTime ? new Date(app.lastUpdateTime).toISOString() : null,
            muleVersion: typeof app.muleVersion === 'string'
              ? app.muleVersion
              : app.muleVersion?.version,
            workers: app.workers,
            staticIPsEnabled: app.staticIPsEnabled ?? null,
          });
        }
      });
    } catch (e) {
      const status = e.response?.status;
      if (status !== 403 && status !== 401) ch1Accessible = true;
      if (status !== 403 && status !== 401) errors.push(`CH1 ${env.name} (${status || 'ERR'}): ${e.response?.data?.message || e.message}`);
    }

    if (ch1Accessible || ch2Accessible) accessibleEnvIds.add(env.id);
  }));

  const accessibleEnvironments = environments.filter(e => accessibleEnvIds.has(e.id));
  const responseData = {
    total: results.length,
    data: results,
    environments: accessibleEnvironments,
    orgId: targetOrgId,
    _errors: errors.length > 0 ? errors : undefined,
    _cachedAt: new Date().toISOString(),
  };

  if (!session.summaryCache) session.summaryCache = {};
  session.summaryCache[targetOrgId] = { data: responseData, ts: Date.now() };
  console.log(`[Summary] Cache SET for org ${targetOrgId} (${results.length} apps)`);
  return responseData;
}

// Summary: get apps across all environments for an org (accepts orgId param or query)
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const targetOrgId = req.params.orgId;
    const forceRefresh = req.query.refresh === 'true';

    // ── Session cache with Stale-While-Revalidate ─────────────────────────────
    // Cache is keyed by orgId inside the user's session so different users
    // never share cached data.
    //
    //  age < FRESH_MS  (15 min) → serve cached data, no network call
    //  age < TTL_MS   (20 min) → serve cached data immediately +
    //                            kick off background refresh so the
    //                            NEXT request also hits a warm cache
    //  age ≥ TTL_MS            → synchronous fetch (cold cache)
    if (!req.session.summaryCache) req.session.summaryCache = {};
    const cached  = req.session.summaryCache[targetOrgId];
    const ageMs   = cached ? Date.now() - cached.ts : Infinity;
    const isFresh = ageMs < SUMMARY_CACHE_FRESH_MS;
    const isUsable = ageMs < SUMMARY_CACHE_TTL_MS;

    if (!forceRefresh && cached && isFresh) {
      // ── Fresh hit — instant response, no network ─────────────────────────
      return res.json(cached.data);
    }

    if (!forceRefresh && cached && isUsable) {
      // ── Stale-but-usable — respond immediately, refresh silently ─────────
      res.json(cached.data);
      // Fire-and-forget: refresh in background so the next call is instant
      _fetchSummary(client, targetOrgId, req.session)
        .then(() => console.log(`[Summary] BG refresh done for org ${targetOrgId}`))
        .catch((err) => console.warn(`[Summary] BG refresh failed for org ${targetOrgId}:`, err.message));
      return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Cache miss or force-refresh — fetch synchronously
    const data = await _fetchSummary(client, targetOrgId, req.session);
    res.json(data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application summary');
  }
});

module.exports = router;
