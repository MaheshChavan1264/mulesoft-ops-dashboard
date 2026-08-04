const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Skip environments containing dev or qa in their name
const isProductionEnv = (env) => {
  const name = (env.name || '').toLowerCase();
  return !name.includes('qa') && !name.includes('dev');
};

// Helper: parse apps from various CH2 response shapes
const parseCH2Apps = (data) => {
  if (Array.isArray(data)) return data;
  return data.items || data.deployments || data.content || data.data || [];
};

// Normalize statuses across CH1 and CH2 so frontend uses one consistent set
// CH1: STARTED → RUNNING, DEPLOY_FAILED → FAILED, PARTIALLY_STARTED → PARTIALLY_STARTED
// CH2: RUNNING, FAILED, STOPPED, DEPLOYING, UPDATING, STARTING, STOPPING
const normalizeStatus = (status) => {
  const s = (status || '').toUpperCase().trim();
  if (s === 'STARTED') return 'RUNNING';
  if (s === 'DEPLOY_FAILED') return 'FAILED';
  if (s === 'UNDEPLOYED') return 'STOPPED';
  if (s === 'NOT_RUNNING') return 'STOPPED';
  return s;
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

    // Log what property paths exist for debugging
    const ds = deployment.target?.deploymentSettings || {};
    console.log(`CH2 props for ${deploymentId}:`, {
      'target.deploymentSettings.properties': Object.keys(ds.properties || {}),
      'target.deploymentSettings.environmentVars': Object.keys(ds.environmentVars || {}),
      'application.configuration': !!deployment.application?.configuration
    });

    res.json(deployment);
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
    const allEnvironments = envResponse.data.data || [];
    // Skip dev/qa environments entirely — no API calls made to them
    const environments = allEnvironments.filter(isProductionEnv);

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
          // CH2 has two status fields:
          // - app.status / app.desiredStatus = deployment status (APPLIED, DEPLOYING, etc.)
          // - app.application.status = actual runtime status (RUNNING, NOT_RUNNING, STOPPED, etc.)
          // Use the runtime status when available, fall back to deployment status
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
        // CH1 can return array or { applications: [...] }
        const raw = ch1Response.data;
        const ch1Apps = Array.isArray(raw) ? raw : (raw.applications || raw.data || []);
        ch1Apps.forEach((app) => {
          // Avoid duplicates if already found via CH2
          if (!results.find((r) => r.name === (app.domain || app.name))) {
            results.push({
              id: app.domain || app.name,
              name: app.domain || app.name,
              status: normalizeStatus(app.status),
              environment: { id: env.id, name: env.name, type: env.type },
              deploymentType: 'CloudHub 1.0',
              lastModifiedDate: app.lastUpdateTime ? new Date(app.lastUpdateTime).toISOString() : null,
              muleVersion: app.muleVersion?.version,
              workers: app.workers
            });
          }
        });
      } catch (e) {
        const ch1Status = e.response?.status;
        console.error(`CH1 ${env.name} (${ch1Status}):`, e.response?.data || e.message);
        errors.push(`CH1 ${env.name} (${ch1Status || 'ERR'}): ${e.response?.data?.message || e.message}`);
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