const express = require('express');
const router = express.Router();
const NodeCache = require('node-cache');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const {
  isProductionEnv,
  parseCH2Apps,
  normalizeStatus,
  makeCh1Headers,
} = require('../utils/appHelpers');
const { sendProxyError, extractAnypointErrorMessage } = require('../utils/responseHelpers');
const { tryStrategies, runWithRestartFallback } = require('../utils/retryStrategies');
const { mapWithConcurrency } = require('../utils/concurrencyPool');
const logger = require('../utils/logger');

// ── Application-summary in-memory cache ──────────────────────────────────────
//
// WHY in-memory and not SQLite?
//   • App status changes every few minutes — persistence across restarts adds
//     no value (data would be stale anyway on the next boot).
//   • Map.get() is ~0.01 ms; a SQLite read is 1–10 ms + JSON.parse overhead.
//   • The bottleneck is the Anypoint API fan-out (dozens of parallel HTTP calls),
//     not the cache lookup — shaving 1 ms from the read path is irrelevant.
//   • SQLite is the right home for operational history (→ ping_history), not
//     for a hot read-path cache with a 3-min freshness window.
//
// WHY keyed by orgId (not sessionId)?
//   • Old code: globalSummaryCache[sessionId][orgId] — 10 users from the same
//     org triggered 10 separate full Anypoint fan-outs and held 10 copies of
//     the same data in memory.  Dead sessions were never evicted → memory leak.
//   • New code: summaryCache[orgId] — all users of the same org share one entry.
//     The Anypoint token used to populate the cache belongs to whoever triggered
//     the first fetch; subsequent users read the already-cached result instantly.
//   • Security: the cache key IS the orgId, so users of org-A never receive
//     org-B data.  The Anypoint token enforces row-level access at fetch time.
//
// TTL constants
//   FRESH_MS  (3 min)  — serve instantly, no network call
//   TTL_MS    (20 min) — hard eviction via NodeCache stdTTL + checkperiod
//   SWR window = FRESH_MS … TTL_MS: serve stale data + trigger background refresh

const SUMMARY_CACHE_TTL_MS  = 20 * 60 * 1000; // 20 min hard eviction
const SUMMARY_CACHE_FRESH_MS =  3 * 60 * 1000; // 3 min SWR freshness threshold

const summaryCache = new NodeCache({
  stdTTL:      SUMMARY_CACHE_TTL_MS / 1000,  // NodeCache uses seconds
  checkperiod: 5 * 60,                        // sweep for expired keys every 5 min
  useClones:   false,                         // skip deep-copy on read — safe because
                                              // we never mutate cached objects
});

// Thundering-herd guard: if multiple requests arrive for the same org while the
// cache is cold, they all share the single in-flight Promise instead of each
// firing an independent Anypoint fan-out.
const inflightSummary = new Map(); // orgId → Promise<responseData>

// ── Single-app-detail in-memory cache ────────────────────────────────────────
//
// Same NodeCache + SWR + thundering-herd-guard shape as the summary cache
// above, but with a much shorter window: a single app's detail page is
// opened/refreshed far more often per entity than the org-wide summary, and
// `status` can change at any moment (user action, Anypoint auto-scaling), so
// staying "instant" for more than ~1 min risks showing a stale running
// state. Key is `${orgId}:${envId}:${deploymentId}` (CH2) or
// `${orgId}:${envId}:${appName}` (CH1) — shared across all users viewing the
// same app, same security reasoning as summaryCache (key scopes to orgId;
// the caller's own Anypoint token still governs what they're allowed to see).
const DETAIL_CACHE_TTL_MS   = 5 * 60 * 1000; // 5 min hard eviction
const DETAIL_CACHE_FRESH_MS = 60 * 1000;     // 1 min SWR freshness threshold

const detailCache = new NodeCache({
  stdTTL:      DETAIL_CACHE_TTL_MS / 1000,
  checkperiod: 60,       // short TTL — sweep every 1 min
  useClones:   false,
});
const inflightDetail = new Map(); // cacheKey → Promise<data>

