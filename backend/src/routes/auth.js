const express = require('express');
const axios = require('axios');
const router = express.Router();

const ANYPOINT_URL = process.env.ANYPOINT_PLATFORM_URL || 'https://anypoint.mulesoft.com';

// Helper: fetch user profile and store session
async function storeSession(req, token) {
  const profileResponse = await axios.get(`${ANYPOINT_URL}/accounts/api/me`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const user = profileResponse.data.user;
  const orgId = user.organization.id;
  const orgName = user.organization.name;

  req.session.token = token;
  req.session.orgId = orgId;
  req.session.orgName = orgName;
  req.session.username = user.username;
  req.session.user = {
    id: user.id,
    username: user.username,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    organization: { id: orgId, name: orgName }
  };
  return { user: req.session.user, orgId, orgName };
}

// ── Username / Password ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const response = await axios.post(`${ANYPOINT_URL}/accounts/login`, { username, password });
    const { access_token } = response.data;
    const result = await storeSession(req, access_token);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Login failed. Check your credentials.'
    });
  }
});

// ── Access Token (paste from browser / CLI) ──────────────────────────────────
router.post('/token-login', async (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: 'Access token is required' });
  }
  try {
    const result = await storeSession(req, token.trim());
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Token login error:', error.response?.data || error.message);
    res.status(401).json({ error: 'Invalid or expired access token.' });
  }
});

// ── Connected App (OAuth 2.0 Client Credentials) ─────────────────────────────
router.post('/connected-app-login', async (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Client ID and Client Secret are required' });
  }
  try {
    // Exchange client credentials for an access token
    const tokenResponse = await axios.post(
      `${ANYPOINT_URL}/accounts/api/v2/oauth2/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const access_token = tokenResponse.data.access_token;
    if (!access_token) {
      return res.status(401).json({ error: 'No access token returned. Check your Connected App credentials.' });
    }

    const result = await storeSession(req, access_token);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Connected App login error:', error.response?.data || error.message);
    const msg = error.response?.data?.error_description
      || error.response?.data?.message
      || 'Connected App authentication failed. Check your Client ID and Secret.';
    res.status(error.response?.status || 401).json({ error: msg });
  }
});

// ── Logout ───────────────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out successfully' });
});

// ── Session Check ────────────────────────────────────────────────────────────
router.get('/session', (req, res) => {
  if (req.session && req.session.token) {
    res.json({
      authenticated: true,
      user: req.session.user,
      orgId: req.session.orgId,
      orgName: req.session.orgName
    });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;