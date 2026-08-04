const express = require('express');
const axios = require('axios');
const router = express.Router();

const ANYPOINT_URL = process.env.ANYPOINT_PLATFORM_URL || 'https://anypoint.mulesoft.com';

// Login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const response = await axios.post(`${ANYPOINT_URL}/accounts/login`, {
      username,
      password
    });

    const { access_token, token_type } = response.data;

    // Get user profile
    const profileResponse = await axios.get(`${ANYPOINT_URL}/accounts/api/me`, {
      headers: { Authorization: `Bearer ${access_token}` }
    });

    const user = profileResponse.data.user;
    const orgId = user.organization.id;
    const orgName = user.organization.name;

    // Store in session
    req.session.token = access_token;
    req.session.orgId = orgId;
    req.session.orgName = orgName;
    req.session.username = username;
    req.session.user = {
      id: user.id,
      username: user.username,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      organization: { id: orgId, name: orgName }
    };

    res.json({
      success: true,
      user: req.session.user,
      orgId,
      orgName
    });
  } catch (error) {
    console.error('Login error:', error.response?.data || error.message);
    const status = error.response?.status || 500;
    const message = error.response?.data?.message || 'Login failed';
    res.status(status).json({ error: message });
  }
});

// Login with token (connected app / access token)
router.post('/token-login', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Access token is required' });
  }

  try {
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

    res.json({
      success: true,
      user: req.session.user,
      orgId,
      orgName
    });
  } catch (error) {
    console.error('Token login error:', error.response?.data || error.message);
    res.status(401).json({ error: 'Invalid access token' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true, message: 'Logged out successfully' });
});

// Session check
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