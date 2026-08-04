const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Get current organization and sub-organizations (business groups)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(`/accounts/api/organizations/${req.orgId}/`);
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching organizations:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch organizations'
    });
  }
});

// Get all business groups (sub-organizations)
router.get('/business-groups', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    // Get the hierarchy of organizations
    const response = await client.get(`/accounts/api/organizations/${req.orgId}/`);
    const org = response.data;

    // Build a flat list of all orgs
    const allOrgs = [];
    const flatten = (o) => {
      allOrgs.push({
        id: o.id,
        name: o.name,
        domain: o.domain,
        type: o.type,
        parentId: o.parentId,
        ownerId: o.ownerId,
        createdAt: o.createdAt,
        updatedAt: o.updatedAt,
        subOrganizationIds: o.subOrganizationIds || []
      });
      if (o.subOrganizations) {
        o.subOrganizations.forEach(flatten);
      }
    };
    flatten(org);

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