const axios = require('axios');
const http = require('http');
const https = require('https');

const ANYPOINT_URL = process.env.ANYPOINT_PLATFORM_URL || 'https://anypoint.mulesoft.com';

// Shared keep-alive agents — reused across every createClient() call instead
// of each outbound Anypoint request paying a fresh TCP+TLS handshake. This
// backend does dozens of parallel calls per request (e.g. the summary
// endpoint's per-environment CH1+CH2 fan-out), so connection reuse compounds
// significantly there. maxSockets bounds concurrent connections per host so
// a single large fan-out can't exhaust ephemeral ports.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 50 });

const createClient = (token) => {
  return axios.create({
    baseURL: ANYPOINT_URL,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    timeout: 30000,
    httpAgent,
    httpsAgent,
  });
};

module.exports = { createClient, ANYPOINT_URL };
