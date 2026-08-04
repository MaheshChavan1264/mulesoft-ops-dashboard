const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Search Exchange assets
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const {
      search = '',
      type,
      organizationId,
      offset = 0,
      limit = 20,
      sortBy = 'updatedAt',
      ascending = false
    } = req.query;

    const params = { offset, limit, sortBy, ascending };
    if (search) params.search = search;
    if (type) params.type = type;
    if (organizationId) params.organizationId = organizationId;

    const response = await client.get('/exchange/api/v2/assets', { params });
    res.json(response.data);
  } catch (error) {
    console.error('Error searching Exchange:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to search Exchange'
    });
  }
});

// Organization assets summary
router.get('/org/:orgId/summary', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const types = ['rest-api', 'soap-api', 'http-api', 'mule-application', 'mule-plugin', 'template', 'example'];
    const counts = {};

    await Promise.all(
      types.map(async (type) => {
        try {
          const response = await client.get('/exchange/api/v2/assets', {
            params: { organizationId: req.params.orgId, type, limit: 1 }
          });
          counts[type] = response.data.total || 0;
        } catch {
          counts[type] = 0;
        }
      })
    );

    res.json({ organizationId: req.params.orgId, assetCounts: counts });
  } catch (error) {
    console.error('Error fetching Exchange summary:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch Exchange summary'
    });
  }
});

// Get asset versions list — MUST be before /:groupId/:assetId/:version to avoid collision
router.get('/:groupId/:assetId/versions', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching asset versions:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch asset versions'
    });
  }
});

// Get a specific Exchange asset by version — keep AFTER /versions route
router.get('/:groupId/:assetId/:version', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}/${req.params.version}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching Exchange asset:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch Exchange asset'
    });
  }
});

module.exports = router;