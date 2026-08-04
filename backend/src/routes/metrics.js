const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Get application metrics (CloudHub 1.0)
router.get('/cloudhub1/:envId/:appName', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { duration = '1d', period = '1h' } = req.query;
    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/dashboardData`,
      {
        headers: {
          'X-ANYPNT-ENV-ID': req.params.envId,
          'X-ANYPNT-ORG-ID': req.orgId
        },
        params: { duration, period }
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching CH1 metrics:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch application metrics'
    });
  }
});

// Get application logs (CloudHub 1.0)
router.get('/cloudhub1/:envId/:appName/logs', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 100, priority = 'INFO', startTime, endTime } = req.query;
    const params = { limit, priority };
    if (startTime) params.startTime = startTime;
    if (endTime) params.endTime = endTime;

    const response = await client.get(
      `/cloudhub/api/applications/${req.params.appName}/logs`,
      {
        headers: {
          'X-ANYPNT-ENV-ID': req.params.envId,
          'X-ANYPNT-ORG-ID': req.orgId
        },
        params
      }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching app logs:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch application logs'
    });
  }
});

// Get API analytics
router.get('/api/:orgId/:envId/:apiId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { duration = '1d', policy } = req.query;
    const params = { duration };
    if (policy) params.policy = policy;

    const response = await client.get(
      `/analytics/1.0/${req.params.orgId}/environments/${req.params.envId}/events`,
      { params }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching API analytics:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API analytics'
    });
  }
});

// Get organization-wide metrics summary
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);

    const envResponse = await client.get(
      `/accounts/api/organizations/${req.params.orgId}/environments`
    );
    const environments = envResponse.data.data || [];

    let totalApps = 0;
    let runningApps = 0;
    let failedApps = 0;
    let stoppedApps = 0;

    for (const env of environments) {
      try {
        const ch2Resp = await client.get(
          `/amc/application-manager/api/v2/organizations/${req.params.orgId}/environments/${env.id}/deployments`,
          { params: { limit: 500 } }
        );
        const apps = ch2Resp.data.items || [];
        totalApps += apps.length;
        apps.forEach((app) => {
          const status = (app.status || '').toLowerCase();
          if (status === 'running') runningApps++;
          else if (status === 'failed') failedApps++;
          else stoppedApps++;
        });
      } catch (e) {
        // skip
      }
    }

    res.json({
      orgId: req.params.orgId,
      summary: {
        totalApplications: totalApps,
        running: runningApps,
        failed: failedApps,
        stopped: stoppedApps,
        environments: environments.length
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