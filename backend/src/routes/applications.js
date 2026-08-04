const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Helper: parse apps from various CH2 response shapes
const parseCH2Apps = (data) => {
  if (Array.isArray(data)) return data;
  return data.items || data.deployments || data.content || data.data || [];
};

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
    console.error('Error fetching CH2 apps:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch CloudHub 2.0 applications'
    });
  }
});

// Get a specific CloudHub 2.0 application
router.get('/cloudhub2/:orgId/:envId/:deploymentId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/amc/application-manager/api/v2/organizations/${req.params.orgId}/environments/${req.params.envId}/deployments/${req.params.deploymentId}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching CH2 app:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch application'
    });
  }
});

// Get all CloudHub 1.0 applications
router.get('/cloudhub1/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get('/cloudhub/api/applications', {
      headers: {
        'X-ANYPNT-ENV-ID': req.params.envId,
        'X-ANYPNT-ORG-ID': orgId
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching CH1 apps:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch CloudHub 1.0 applications'
    });
  }
});

// Get a specific CloudHub 1.0 application
router.get('/cloudhub1/:envId/:appName', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: {
        'X-ANYPNT-ENV-ID': req.params.envId,
        'X-ANYPNT-ORG-ID': orgId
      }
    });
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching CH1 app:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch CloudHub 1.0 application'
    });
  }
});

// Get CloudHub 1.0 app properties
router.get('/cloudhub1/:envId/:appName/properties', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const orgId = req.query.orgId || req.orgId;
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: {
        'X-ANYPNT-ENV-ID': req.params.envId,
        'X-ANYPNT-ORG-ID': orgId
      }
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
    console.error('Error fetching app properties:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch application properties'
    });
  }
});

// Summary: get apps across all environments for an org (accepts orgId param or query)
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const targetOrgId = req.params.orgId;

    // Get environments for the target org
    const envResponse = await client.get(
      `/accounts/api/organizations/${targetOrgId}/environments`
    );
    const environments = envResponse.data.data || [];

    const results = [];
    const errors = [];

    await Promise.all(environments.map(async (env) => {
      // Try CloudHub 2.0
      try {
        const ch2Response = await client.get(
          `/amc/application-manager/api/v2/organizations/${targetOrgId}/environments/${env.id}/deployments`,
          { params: { limit: 500 } }
        );
        const apps = parseCH2Apps(ch2Response.data);
        apps.forEach((app) => {
          results.push({
            id: app.id,
            name: app.name,
            status: app.status || app.desiredStatus,
            environment: { id: env.id, name: env.name, type: env.type },
            deploymentType: 'CloudHub 2.0',
            lastModifiedDate: app.lastModifiedDate || app.updatedAt,
            muleVersion: app.target?.deploymentSettings?.runtimeVersion,
            replicas: app.target?.deploymentSettings?.resources?.cpu?.reserved
          });
        });
      } catch (e) {
        errors.push(`CH2 ${env.name}: ${e.message}`);
      }

      // Try CloudHub 1.0
      try {
        const ch1Response = await client.get('/cloudhub/api/applications', {
          headers: {
            'X-ANYPNT-ENV-ID': env.id,
            'X-ANYPNT-ORG-ID': targetOrgId
          }
        });
        const ch1Apps = Array.isArray(ch1Response.data) ? ch1Response.data : [];
        ch1Apps.forEach((app) => {
          // Avoid duplicates if already found via CH2
          if (!results.find((r) => r.name === app.domain)) {
            results.push({
              id: app.domain,
              name: app.domain,
              status: app.status,
              environment: { id: env.id, name: env.name, type: env.type },
              deploymentType: 'CloudHub 1.0',
              lastModifiedDate: app.lastUpdateTime ? new Date(app.lastUpdateTime).toISOString() : null,
              muleVersion: app.muleVersion?.version,
              workers: app.workers
            });
          }
        });
      } catch (e) {
        errors.push(`CH1 ${env.name}: ${e.message}`);
      }
    }));

    res.json({
      total: results.length,
      data: results,
      environments,
      orgId: targetOrgId,
      _errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('Error fetching app summary:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch application summary'
    });
  }
});

module.exports = router;