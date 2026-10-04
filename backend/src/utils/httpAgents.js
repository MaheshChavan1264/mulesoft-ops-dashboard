/**
 * Shared outbound HTTP(S) agents for calls that do NOT go to the main
 * Anypoint Platform API (which already has its own keep-alive agents in
 * `anypointClient.js` and talks to a publicly-trusted certificate).
 *
 * This module exists to fix two related problems:
 *
 *  1. Inconsistent TLS verification — CPS read routes (`/fetch`,
 *     `/search-user`) tolerated self-signed / internal-CA certs via a
 *     local `rejectUnauthorized: false` agent, while CPS write routes
 *     (`/write`, `/auth`, `/project`, `/binary`, `/credentials/test`) and
 *     some ping paths used axios' default agent (strict verification).
 *     The exact same CPS server could pass on a GET and fail on a PUT.
 *
 *  2. Inconsistent connection reuse — the write-path routes paid a fresh
 *     TCP+TLS handshake per call instead of reusing a keep-alive socket
 *     pool like the read-path routes already did.
 *
 * Both problems are fixed by funnelling every non-Anypoint outbound call
 * (CPS servers, ping targets, OAuth2 token endpoints) through the single
 * pair of agents built here.
 *
 * TLS trust: if `CPS_CA_CERT_PATH` (or `INTERNAL_CA_CERT_PATH`) points at a
 * PEM bundle for the internal/self-signed CA used by these internal hosts,
 * it is loaded and certificate verification stays ON. Without it, we fall
 * back to the previous behaviour (`rejectUnauthorized: false`) and log a
 * one-time warning so the trade-off is visible instead of silent.
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const config = require('../config');
const logger = require('./logger');

let warnedInsecure = false;

function buildSharedHttpsAgent() {
  const caPath = config.cpsCaCertPath;
  if (caPath) {
    try {
      const ca = fs.readFileSync(caPath);
      logger.info(`[httpAgents] Loaded internal CA bundle from ${caPath} — TLS verification ENABLED for CPS/ping/internal calls.`);
      return new https.Agent({ keepAlive: true, maxSockets: 50, ca });
    } catch (err) {
      logger.error({ err }, `[httpAgents] Failed to read CA bundle at ${caPath} — falling back to insecure mode`);
    }
  }
  if (!warnedInsecure) {
    warnedInsecure = true;
    logger.warn(
      '[httpAgents] WARNING: CPS_CA_CERT_PATH is not set — outbound CPS / health-ping / internal HTTPS calls ' +
      'run with TLS certificate verification DISABLED (rejectUnauthorized: false) to tolerate self-signed / ' +
      'internal-CA certs. Set CPS_CA_CERT_PATH to your internal CA bundle to re-enable verification.'
    );
  }
  return new https.Agent({ keepAlive: true, maxSockets: 50, rejectUnauthorized: false });
}

// Reused across every CPS / ping / internal outbound call in the backend —
// built once at module load so every caller shares the same socket pool.
const sharedHttpAgent = new http.Agent({ keepAlive: true, maxSockets: 50 });
const sharedHttpsAgent = buildSharedHttpsAgent();

module.exports = { sharedHttpAgent, sharedHttpsAgent };
