const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Get environments for a specific org — filtered to only those the user has access to
router.get('/:orgId', authMiddleware, async (req, res) => {
  const targetOrgId = req.params.orgId;

  // Fast path: use pre-filtered accessible environments from session
  if (req.accessibleEnvironments && req.accessibleEnvironments[targetOrgId]) {
    const envs = req.accessibleEnvironments[targetOrgId];
    console.log(`Environments for ${targetOrgId} from session: ${envs.length}`);
    return res.json({ data: envs, total: envs.length });
  }

  // Fallback: fetch all environments from API
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/accounts/api/organizations/${targetOrgId}/environments`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching environments:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch environments'
    });
  }
});

// Get environments for the current (root) org
router.get('/', authMiddleware, async (req, res) => {
  const targetOrgId = req.orgId;

  // Fast path
  if (req.accessibleEnvironments && req.accessibleEnvironments[targetOrgId]) {
    const envs = req.accessibleEnvironments[targetOrgId];
    return res.json({ data: envs, total: envs.length });
  }

  // Fallback
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/accounts/api/organizations/${targetOrgId}/environments`
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