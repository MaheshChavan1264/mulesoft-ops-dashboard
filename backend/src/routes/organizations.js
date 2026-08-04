const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Recursively fetch an org and all its sub-organizations by ID
async function fetchOrgTree(client, orgId, visited = new Set()) {
  if (visited.has(orgId)) return null; // prevent cycles
  visited.add(orgId);

  try {
    const res = await client.get(`/accounts/api/organizations/${orgId}`);
    const org = res.data;

    const node = {
      id: org.id,
      name: org.name,
      domain: org.domain,
      type: org.type,
      parentId: org.parentId || null,
      ownerId: org.ownerId,
      createdAt: org.createdAt,
      updatedAt: org.updatedAt,
      subOrganizationIds: org.subOrganizationIds || []
    };

    return node;
  } catch (e) {
    console.error(`Failed to fetch org ${orgId}:`, e.response?.status, e.message);
    return null;
  }
}

async function fetchAllOrgs(client, rootOrgId) {
  const visited = new Set();
  const allOrgs = [];
  const queue = [rootOrgId];

  while (queue.length > 0) {
    const orgId = queue.shift();
    if (visited.has(orgId)) continue;

    const org = await fetchOrgTree(client, orgId, visited);
    if (org) {
      allOrgs.push(org);
      // Add children to the queue
      for (const childId of org.subOrganizationIds) {
        if (!visited.has(childId)) {
          queue.push(childId);
        }
      }
    }
  }

  return allOrgs;
}

// Get current organization
router.get('/', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(`/accounts/api/organizations/${req.orgId}`);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching organization:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch organization'
    });
  }
});

// Get all business groups (full hierarchy, flattened)
router.get('/business-groups', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);

    // First get the root org to find all subOrganizationIds
    const rootRes = await client.get(`/accounts/api/organizations/${req.orgId}`);
    const rootOrg = rootRes.data;

    // Build full flat list by BFS through the ID tree
    const allOrgs = await fetchAllOrgs(client, req.orgId);

    console.log(`Found ${allOrgs.length} business groups for org ${req.orgId}`);

    res.json({ total: allOrgs.length, data: allOrgs });
  } catch (error) {
    console.error('Error fetching business groups:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch business groups'
    });
  }
});

// Get a specific organization by ID
router.get('/:orgId', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(`/accounts/api/organizations/${req.params.orgId}`);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching organization:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch organization'
    });
  }
});

// Get users in an organization
router.get('/:orgId/members', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const { limit = 50, offset = 0 } = req.query;
    const response = await client.get(
      `/accounts/api/organizations/${req.params.orgId}/members?limit=${limit}&offset=${offset}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching org members:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch organization members'
    });
  }
});

module.exports = router;