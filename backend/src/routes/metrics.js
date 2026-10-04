const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { isProductionEnv, parseCH2Apps, makeCh1Headers, getAccessibleEnvPairs } = require('../utils/appHelpers');
const { proxyHandler } = require('../utils/asyncHandler');

// Get application metrics (CloudHub 1.0)
router.get('/cloudhub1/:envId/:appName', authMiddleware, proxyHandler('Failed to fetch CloudHub 1.0 metrics', async (req, res) => {
  const client = createClient(req.anypointToken);
  const { duration = '1d', period = '1h' } = req.query;
  const response = await client.get(
    `/cloudhub/api/applications/${req.params.appName}/dashboardData`,
    {
      headers: makeCh1Headers(req.params.envId, req.orgId),
      params: { duration, period }
    }
  );
  res.json(response.data);
}));

// Organization-wide metrics summary — aggregates across ALL accessible envs
router.get('/summary/:orgId', authMiddleware, proxyHandler('Failed to fetch metrics summary', async (req, res) => {
  const client = createClient(req.anypointToken);
  const targetOrgId = req.params.orgId;

  // Build list of { orgId, env } pairs from ALL accessible environments.
  // This covers root org + all sub-orgs (business groups) — see
  // utils/appHelpers.js#getAccessibleEnvPairs for the shared selection logic.
  let allEnvPairs = getAccessibleEnvPairs(req.accessibleEnvironments, targetOrgId);

  if (allEnvPairs.length === 0 && Object.keys(req.accessibleEnvironments).length === 0) {
    // Fallback: fetch environments for the requested org only — skip dev/qa
    try {
      const envRes = await client.get(
        `/accounts/api/organizations/${req.params.orgId}/environments`
      );
      const envs = (envRes.data.data || []).filter(isProductionEnv);
      allEnvPairs = envs.map((env) => ({ orgId: req.params.orgId, env }));
    } catch (e) {
      allEnvPairs = [];
    }
  }

  let totalApps = 0, runningApps = 0, failedApps = 0, stoppedApps = 0;
  const environmentsSeen = new Set();

  await Promise.all(allEnvPairs.map(async ({ orgId, env }) => {
    environmentsSeen.add(env.id);

    // Try CloudHub 2.0
    try {
      const ch2Res = await client.get(
        `/amc/application-manager/api/v2/organizations/${orgId}/environments/${env.id}/deployments`,
        { params: { limit: 500 } }
      );
      const apps = parseCH2Apps(ch2Res.data);
      totalApps += apps.length;
      apps.forEach((app) => {
        // Use app.application.status (runtime) not app.status (deployment spec e.g. APPLIED)
        const s = (app.application?.status || app.application?.state || app.status || app.desiredStatus || '').toUpperCase();
        if (s === 'RUNNING' || s === 'STARTED') runningApps++;
        else if (s === 'FAILED') failedApps++;
        else stoppedApps++;
      });
    } catch (e) { /* skip */ }

    // Try CloudHub 1.0
    try {
      const ch1Res = await client.get('/cloudhub/api/applications', {
        headers: makeCh1Headers(env.id, orgId),
      });
      const ch1Apps = Array.isArray(ch1Res.data) ? ch1Res.data : (ch1Res.data.applications || []);
      ch1Apps.forEach((app) => {
        totalApps++;
        const s = (app.status || '').toUpperCase();
        if (s === 'STARTED' || s === 'RUNNING') runningApps++;
        else if (s === 'FAILED' || s === 'DEPLOY_FAILED') failedApps++;
        else stoppedApps++;
      });
    } catch (e) { /* skip */ }
  }));

  res.json({
    orgId: req.params.orgId,
    summary: {
      totalApplications: totalApps,
      running: runningApps,
      failed: failedApps,
      stopped: stoppedApps,
      environments: environmentsSeen.size
    }
  });
}));

module.exports = router;
