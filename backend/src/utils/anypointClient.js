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
// a single large fan-out can't exhaust ephemeral ports.
//
// Raised from 100 to 150: on "All Organizations", the frontend's
// BG_FAN_OUT_CONCURRENCY (6 BGs in flight) × this backend's own
// SCHEDULERS_FAN_OUT_CONCURRENCY (20 apps in flight per BG, see
// routes/applications.js) can reach up to 120 concurrent Anypoint calls at
// once — right up against the old 100 cap, so requests queued silently
// inside the agent exactly when the fan-out was largest, adding latency the
// concurrency settings were supposed to avoid. 150 gives headroom above that
// 120 worst case without raising SCHEDULERS_FAN_OUT_CONCURRENCY itself
// (which would increase load on the Anypoint API and needs separate
// rate-limit testing — see the comment there).
const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 150 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 150 });

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
