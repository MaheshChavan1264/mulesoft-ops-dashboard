const axios = require('axios');
const http = require('http');
const https = require('https');

const ANYPOINT_URL = process.env.ANYPOINT_PLATFORM_URL || 'https://anypoint.mulesoft.com';

// Shared keep-alive agents — reused across every createClient() call instead
// of each outbound Anypoint request paying a fresh TCP+TLS handshake. This
// backend does dozens (and for the Schedulers aggregate endpoint, hundreds)
// of parallel calls per request — e.g. the summary endpoint's per-environment
// CH1+CH2 fan-out, and the schedulers endpoint's one-call-per-app fan-out for
// orgs with hundreds/thousands of apps — so connection reuse compounds
// significantly there. maxSockets bounds concurrent connections per host so
// a single large fan-out can't exhaust ephemeral ports; raised from 50 to
// 100 so SCHEDULERS_FAN_OUT_CONCURRENCY (20 per org) × several orgs running
// concurrently (BG_FAN_OUT_CONCURRENCY on the frontend) doesn't queue at the
// socket-pool layer below what the fan-out concurrency settings allow.
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 100 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 100 });

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
