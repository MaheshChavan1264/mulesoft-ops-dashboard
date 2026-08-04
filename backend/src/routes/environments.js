const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Get all environments for an org
router.get('/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/accounts/api/organizations/${req.params.orgId}/environments`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching environments:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch environments'
    });
  }
});

// Get environments for current org
router.get('/', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/accounts/api/organizations/${req.orgId}/environments`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching environments:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch environments'
    });
  }
});

module.exports = router;