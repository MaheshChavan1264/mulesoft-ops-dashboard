const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Skip environments containing dev or qa
const isProductionEnv = (env) => {
  const name = (env.name || '').toLowerCase();
  return !name.includes('qa') && !name.includes('dev');
};

const parseCH2Apps = (data) => {
  if (Array.isArray(data)) return data;
  return data.items || data.deployments || data.content || data.data || [];
};

// Get application metrics (CloudHub 1.0)
router.get('/cloudhub1/:envId/:appName', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { duration = '1d', period = '1h' } = req.query;
    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/dashboardData`,
      {
        headers: { 'X-ANYPNT-ENV-ID': req.params.envId, 'X-ANYPNT-ORG-ID': req.orgId },
        params: { duration, period }
      }
    );
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({ error: error.message });
  }
});

// Organization-wide metrics summary — aggregates across ALL accessible envs
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);

    // Build list of { orgId, env } pairs from ALL accessible environments
    // This covers root org + all sub-orgs (business groups)
    let allEnvPairs = [];

    const targetOrgId = req.params.orgId;

    if (Object.keys(req.accessibleEnvironments).length > 0) {
      // If the requested orgId has its own environments in the session, use only those
      // Otherwise aggregate across all accessible environments (root org case)
      const targetEnvs = req.accessibleEnvironments[targetOrgId];
      if (targetEnvs?.length > 0) {
        // Specific BG selected — use only that BG's environments
        for (const env of targetEnvs) {
          if (isProductionEnv(env)) allEnvPairs.push({ orgId: targetOrgId, env });
        }
      } else {
        // Root org or BG with no direct environments — aggregate all accessible
        for (const [orgId, envs] of Object.entries(req.accessibleEnvironments)) {
          for (const env of envs) {
            if (isProductionEnv(env)) allEnvPairs.push({ orgId, env });
          }
        }
      }
    } else {
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
          headers: { 'X-ANYPNT-ENV-ID': env.id, 'X-ANYPNT-ORG-ID': orgId }
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
  } catch (error) {
    console.error('Error fetching metrics summary:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch metrics summary'
    });
  }
});

module.exports = router;