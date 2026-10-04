import api from './api';

/**
 * authService.js
 *
 * Thin wrappers around the `/auth/*` endpoints called directly via
 * `api.get/post` from AuthContext.jsx — see FRONTEND_ARCHITECTURE_REVIEW.md
 * §7 and §10's recommended folder structure.
 */

/** GET /auth/session — check whether the current session is still authenticated. */
export function getSession() {
  return api.get('/auth/session');
}

/** POST /auth/login — username/password login. */
export function login(username, password) {
  return api.post('/auth/login', { username, password });
}

/** POST /auth/token-login — login via a pre-issued connected-app token. */
export function tokenLogin(token) {
  return api.post('/auth/token-login', { token });
}

/** POST /auth/connected-app-login — login via a connected app's clientId/secret. */
export function connectedAppLogin(clientId, clientSecret) {
  return api.post('/auth/connected-app-login', { clientId, clientSecret });
}

/** POST /auth/logout — end the current session. */
export function logout() {
  return api.post('/auth/logout');
}
