const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Fetch a client application's clientId from Exchange by numeric appId.
// Route uses a hyphenated prefix so it CANNOT be confused with /:orgId/:envId/:apiId.
router.get('/app-client-id/:appId', authMiddleware, async (req, res) => {
  const { appId } = req.params;
  // orgIds is a comma-separated list of org IDs to try in order
  // (app's masterOrgId, app's orgId, API Manager's orgId as fallback)
  const { orgIds = '', orgId } = req.query;

  const toTry = orgIds
    ? orgIds.split(',').map(o => o.trim()).filter(Boolean)
    : orgId ? [orgId] : [];

  if (toTry.length === 0) {
    return res.status(400).json({ error: 'orgIds or orgId query parameter is required' });
  }

  const client = createClient(req.anypointToken);

  for (const oid of toTry) {
    // Try 1: main application endpoint
    try {
      const r = await client.get(`/exchange/api/v2/organizations/${oid}/applications/${appId}`);
      const app = r.data;
      const clientId = app.clientId || app.client_id || null;
      if (clientId) {
        console.log(`[APIs] clientId resolved for appId ${appId} via org ${oid}`);
        return res.json({ id: app.id, name: app.name, clientId });
      }
    } catch (e1) {
      console.warn(`[APIs] Exchange app lookup failed (org ${oid}):`, e1.response?.status, e1.message);
    }

    // Try 2: explicit credentials sub-endpoint
    try {
      const r = await client.get(`/exchange/api/v2/organizations/${oid}/applications/${appId}/credentials`);
      const cred = r.data;
      const clientId = cred.clientId || cred.client_id || null;
      if (clientId) {
        console.log(`[APIs] clientId resolved for appId ${appId} via credentials endpoint (org ${oid})`);
        return res.json({ id: appId, name: null, clientId });
      }
    } catch (e2) {
      console.warn(`[APIs] Exchange credentials endpoint failed (org ${oid}):`, e2.response?.status, e2.message);
    }
  }

  // Nothing worked — return null clientId without error so UI gracefully shows "—"
  console.warn(`[APIs] Could not resolve clientId for appId ${appId} after trying orgs: ${toTry.join(', ')}`);
  res.json({ id: appId, name: null, clientId: null });
});

// Get all API instances for an environment
router.get('/:orgId/:envId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 50, offset = 0 } = req.query;
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis`,
      { params: { limit, offset } }
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching APIs:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API instances'
    });
  }
});

// Get a specific API instance
router.get('/:orgId/:envId/:apiId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching API:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API instance'
    });
  }
});

// Get policies applied to an API instance
router.get('/:orgId/:envId/:apiId/policies', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId } = req.params;
  const url = `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/policies`;
  console.log('[APIs] GET policies →', url);
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('[APIs] policies error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API policies',
      _debug: { orgId, envId, apiId, url }
    });
  }
});

// Get contracts for an API instance
router.get('/:orgId/:envId/:apiId/contracts', authMiddleware, async (req, res) => {
  const { orgId, envId, apiId } = req.params;
  const url = `/apimanager/api/v1/organizations/${orgId}/environments/${envId}/apis/${apiId}/contracts`;
  console.log('[APIs] GET contracts →', url);
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(url);
    res.json(response.data);
  } catch (error) {
    console.error('[APIs] contracts error:', error.response?.status, error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API contracts',
      _debug: { orgId, envId, apiId, url }
    });
  }
});

// Get SLA tiers for an API instance
router.get('/:orgId/:envId/:apiId/tiers', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}/tiers`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching SLA tiers:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch SLA tiers'
    });
  }
});

// Get API alerts
router.get('/:orgId/:envId/:apiId/alerts', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}/alerts`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching API alerts:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API alerts'
    });
  }
});

module.exports = router;