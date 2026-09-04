import axiosClient from './axiosClient.js';
import * as mock from './mockData.js';

// ── Demo-mode helpers (re-exported for backwards compatibility) ───────────────
// Components that already import { isDemoMode } from '../services/api' continue
// to work unchanged. The canonical source is now src/utils/demoMode.js.
export { DEMO_MODE_KEY, isDemoMode, enableDemoMode, disableDemoMode } from '../utils/demoMode.js';
import { isDemoMode } from '../utils/demoMode.js';

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
  // CPS write operations (demo mode — simulate success)
  if (url === '/cps/write') return { success: true, method: 'PUT', projectKey: 'demo-app', propertyCount: 3 };
  if (url === '/cps/project') return { success: true, deleted: 'demo-app' };
  if (url === '/cps/auth' && params?.projectKey) return { properties: [{ key: params.projectKey, allowedClientIds: ['demo-client-id-1'], readOnlyClientIds: [] }] };
  if (url === '/cps/auth') return { success: true, allowedClientIds: ['demo-client-id-1'] };
  if (url === '/cps/credentials/test') return { valid: true, statusCode: 200, message: 'Demo mode — connected successfully' };
  if (url === '/cps/binary') return { success: true, uploaded: 'demo.jks', sizeBytes: 1024 };

  // BUG12-FIX: Graph dependencies mock — previously returned {} causing a
  // runtime crash because graph.nodes / graph.edges were undefined.
  if (url.startsWith('/graph/dependencies')) {
    return {
      nodes: [
        { id: 'app-demo-1', label: 'orders-exp-app', type: 'app', status: 'RUNNING', deploymentType: 'CH2', meta: { appId: 'demo-1', status: 'RUNNING', deploymentType: 'CH2' } },
        { id: 'app-demo-2', label: 'payments-prc-app', type: 'app', status: 'RUNNING', deploymentType: 'CH2', meta: { appId: 'demo-2', status: 'RUNNING', deploymentType: 'CH2' } },
        { id: 'app-demo-3', label: 'inventory-svc', type: 'app', status: 'FAILED', deploymentType: 'CH2', meta: { appId: 'demo-3', status: 'FAILED', deploymentType: 'CH2' } },
        { id: 'client-ext-portal', label: 'partner-portal', type: 'client', status: null, deploymentType: null, meta: { contractApp: 'partner-portal' } },
        { id: 'api-1001', label: 'orders-sapi', type: 'api', meta: { apiId: 1001, assetId: 'orders-sapi', assetVersion: '1.0.0' } },
        { id: 'api-1002', label: 'payments-sapi', type: 'api', meta: { apiId: 1002, assetId: 'payments-sapi', assetVersion: '2.1.0' } },
        { id: 'api-1003', label: 'inventory-sapi', type: 'api', meta: { apiId: 1003, assetId: 'inventory-sapi', assetVersion: '1.2.0' } },
      ],
      edges: [
        { id: 'app-demo-1->api-1001', source: 'app-demo-1', target: 'api-1001', contractStatus: 'APPROVED', appName: 'orders-exp-app', apiName: 'orders-sapi', slaTier: 'Gold' },
        { id: 'app-demo-1->api-1002', source: 'app-demo-1', target: 'api-1002', contractStatus: 'APPROVED', appName: 'orders-exp-app', apiName: 'payments-sapi', slaTier: '' },
        { id: 'app-demo-2->api-1002', source: 'app-demo-2', target: 'api-1002', contractStatus: 'APPROVED', appName: 'payments-prc-app', apiName: 'payments-sapi', slaTier: 'Silver' },
        { id: 'app-demo-3->api-1003', source: 'app-demo-3', target: 'api-1003', contractStatus: 'APPROVED', appName: 'inventory-svc', apiName: 'inventory-sapi', slaTier: '' },
        { id: 'client-ext-portal->api-1001', source: 'client-ext-portal', target: 'api-1001', contractStatus: 'APPROVED', appName: 'partner-portal', apiName: 'orders-sapi', slaTier: 'Bronze' },
      ],
      summary: { apis: 3, apps: 4, edges: 5, matched: 3, unmatched: 1 },
      debug: { apis: 3, ch2Apps: 3, ch1Apps: 0, contractsChecked: 3, contractsFetched: 5, contractErrors: [], edges: 5 },
    };
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

// ── Unified API facade ────────────────────────────────────────────────────────
// Wraps axiosClient with demo-mode short-circuiting.
// axiosClient (src/services/axiosClient.js) owns the HTTP config and interceptors;
// this facade owns the demo/real branching logic.
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
  },
  patch: async (url, data, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.patch(url, data, config);
  },
  put: async (url, data, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.put(url, data, config);
  },
};

export default api;