/**
 * Generic NodeCache + SWR + thundering-herd-guard choreography, extracted
 * from the summary route's inline logic so single-app-detail routes can
 * reuse the exact same instant-fresh / stale+background-refresh /
 * piggyback-on-cold-fetch behavior without copy-pasting it per route.
 *
 * @param {object}   opts
 * @param {NodeCache} opts.cache
 * @param {Map}      opts.inflight       cacheKey → Promise<data>
 * @param {string}   opts.key
 * @param {number}   opts.freshMs
 * @param {boolean}  opts.forceRefresh
 * @param {Function} opts.fetchFn        () => Promise<data>
 * @param {string}   opts.label          used only in the bg-refresh-failed warn log
 * @returns {Promise<any>}  the data to send with res.json()
 */
async function swrFetch({ cache, inflight, key, freshMs, forceRefresh, fetchFn, label }) {
  const cached = cache.get(key); // undefined if evicted — NodeCache enforces hard TTL
  const ageMs  = cached ? Date.now() - cached.ts : Infinity;
  const isFresh = ageMs < freshMs;

  if (!forceRefresh && cached && isFresh) {
    return cached.data; // instant — zero network
  }

  if (!forceRefresh && cached) {
    // Stale-but-usable (NodeCache hasn't evicted it yet) — serve instantly,
    // kick off exactly one background refresh per key.
    if (!inflight.has(key)) {
      const p = fetchFn()
        .then((data) => { cache.set(key, { data, ts: Date.now() }); return data; })
        .catch((err) => logger.warn({ err }, `[${label}] BG refresh failed for ${key}`))
        .finally(() => inflight.delete(key));
      inflight.set(key, p);
    }
    return cached.data;
  }

  // Cache miss / forceRefresh
  if (!forceRefresh && inflight.has(key)) {
    return inflight.get(key); // piggyback on the in-flight fetch
  }

  const p = fetchFn()
    .then((data) => { cache.set(key, { data, ts: Date.now() }); return data; })
    .finally(() => inflight.delete(key));
  if (!forceRefresh) inflight.set(key, p);
  return p;
}

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
  const { orgId, envId, deploymentId } = req.params;
  const forceRefresh = req.query.refresh === 'true';
  const cacheKey = `ch2:${orgId}:${envId}:${deploymentId}`;
  try {
    const client = createClient(req.anypointToken);

    const fetchFn = async () => {
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
      return deployment;
    };

    const data = await swrFetch({
      cache: detailCache, inflight: inflightDetail, key: cacheKey,
      freshMs: DETAIL_CACHE_FRESH_MS, forceRefresh, fetchFn, label: 'CH2 detail',
    });
    res.json(data);
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

// Trigger a CloudHub 2.0 scheduler to run immediately (Run Now)
router.post('/cloudhub2/:orgId/:envId/:deploymentId/schedulers/:schedulerName/run', authMiddleware, async (req, res) => {
  const { orgId, envId, deploymentId, schedulerName } = req.params;
  const client = createClient(req.anypointToken);
  try {
    const response = await client.post(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/schedulers/${encodeURIComponent(schedulerName)}/run`
    );
    return res.json({ success: true, schedulerName, data: response.data });
  } catch (error) {
    sendProxyError(res, error, `Failed to trigger scheduler "${schedulerName}"`);
  }
});

// Enable or disable a CloudHub 2.0 scheduler.
// The Anypoint AMC API expects a PUT with the full scheduler config (not just
// `enabled`), so we fetch the current list first and merge the toggled flag
// into the matching scheduler's existing config before sending it back.
router.put('/cloudhub2/:orgId/:envId/:deploymentId/schedulers/:schedulerName', authMiddleware, async (req, res) => {
  const { orgId, envId, deploymentId, schedulerName } = req.params;
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" must be a boolean' });
  }
  const client = createClient(req.anypointToken);
  const basePath = `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${deploymentId}/schedulers`;
  try {
    const listResponse = await client.get(basePath);
    // Per Mulesoft's AMC Application Manager API, GET .../schedulers returns
    // { total, items: [...] } — NOT { schedulers: [...] }. The `.schedulers`
    // fallback below was wrong and silently produced an empty list for every
    // CH2 app, making "enable/disable" always 404 with "not found".
    const schedulers = Array.isArray(listResponse.data) ? listResponse.data : (listResponse.data?.items || listResponse.data?.schedulers || []);
    const current = schedulers.find((s) => s.name === schedulerName || s.flow === schedulerName || s.flowName === schedulerName);
    if (!current) {
      return res.status(404).json({ error: `Scheduler "${schedulerName}" not found` });
    }
    const payload = { ...current, enabled };
    const response = await client.put(
      `${basePath}/${encodeURIComponent(schedulerName)}`,
      payload
    );
    schedulersSummaryCache.del(orgId);
    return res.json({ success: true, schedulerName, enabled, data: response.data });
  } catch (error) {
    sendProxyError(res, error, `Failed to ${enabled ? 'enable' : 'disable'} scheduler "${schedulerName}"`);
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
  const { envId, appName } = req.params;
  const orgId = req.query.orgId || req.orgId;
  const forceRefresh = req.query.refresh === 'true';
  const cacheKey = `ch1:${orgId}:${envId}:${appName}`;
  try {
    const client = createClient(req.anypointToken);
    const fetchFn = async () => {
      const response = await client.get(`/cloudhub/api/applications/${appName}`, {
        headers: makeCh1Headers(envId, orgId),
      });
      return response.data;
    };
    const data = await swrFetch({
      cache: detailCache, inflight: inflightDetail, key: cacheKey,
      freshMs: DETAIL_CACHE_FRESH_MS, forceRefresh, fetchFn, label: 'CH1 detail',
    });
    res.json(data);
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
      logger.error({ err: error.response?.data || error.message }, 'Error fetching CH1 static IPs');
    }
    res.status(status).json({
      error: extractAnypointErrorMessage(error, 'Failed to fetch static IPs')
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

// Trigger a CloudHub 1.0 scheduler to run immediately (Run Now)
// Strategy 1: POST /cloudhub/api/applications/{appName}/schedules/{scheduleName}/run
// Strategy 2: POST /cloudhub/api/v2/applications/{appName}/schedules/{scheduleName}/run
router.post('/cloudhub1/:envId/:appName/schedules/:scheduleName/run', authMiddleware, async (req, res) => {
  const { envId, appName, scheduleName } = req.params;
  const orgId = req.query.orgId || req.orgId;
  const client = createClient(req.anypointToken);
  const headers = makeCh1Headers(envId, orgId);
  try {
    const response = await tryStrategies([
      () => client.post(`/cloudhub/api/applications/${appName}/schedules/${encodeURIComponent(scheduleName)}/run`, {}, { headers }),
      () => client.post(`/cloudhub/api/v2/applications/${appName}/schedules/${encodeURIComponent(scheduleName)}/run`, {}, { headers }),
    ]);
    return res.json({ success: true, scheduleName, data: response.data });
  } catch (err) {
    logger.error({ err: err.response?.data || err.message }, `CH1 schedule trigger failed for ${appName}/${scheduleName}`);
    return res.status(err.response?.status || 500).json({
      error: err.response?.data?.message || `Failed to trigger scheduler "${scheduleName}"`
    });
  }
});

// Enable or disable a CloudHub 1.0 schedule.
// Same approach as CH2: fetch the current list, merge the toggled `enabled`
// flag into the matching schedule's existing config, then PUT it back.
router.put('/cloudhub1/:envId/:appName/schedules/:scheduleId', authMiddleware, async (req, res) => {
  const { envId, appName, scheduleId } = req.params;
  const orgId = req.query.orgId || req.orgId;
  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: '"enabled" must be a boolean' });
  }
  const client = createClient(req.anypointToken);
  const headers = makeCh1Headers(envId, orgId);
  const basePath = `/cloudhub/api/applications/${appName}/schedules`;
  try {
    const listResponse = await client.get(basePath, { headers });
    const schedules = Array.isArray(listResponse.data) ? listResponse.data : listResponse.data?.data || [];
    const current = schedules.find((s) => s.id === scheduleId || s.name === scheduleId);
    if (!current) {
      return res.status(404).json({ error: `Schedule "${scheduleId}" not found` });
    }
    const payload = { ...current, enabled };
    const response = await client.put(
      `${basePath}/${encodeURIComponent(scheduleId)}`,
      payload,
      { headers }
    );
    schedulersSummaryCache.del(orgId);
    return res.json({ success: true, scheduleId, enabled, data: response.data });
  } catch (error) {
    sendProxyError(res, error, `Failed to ${enabled ? 'enable' : 'disable'} schedule "${scheduleId}"`);
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

  // Each strategy gets the restart = "try native restart, else stop→wait→start"
  // fallback automatically via runWithRestartFallback (utils/retryStrategies.js);
  // tryStrategies then tries strategy1-with-restart-fallback, and if THAT whole
  // thing fails, falls through to strategy2-with-restart-fallback.
  try {
    await tryStrategies([
      () => runWithRestartFallback(strategy1, action),
      () => runWithRestartFallback(strategy2, action),
    ]);
    detailCache.del(`ch1:${orgId}:${envId}:${appName}`);
    return res.json({ success: true, action, appName });
  } catch (err) {
    logger.error({ err: err.response?.data || err.message }, `CH1 action ${action} failed for ${appName}`);
    return res.status(err.response?.status || 500).json({
      error: err.response?.data?.message || `Failed to ${action} application`
    });
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

  // Strategy 1: dedicated action endpoint (POST .../start, .../stop, .../restart)
  const strategy1 = () => client.post(`${base}/${action}`);

  // Strategy 2: PATCH desiredState — restart isn't a valid desiredState on CH2,
  // so it's handled as stop → wait → start (RESTARTED is not accepted here).
  const strategy2 = async () => {
    if (action === 'restart') {
      await client.patch(base, { application: { desiredState: 'STOPPED' } });
      await new Promise((r) => setTimeout(r, 3000));
      return client.patch(base, { application: { desiredState: 'STARTED' } });
    }
    const stateMap = { start: 'STARTED', stop: 'STOPPED' };
    return client.patch(base, { application: { desiredState: stateMap[action] } });
  };

  try {
    const response = await tryStrategies([strategy1, strategy2]);
    detailCache.del(`ch2:${orgId}:${envId}:${deploymentId}`);
    return res.json({ success: true, action, deploymentId, data: response?.data });
  } catch (err) {
    logger.error({ err: err.response?.data || err.message }, `CH2 action ${action} failed for ${deploymentId}`);
    return res.status(err.response?.status || 500).json({
      error: err.response?.data?.message || `Failed to ${action} deployment`
    });
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
    if (status !== 404) logger.error({ err: error.response?.data || error.message }, 'Error fetching private space');
    res.status(status).json({ error: extractAnypointErrorMessage(error, 'Failed to fetch private space') });
  }
});

/**
 * Core fetch-and-cache logic for the application summary.
 * Extracted so it can be called both synchronously (cache miss) and
 * fire-and-forget (SWR background refresh).
 *
 * No longer accepts sessionId — cache is keyed by orgId only.
 * See the cache design notes at the top of this file.
 *
 * @param {object} client      Anypoint HTTP client
 * @param {string} targetOrgId
 * @returns {Promise<object>}  responseData
 */
async function _fetchSummary(client, targetOrgId) {
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

  // Store in NodeCache — TTL eviction is handled automatically by NodeCache's
  // internal checkperiod sweep; no manual cleanup needed.
  summaryCache.set(targetOrgId, { data: responseData, ts: Date.now() });
  logger.debug(`[Summary] Cache SET for org ${targetOrgId} (${results.length} apps)`);
  return responseData;
}

// Summary: get apps across all environments for an org
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const targetOrgId = req.params.orgId;
    const forceRefresh = req.query.refresh === 'true';

    // ── NodeCache-backed SWR (Stale-While-Revalidate) ─────────────────────
    //
    // Cache is keyed by orgId — all users of the same org share one entry.
    //
    //  age < FRESH_MS  (3 min)  → serve instantly, no network call
    //  age < TTL_MS   (20 min)  → serve stale data immediately AND trigger a
    //                             silent background refresh — the NEXT request
    //                             will always hit a warm cache
    //  age ≥ TTL_MS             → NodeCache has already evicted the key;
    //                             synchronous fetch (cold cache)
    //
    // Thundering-herd protection: if N requests arrive for the same org
    // while the cache is cold, only ONE Anypoint fan-out is issued — all
    // N callers await the same Promise via inflightSummary.
    // ─────────────────────────────────────────────────────────────────────

    const cached   = summaryCache.get(targetOrgId);      // undefined if evicted
    const ageMs    = cached ? Date.now() - cached.ts : Infinity;
    const isFresh  = ageMs < SUMMARY_CACHE_FRESH_MS;
    const isUsable = cached && ageMs < SUMMARY_CACHE_TTL_MS; // belt-and-suspenders

    if (!forceRefresh && cached && isFresh) {
      // ── Fresh hit — instant response, zero network ───────────────────────
      logger.debug(`[Summary] Cache HIT (fresh) for org ${targetOrgId} (age: ${Math.round(ageMs/1000)}s)`);
      return res.json(cached.data);
    }

    if (!forceRefresh && isUsable) {
      // ── Stale-but-usable — respond instantly, refresh in background ──────
      logger.debug(`[Summary] Cache HIT (stale) for org ${targetOrgId} (age: ${Math.round(ageMs/1000)}s) — BG refresh started`);
      res.json(cached.data);

      // Only start a background refresh if one isn't already running for this org
      if (!inflightSummary.has(targetOrgId)) {
        const p = _fetchSummary(client, targetOrgId)
          .catch((err) => logger.warn({ err }, `[Summary] BG refresh failed for org ${targetOrgId}`))
          .finally(() => inflightSummary.delete(targetOrgId));
        inflightSummary.set(targetOrgId, p);
      }
      return;
    }

    // ── Cache miss / force-refresh — thundering-herd protected fetch ────────
    logger.debug(`[Summary] Cache MISS for org ${targetOrgId} (forceRefresh: ${forceRefresh})`);

    if (!forceRefresh && inflightSummary.has(targetOrgId)) {
      // Another request is already fetching this org — piggyback on it
      logger.debug(`[Summary] Piggybacking on in-flight fetch for org ${targetOrgId}`);
      const data = await inflightSummary.get(targetOrgId);
      return res.json(data);
    }

    // First request to trigger the fetch — store promise so others can piggyback
    const p = _fetchSummary(client, targetOrgId)
      .finally(() => inflightSummary.delete(targetOrgId));

    if (!forceRefresh) inflightSummary.set(targetOrgId, p);

    const data = await p;
    res.json(data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch application summary');
  }
});

// ── Aggregate schedulers across every app in an org (Schedulers dashboard) ──
//
// Same NodeCache + SWR + thundering-herd-guard shape as summaryCache above.
// Reuses the (already-cached) app summary to know which apps exist and
// whether each is CH1/CH2, then fans out one scheduler-list call per app
// via mapWithConcurrency (bounded concurrency — an org can have hundreds of
// apps, and firing them all at once would hammer the Anypoint API / trip
// rate limits the way an unbounded Promise.all would).

const SCHEDULERS_SUMMARY_CACHE_TTL_MS   = 20 * 60 * 1000; // 20 min hard eviction
const SCHEDULERS_SUMMARY_CACHE_FRESH_MS =  3 * 60 * 1000; // 3 min SWR freshness threshold
const SCHEDULERS_FAN_OUT_CONCURRENCY = 8;

const schedulersSummaryCache = new NodeCache({
  stdTTL:      SCHEDULERS_SUMMARY_CACHE_TTL_MS / 1000,
  checkperiod: 5 * 60,
  useClones:   false,
});
const inflightSchedulersSummary = new Map(); // orgId → Promise<responseData>

/**
 * Picks the first "present" candidate from a list, where present means
 * "not null/undefined/empty-string" — unlike `a || b || c`, this correctly
 * keeps a legitimate `0` (e.g. frequency: 0) instead of falling through to
 * the next candidate.
 */
function firstPresent(...candidates) {
  for (const c of candidates) {
    if (c !== null && c !== undefined && c !== '') return c;
  }
  return null;
}

/**
 * Normalizes one raw CH1 ("schedule") or CH2 ("scheduler") entry plus its
 * owning app into the flat row shape the Schedulers dashboard renders.
 * Mirrors the same fallback chains frontend/.../InfrastructureTab.jsx uses
 * for a single app, so a scheduler looks identical whether it's reached via
 * the per-app tab or this aggregate view.
 */
function normalizeSchedulerRow(raw, app, i) {
  const schedule = raw.schedule || {};
  const status = raw.status || {};
  const cron = schedule.cronExpression || schedule.expression || raw.expression || raw.cronExpression || null;
  const timeZone = schedule.timeZone || schedule.timezone || raw.timeZone || raw.timezone || null;
  const frequency = firstPresent(raw.frequency, schedule.frequency, schedule.period > 0 ? schedule.period : null);
  const timeUnit = raw.timeUnit || schedule.timeUnit || null;
  const flowName = raw.flowName || raw.flow || raw.name || `scheduler-${i}`;
  // Per Mulesoft's AMC API docs, the identifier the PUT/POST/DELETE
  // scheduler endpoints expect in the URL path is `flowName` — prioritize
  // it over the speculative `name`/`schedulerName`/`flow` fallbacks (kept
  // only for CH1 schedules / older response shapes that may not use it).
  const schedulerKey = raw.flowName || raw.name || raw.schedulerName || raw.flow || `scheduler-${i}`;
  const lastRunCandidates = [
    raw.lastRun, schedule.lastRun, status.lastRun,
    raw.lastRunAt, schedule.lastRunAt, status.lastRunAt,
    raw.lastFireAt, schedule.lastFireAt, status.lastFireAt,
    raw.lastFiredAt, schedule.lastFiredAt, status.lastFiredAt,
    raw.lastFired, schedule.lastFired, status.lastFired,
  ];
  const lastRun = lastRunCandidates.find((v) => v != null && v !== 0 && v !== '') ?? null;
  // Explicit flag instead of making every caller re-derive `cron?.startsWith('${')`.
  // Resolving the actual value requires the app's CPS config + credentials
  // (see features/applications/tabs/InfrastructureTab.jsx's opt-in "Get Cron
  // Expressions" button) — deliberately NOT done here: this is a hot,
  // automatically-fanned-out aggregate endpoint, not a place to silently
  // fetch CPS secrets for every app on every dashboard load.
  const unresolvedPlaceholder = typeof cron === 'string' && cron.startsWith('${');
  return {
    envId: app.environment?.id,
    envName: app.environment?.name,
    appId: app.id,
    appName: app.name,
    appStatus: app.status,
    deploymentType: app.deploymentType,
    schedulerKey,
    // Guaranteed-unique identity for React keys / Set-based selection — NOT
    // sent back to Anypoint. schedulerKey (above) is a best-effort guess at
    // the real Anypoint identifier (falls back to flow name when the API
    // omits `name`), so two distinct schedulers CAN legitimately end up with
    // the same schedulerKey (e.g. the same flow scheduled twice). rowId's
    // index suffix keeps row identity/selection correct even then; see
    // markAmbiguousSchedulerKeys for the "same API key, action disabled" case.
    rowId: `${schedulerKey}::${i}`,
    flowName,
    cron,
    unresolvedPlaceholder,
    timeZone,
    frequency,
    timeUnit,
    enabled: raw.enabled !== false,
    lastRun,
  };
}

/**
 * Flags rows whose `schedulerKey` is shared by more than one scheduler in
 * the SAME app — Run Now / Toggle actions send `schedulerKey` back to
 * Anypoint as the target identifier, so when it's ambiguous we can't tell
 * which of the colliding schedulers an action would actually hit. Mutates
 * and returns `rows` with `ambiguousKey: true` set on every row involved in
 * a collision, so the frontend can disable actions on them instead of
 * guessing.
 */
function markAmbiguousSchedulerKeys(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.schedulerKey, (counts.get(row.schedulerKey) || 0) + 1);
  for (const row of rows) {
    if (counts.get(row.schedulerKey) > 1) row.ambiguousKey = true;
  }
  return rows;
}


async function _fetchSchedulersSummary(client, targetOrgId) {
  const cachedSummary = summaryCache.get(targetOrgId);
  const ageMs = cachedSummary ? Date.now() - cachedSummary.ts : Infinity;
  const isFresh = ageMs < SUMMARY_CACHE_FRESH_MS;

  let summaryData;
  if (cachedSummary && isFresh) {
    summaryData = cachedSummary.data;
  } else if (cachedSummary) {
    // Stale-but-usable — serve it now (an app roster up to a few minutes
    // old is fine for a scheduler listing), but kick off a background
    // refresh of the *app summary* itself so this cache can't silently
    // keep serving a roster up to SUMMARY_CACHE_TTL_MS (20 min) old with
    // no self-healing. Shares `inflightSummary` with the /summary/:orgId
    // route — if that route already triggered a refresh for this org, this
    // just piggybacks instead of firing a second redundant fan-out.
    summaryData = cachedSummary.data;
    if (!inflightSummary.has(targetOrgId)) {
      const p = _fetchSummary(client, targetOrgId)
        .catch((err) => logger.warn({ err }, `[SchedulersSummary] BG summary refresh failed for org ${targetOrgId}`))
        .finally(() => inflightSummary.delete(targetOrgId));
      inflightSummary.set(targetOrgId, p);
    }
  } else {
    // Cold cache — no choice but to fetch synchronously. Piggyback on an
    // in-flight fetch if the /summary/:orgId route (or another concurrent
    // scheduler-summary request) already started one for this org.
    summaryData = inflightSummary.has(targetOrgId)
      ? await inflightSummary.get(targetOrgId)
      : await (() => {
          const p = _fetchSummary(client, targetOrgId).finally(() => inflightSummary.delete(targetOrgId));
          inflightSummary.set(targetOrgId, p);
          return p;
        })();
  }
  const apps = summaryData.data || [];

  const fanOutResults = await mapWithConcurrency(apps, SCHEDULERS_FAN_OUT_CONCURRENCY, async (app) => {
    if (app.deploymentType === 'CloudHub 2.0') {
      const response = await client.get(
        `/amc/application-manager/api/v2/organizations/${targetOrgId}/environments/${app.environment.id}/deployments/${app.id}/schedulers`
      );
      // Per Mulesoft's AMC Application Manager API, GET .../schedulers
      // returns { total, items: [...] } — NOT { schedulers: [...] }. The
      // old `.schedulers` fallback always missed, silently producing an
      // empty list for every CH2 app in the aggregate Schedulers dashboard
      // (the per-app Infrastructure tab already checked `.items` — see
      // ApplicationDetailPage.jsx's loadCh2Schedulers — this route didn't).
      const list = Array.isArray(response.data) ? response.data : (response.data?.items || response.data?.schedulers || []);
      return markAmbiguousSchedulerKeys(list.map((s, i) => normalizeSchedulerRow(s, app, i)));
    }
    const response = await client.get(
      `/cloudhub/api/applications/${app.id}/schedules`,
      { headers: makeCh1Headers(app.environment.id, targetOrgId) }
    );
    const raw = response.data;
    const list = Array.isArray(raw) ? raw : (raw?.data || raw?.schedules || []);
    return markAmbiguousSchedulerKeys(list.map((s, i) => normalizeSchedulerRow(s, app, i)));
  });

  const schedulers = [];
  const errors = [];
  fanOutResults.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      schedulers.push(...r.value);
    } else {
      const app = apps[idx];
      const status = r.reason?.response?.status;
      // 403/401/404 are expected for apps without scheduler access/support —
      // only surface genuinely unexpected failures.
      if (status !== 403 && status !== 401 && status !== 404) {
        errors.push(`${app.name} (${app.environment?.name}): ${r.reason?.response?.data?.message || r.reason?.message || 'fetch failed'}`);
      }
    }
  });

  const responseData = {
    total: schedulers.length,
    data: schedulers,
    orgId: targetOrgId,
    _errors: errors.length > 0 ? errors : undefined,
    _cachedAt: new Date().toISOString(),
  };
  schedulersSummaryCache.set(targetOrgId, { data: responseData, ts: Date.now() });
  logger.debug(`[SchedulersSummary] Cache SET for org ${targetOrgId} (${schedulers.length} schedulers across ${apps.length} apps)`);
  return responseData;
}

// Schedulers summary: aggregate every app's schedulers across all environments for an org
router.get('/schedulers/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const targetOrgId = req.params.orgId;
    const forceRefresh = req.query.refresh === 'true';
    const data = await swrFetch({
      cache: schedulersSummaryCache,
      inflight: inflightSchedulersSummary,
      key: targetOrgId,
      freshMs: SCHEDULERS_SUMMARY_CACHE_FRESH_MS,
      forceRefresh,
      fetchFn: () => _fetchSchedulersSummary(client, targetOrgId),
      label: 'SchedulersSummary',
    });
    res.json(data);
  } catch (error) {
    sendProxyError(res, error, 'Failed to fetch schedulers summary');
  }
});

module.exports = router;
