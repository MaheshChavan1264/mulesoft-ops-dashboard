const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

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
    const response = await client.get('/cloudhub/api/applications', {
      headers: {
        'X-ANYPNT-ENV-ID': req.params.envId,
        'X-ANYPNT-ORG-ID': req.orgId
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
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: {
        'X-ANYPNT-ENV-ID': req.params.envId,
        'X-ANYPNT-ORG-ID': req.orgId
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
    const response = await client.get(`/cloudhub/api/applications/${req.params.appName}`, {
      headers: {
        'X-ANYPNT-ENV-ID': req.params.envId,
        'X-ANYPNT-ORG-ID': req.orgId
      }
    });
    const app = response.data;
    const properties = app.properties || {};
    res.json({
      appName: req.params.appName,
      properties,
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

// Get Runtime Fabric applications
router.get('/rtf/:orgId/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/runtimefabric/api/organizations/${req.params.orgId}/environments/${req.params.envId}/deployments`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching RTF apps:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch Runtime Fabric applications'
    });
  }
});

// Summary: get apps across all environments for an org (best effort)
router.get('/summary/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);

    // Get environments first
    const envResponse = await client.get(
      `/accounts/api/organizations/${req.params.orgId}/environments`
    );
    const environments = envResponse.data.data || [];

    const results = [];
    for (const env of environments) {
      try {
        const ch2Response = await client.get(
          `/amc/application-manager/api/v2/organizations/${req.params.orgId}/environments/${env.id}/deployments`,
          { params: { limit: 500 } }
        );
        const apps = ch2Response.data.items || [];
        apps.forEach((app) => {
          results.push({
            id: app.id,
            name: app.name,
            status: app.status,
            environment: { id: env.id, name: env.name, type: env.type },
            deploymentType: 'CloudHub 2.0',
            lastModifiedDate: app.lastModifiedDate,
            replicas: app.target?.deploymentSettings?.http?.inboundPublicUrl
          });
        });
      } catch (e) {
        // env may not support CH2, skip
      }

      try {
        const ch1Response = await client.get('/cloudhub/api/applications', {
          headers: {
            'X-ANYPNT-ENV-ID': env.id,
            'X-ANYPNT-ORG-ID': req.params.orgId
          }
        });
        const ch1Apps = ch1Response.data || [];
        ch1Apps.forEach((app) => {
          results.push({
            id: app.domain,
            name: app.domain,
            status: app.status,
            environment: { id: env.id, name: env.name, type: env.type },
            deploymentType: 'CloudHub 1.0',
            lastModifiedDate: app.lastUpdateTime,
            muleVersion: app.muleVersion?.version,
            workers: app.workers
          });
        });
      } catch (e) {
        // skip
      }
    }

    res.json({ total: results.length, data: results, environments });
  } catch (error) {
    console.error('Error fetching app summary:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch application summary'
    });
  }
});

module.exports = router;