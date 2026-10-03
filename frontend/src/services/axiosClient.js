import axios from 'axios';
import { isDemoMode } from '../utils/demoMode.js';

// ── Centralized Axios client ──────────────────────────────────────────────────
// Single source of truth for:
//   • base URL  (/api — proxied by Vite in dev, same-origin in prod)
//   • session-cookie credentials  (withCredentials)
//   • default Content-Type header
//   • 401 → login redirect (skipped in demo mode and for per-resource endpoints)
//
// Extracted from api.js so any future service module can import and reuse this
// client without going through the demo-mode facade.

// Track whether a redirect is already in progress to avoid double-redirects
// from concurrent requests all returning 401 simultaneously.
let _redirecting = false;

// How long to suppress further redirect attempts after one fires, so that if
// the user navigates back (without a full page reload) and their session has
// expired again, the redirect fires again rather than staying stuck.
const REDIRECT_COOLDOWN_MS = 5000;

// Endpoints that return 401 for per-resource access issues (not session
// expiry) — don't redirect to login for those; let the caller handle the
// rejection instead.
const NO_REDIRECT_PATH_PATTERNS = [
  '/applications/summary', // BG access check (per-BG access)
  '/environments/',        // env fetch for __all__ or restricted BG
  '/cps/',                 // CPS credential issues
  '/exchange/',            // Exchange asset access
  '/apis/',                // API Manager access
];

const goToLogin = () => {
  _redirecting = true;
  setTimeout(() => { _redirecting = false; }, REDIRECT_COOLDOWN_MS);
  window.location.href = '/login';
};

const axiosClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isDemoMode() && !_redirecting) {
      const url = error.config?.url || '';
      const skipRedirect = NO_REDIRECT_PATH_PATTERNS.some((p) => url.includes(p));

      if (!skipRedirect) {
        goToLogin();
      } else if (!_redirecting) {
        // For skip-redirect URLs the 401 might be a per-resource access issue
        // OR a fully-expired session (e.g. server restarted while tab was open).
        // Do a lightweight session check and redirect to login only if the
        // session is truly gone, leaving per-resource 401s for the caller to
        // handle.
        axios.get('/api/auth/session', { withCredentials: true })
          .then((r) => {
            if (!r.data?.authenticated && !_redirecting) goToLogin();
          })
          .catch((sessionCheckError) => {
            // Distinguish "server actually told us we're unauthenticated"
            // (a response came back, just a bad one) from "the request never
            // reached the server at all" (network error / timeout — in that
            // case we must NOT redirect, since the user may simply be
            // offline or the backend may be mid-restart).
            if (sessionCheckError.response && !_redirecting) goToLogin();
          });
      }
    }
    return Promise.reject(error);
  }
);

export default axiosClient;