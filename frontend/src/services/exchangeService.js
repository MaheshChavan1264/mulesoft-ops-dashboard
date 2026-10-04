import api from './api';

/**
 * exchangeService.js
 *
 * Thin wrappers around the `/exchange/*` endpoints called directly via
 * `api.get` from ExchangePage.jsx and ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §7 and §10's recommended folder structure.
 */

/** GET /exchange/search — paginated Exchange asset search. */
export function searchExchangeAssets(params) {
  return api.get('/exchange/search', { params });
}

/** GET /exchange/ping-spec — resolve the API spec (and ping-able endpoints) for an app by name. */
export function getExchangePingSpec(params) {
  return api.get('/exchange/ping-spec', { params });
}

/** GET /exchange/{groupId}/{assetId}/{version} — full Exchange asset detail. */
export function getExchangeAssetDetail(groupId, assetId, version) {
  return api.get(`/exchange/${groupId}/${assetId}/${version}`);
}
