const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

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
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}/policies`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching API policies:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API policies'
    });
  }
});

// Get contracts for an API instance
router.get('/:orgId/:envId/:apiId/contracts', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/apimanager/api/v1/organizations/${req.params.orgId}/environments/${req.params.envId}/apis/${req.params.apiId}/contracts`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching API contracts:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch API contracts'
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