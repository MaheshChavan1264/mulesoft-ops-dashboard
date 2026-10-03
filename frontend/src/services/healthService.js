import api from './api';

/**
 * healthService.js
 *
 * Thin wrappers around the `/health/*` ping/credential-resolution endpoints
 * that were called directly via `api.post/get/delete` across
 * ApplicationDetailPage, BulkPingModal, PingTestPage, and PingTestPanel —
 * see FRONTEND_ARCHITECTURE_REVIEW.md §7 and §10's recommended folder
 * structure.
 *
 * Payload/param shapes are forwarded as-is (not re-derived here) since the
 * exact fields passed differ slightly per caller (e.g. optional `apiId` vs
 * `assetId`, optional `envType`/`envName`) and collapsing them into a fixed
 * signature risks dropping a field some caller actually relies on.
 */

/** POST /health/ping — run a single ping test. */
export async function pingApp(payload) {
  const { data } = await api.post('/health/ping', payload);
  return data;
}

/** POST /health/auto-credentials — resolve API Manager credentials for an app. */
export async function getAutoCredentials(payload) {
  const { data } = await api.post('/health/auto-credentials', payload);
  return data;
}

/** POST /health/auto-contract-creds — fallback contract-based credential lookup. */
export async function getAutoContractCreds(payload) {
  const { data } = await api.post('/health/auto-contract-creds', payload);
  return data;
}

/** POST /health/oauth2-token — exchange a tokenUrl + clientId/secret for a bearer token. */
export async function getOAuth2Token(payload) {
  const { data } = await api.post('/health/oauth2-token', payload);
  return data;
}

/** GET /health/ping/history — fetch stored ping history (optionally filtered). */
export async function getPingHistory(params) {
  const { data } = await api.get('/health/ping/history', params ? { params } : {});
  return data;
}

/** DELETE /health/ping/history — clear stored ping history (optionally filtered). */
export function clearPingHistory(params) {
  return api.delete('/health/ping/history', params ? { params } : {});
}
