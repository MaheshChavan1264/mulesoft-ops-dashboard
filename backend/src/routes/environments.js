const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Get environments for a specific org — filtered to only those the user has access to
router.get('/:orgId', authMiddleware, async (req, res) => {
  const targetOrgId = req.params.orgId;

  // Fast path: use pre-filtered accessible environments from session
  if (req.accessibleEnvironments && req.accessibleEnvironments[targetOrgId]?.length > 0) {
    const envs = req.accessibleEnvironments[targetOrgId];
    console.log(`Environments for ${targetOrgId} from session: ${envs.length}`);
    return res.json({ data: envs, total: envs.length });
  }

  // If targetOrgId is the root org and has no direct envs in session,
  // return ALL accessible envs across all orgs
  if (targetOrgId === req.orgId && Object.keys(req.accessibleEnvironments).length > 0) {
    const allEnvs = Object.values(req.accessibleEnvironments).flat();
    const seen = new Set();
    const unique = allEnvs.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    if (unique.length > 0) return res.json({ data: unique, total: unique.length });
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

// Get environments for the current (root) org — returns ALL accessible envs across all orgs
router.get('/', authMiddleware, async (req, res) => {
  // Aggregate all accessible environments across every org in the session
  if (req.accessibleEnvironments && Object.keys(req.accessibleEnvironments).length > 0) {
    const allEnvs = Object.values(req.accessibleEnvironments).flat();
    // deduplicate by env id
    const seen = new Set();
    const unique = allEnvs.filter((e) => {
      if (seen.has(e.id)) return false;
      seen.add(e.id);
      return true;
    });
    return res.json({ data: unique, total: unique.length });
  }

  // Fallback: fetch for root org
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