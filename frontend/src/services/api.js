import axios from 'axios';
import * as mock from './mockData.js';

export const DEMO_MODE_KEY = 'mulesoft_demo_mode';

export const isDemoMode = () => localStorage.getItem(DEMO_MODE_KEY) === 'true';
export const enableDemoMode = () => localStorage.setItem(DEMO_MODE_KEY, 'true');
export const disableDemoMode = () => localStorage.removeItem(DEMO_MODE_KEY);

// ── Mock response helper ─────────────────────────────────────────────────────
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));

const mockHandler = async (url, params) => {
  await delay();

  // Auth session
  if (url === '/auth/session') {
    return { authenticated: true, user: mock.MOCK_USER, orgId: 'demo-org-001', orgName: 'Demo Organization' };
  }
  if (url === '/auth/logout') return { success: true };

  // Environments
  if (url.startsWith('/environments')) {
    return { data: mock.MOCK_ENVIRONMENTS, total: mock.MOCK_ENVIRONMENTS.length };
  }

  // Applications summary
  if (url.startsWith('/applications/summary')) {
    return { data: mock.MOCK_APPS, total: mock.MOCK_APPS.length, environments: mock.MOCK_ENVIRONMENTS };
  }

  // Application detail
  if (url.startsWith('/applications/cloudhub2') || url.startsWith('/applications/cloudhub1')) {
    return mock.MOCK_APP_DETAIL;
  }

  // Business groups
  if (url.includes('/organizations/business-groups')) {
    return { data: mock.MOCK_BUSINESS_GROUPS, total: mock.MOCK_BUSINESS_GROUPS.length };
  }
  if (url.includes('/organizations/') && url.includes('/members')) {
    return { data: mock.MOCK_MEMBERS, total: mock.MOCK_MEMBERS.length };
  }
  if (url.startsWith('/organizations')) {
    return { data: mock.MOCK_BUSINESS_GROUPS[0] };
  }

  // Metrics
  if (url.startsWith('/metrics/summary')) {
    return { summary: mock.MOCK_METRICS };
  }

  // API Manager
  if (url.includes('/policies')) {
    return { policies: mock.MOCK_POLICIES };
  }
  if (url.startsWith('/apis')) {
    return { assets: mock.MOCK_APIS, total: mock.MOCK_APIS.length };
  }

  // CPS credentials
  if (url === '/cps/credentials') {
    return { credentials: { ch1_prod: { configured: false, source: 'none' }, ch2_prod: { configured: false, source: 'none' }, ch1_uat: { configured: false, source: 'none' }, ch2_uat: { configured: false, source: 'none' } } };
  }
  if (url.startsWith('/cps/fetch')) {
    return { properties: [{ key: 'demo-app', environment: 'prod', properties: { 'cps.projectName': 'demo-app', 'version': '1.0.0', 'api.base': '/api' } }] };
  }

  // Exchange
  if (url.startsWith('/exchange/org') && url.includes('/summary')) {
    return { assetCounts: mock.MOCK_EXCHANGE_SUMMARY };
  }
  if (url.startsWith('/exchange/search')) {
    const search = (params?.search || '').toLowerCase();
    const type = params?.type || '';
    let assets = mock.MOCK_EXCHANGE_ASSETS;
    if (search) assets = assets.filter((a) => a.name.toLowerCase().includes(search) || a.assetId.includes(search));
    if (type) assets = assets.filter((a) => a.type === type);
    return { assets, total: assets.length };
  }
  if (url.startsWith('/exchange')) {
    return mock.MOCK_EXCHANGE_ASSETS[0];
  }

  return {};
};

// ── Real axios client ────────────────────────────────────────────────────────
const axiosClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' }
});

// Track whether a redirect is already in progress to avoid double-redirects
// from concurrent requests all returning 401 simultaneously.
let _redirecting = false;

axiosClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !isDemoMode() && !_redirecting) {
      const url = error.config?.url || '';
      // Some endpoints return 401 for per-resource access issues (not session expiry).
      // Don't redirect to login for those — let the caller handle the rejection.
      const skipRedirect =
        url.includes('/applications/summary') ||  // BG access check (per-BG access)
        url.includes('/environments/')         ||  // env fetch for __all__ or restricted BG
        url.startsWith('/environments/')       ||  // same
        url.includes('/cps/')                  ||  // CPS credential issues
        url.includes('/exchange/')             ||  // Exchange asset access
        url.includes('/apis/');                    // API Manager access

      if (!skipRedirect) {
        _redirecting = true;
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ── Unified API facade ────────────────────────────────────────────────────────
const api = {
  get: async (url, config = {}) => {
    if (isDemoMode()) {
      const data = await mockHandler(url, config.params);
      return { data };
    }
    return axiosClient.get(url, config);
  },
  post: async (url, data, config = {}) => {
    if (isDemoMode()) {
      if (url === '/auth/logout') return { data: { success: true } };
      return { data: { success: true } };
    }
    return axiosClient.post(url, data, config);
  },
  delete: async (url, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.delete(url, config);
  }
};

export default api;