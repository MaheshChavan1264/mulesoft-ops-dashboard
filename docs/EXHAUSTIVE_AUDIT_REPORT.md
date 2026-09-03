# 🔍 Exhaustive Codebase Audit Report — MuleSoft Dashboard

> **Generated:** September 2026  
> **Auditor:** MuleSoft Developer Agent  
> **Repository:** `mulesoft-dashboard`  
> **Commit:** `14dd0c7`

---

## 📁 1. Scope Analyzed

### Root
| File | Purpose |
|---|---|
| `README.md` | Project overview & setup instructions |
| `jsconfig.json` | JS path alias config |
| `.gitignore` / `.gitattributes` | VCS hygiene |

### Backend (`backend/`)
| File | Purpose |
|---|---|
| `src/server.js` | Express entry point, route mounting, CORS, middleware |
| `src/middleware/authMiddleware.js` | Token extraction from `x-session-token` header |
| `src/utils/anypointClient.js` | Central Axios client for Anypoint Platform API |
| `src/utils/appHelpers.js` | Application enrichment & pagination helpers |
| `src/utils/exchangeHelpers.js` | Exchange search/detail helpers |
| `src/utils/orgHelpers.js` | Organisation & environment fetch helpers |
| `src/utils/responseHelpers.js` | Standardised `sendSuccess` / `sendError` / `handleRouteError` |
| `src/routes/auth.js` | Login, logout, `/me` endpoints |
| `src/routes/organizations.js` | Org list + environments per org |
| `src/routes/environments.js` | Duplicate environment listing |
| `src/routes/applications.js` | CloudHub 2 / RTF application CRUD + restart |
| `src/routes/apis.js` | API Manager asset listing across orgs/envs |
| `src/routes/exchange.js` | Exchange asset search + detail |
| `src/routes/health.js` | HTTP ping test (sequential + parallel modes) |
| `src/routes/metrics.js` | Application metrics fetch |
| `src/routes/cps.js` | Connected Properties Service CRUD + binary upload |
| `backend/.env.example` | Environment variable template |

### Frontend (`frontend/`)
| Area | Files |
|---|---|
| **Entry** | `src/main.jsx`, `src/App.jsx`, `src/index.css` |
| **Pages (9)** | `LoginPage`, `ApplicationsPage`, `ApplicationDetailPage`, `ApiManagerPage`, `ExchangePage`, `PingTestPage`, `UserSearchPage`, `CpsManagerPage`, `CpsComparisonPage` |
| **Components (24)** | `Header`, `Sidebar`, `Layout`, `StatusBadge`, `CopyBtn`, `Tooltip`, `Select`, `BgFilterModal`, `EnvFilterModal`, `PingTestPanel`, `PingResultCard`, `AttemptLog`, `CredentialImportButton`, `CpsAuthPanel`, `CpsBinaryUploadPanel`, `CpsCreateModal`, `CpsCredentialImportButton`, `CpsCredTestButton`, `CpsDeleteProjectModal`, `CpsExportModal`, `CpsImportModal`, `CpsRequestResponsePanel`, `CpsSettingsModal` |
| **Contexts (5)** | `AuthContext`, `CredentialStoreContext`, `CpsCredentialStoreContext`, `NotificationContext`, `ToastContext` |
| **Services (3)** | `api.js`, `apiCache.js`, `mockData.js` |
| **Utils (5)** | `appUtils.js`, `cpsHelpers.js`, `csvCredentialStore.js`, `exportCps.js`, `filterUtils.js` |
| **Config** | `vite.config.js`, `tailwind.config.js`, `postcss.config.js` |

---

## ⚠️ 2. Code Quality & Duplication Refactor

---

### 2.1 Backend — `src/server.js`

| # | Severity | Issue |
|---|---|---|
| B-01 | 🔴 High | No global Express error handler registered at the end of the middleware chain. Unhandled thrown errors in route handlers produce an empty 500 or hang indefinitely. |
| B-02 | 🟡 Medium | No `helmet` middleware — missing security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`. |
| B-03 | 🟡 Medium | No `compression` middleware — JSON responses for large application lists are sent uncompressed, wasting bandwidth on every request. |
| B-04 | 🟡 Medium | No request logger (`morgan` or equivalent) — no structured access log exists for debugging production issues. |
| B-05 | 🟡 Medium | CORS `origin` is partially env-driven (`FRONTEND_URL`) but falls back to the hardcoded string `'http://localhost:5173'`. A production deployment pointing to a real domain will fall through to the dev default. |
| B-06 | 🟢 Low | No `express-rate-limit` on any endpoint. The `/api/login` route is vulnerable to credential brute-force attacks. |

**Recommended additions to `server.js`:**
```js
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import rateLimit from 'express-rate-limit';

app.use(helmet());
app.use(morgan('combined'));
app.use(compression());

// Brute-force guard on auth
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/login', authLimiter);

// ── Must be the VERY LAST app.use ──
app.use((err, req, res, _next) => {
  console.error('[GlobalError]', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});
```

---

### 2.2 Backend — `src/middleware/authMiddleware.js`

| # | Severity | Issue |
|---|---|---|
| B-07 | 🟡 Medium | Middleware only extracts `x-session-token` and attaches it to `req.token` with no emptiness check. A request with an absent or empty header proceeds to the route handler with `req.token = undefined`, producing a cryptic downstream Anypoint 401 rather than an immediate, clear `401 Unauthorized` from the middleware itself. |
| B-08 | 🟢 Low | No logging of failed / missing token attempts. Security events (IP address, route, timestamp) should be written to an audit log. |

**Corrected implementation:**
```js
export function authMiddleware(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token || typeof token !== 'string' || token.trim() === '') {
    console.warn(`[Auth] No token — ${req.method} ${req.path} ${req.ip}`);
    return res.status(401).json({ error: 'Authentication required' });
  }
  req.token = token.trim();
  next();
}
```

---

### 2.3 Backend — `src/utils/anypointClient.js`

| # | Severity | Issue |
|---|---|---|
| B-09 | 🟡 Medium | No retry logic for transient Anypoint errors. A single 502/503 or network hiccup causes the entire user-facing request to fail. `axios-retry` with exponential backoff would recover silently from transient failures. |
| B-10 | 🟡 Medium | `BASE_URL` is hardcoded to `'https://anypoint.mulesoft.com'` inside the module, ignoring the `ANYPOINT_BASE_URL` env var that is declared (but never read) in `.env.example`. PCE/GOV customers cannot override the base URL without modifying source code. |
| B-11 | 🟢 Low | No circuit breaker. Under "All Organizations" bulk fetches, if Anypoint is degraded, all concurrent fan-out requests will wait for the full Axios timeout, blocking the Node.js event loop thread pool. |

**Fixes:**
```js
// Read base URL from environment (B-10)
const BASE_URL = process.env.ANYPOINT_BASE_URL || 'https://anypoint.mulesoft.com';

// Add after axios instance creation (B-09)
import axiosRetry from 'axios-retry';
axiosRetry(anypointAxios, {
  retries: 3,
  retryDelay: axiosRetry.exponentialDelay,
  retryCondition: (err) =>
    axiosRetry.isNetworkOrIdempotentRequestError(err) ||
    err.response?.status === 429 ||
    (err.response?.status >= 500 && err.response?.status < 600),
});
```

---

### 2.4 Backend — `src/utils/responseHelpers.js`

| # | Severity | Issue |
|---|---|---|
| B-12 | 🟡 Medium | `handleRouteError` always responds with HTTP 500 regardless of the Anypoint error status code. When a user's session token expires mid-use, the response is `500 Internal Server Error` instead of `401 Unauthorized`, so the frontend cannot distinguish token expiry from a real server fault and cannot auto-redirect to the login page. |
| B-13 | 🟢 Low | No correlation ID (`x-request-id`) is generated, logged, or forwarded. Tracing a specific failing request across simultaneous calls is impossible. |

**Corrected `handleRouteError`:**
```js
export function handleRouteError(res, err, context = '') {
  const status = err.response?.status;
  if (status === 401 || status === 403) {
    return res.status(status).json({
      error: 'Anypoint Platform authentication failed or insufficient permissions',
    });
  }
  console.error(`[RouteError] ${context}:`, err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
}
```

---

### 2.5 Backend — `src/routes/environments.js` ↔ `src/routes/organizations.js` — **Duplicate Route**

`routes/environments.js` exposes `GET /api/environments/:orgId/environments` which performs the **exact same Anypoint API call** as `GET /api/organizations/:orgId/environments` in `routes/organizations.js`. Both delegate to the same `orgHelpers` function.

This means two maintained code paths return identical data, doubling the risk of divergence when the Anypoint Environments API changes.

**Action:** Delete `routes/environments.js` and its `app.use('/api/environments', ...)` mount in `server.js`. All frontend callers that currently call `/api/environments/...` must be updated to `/api/organizations/:orgId/environments`. Audit `src/services/api.js` with a grep for `'/api/environments'` to find all call sites.

---

### 2.6 Backend — `src/routes/applications.js` + `src/routes/apis.js` — **Duplicated Fan-Out Logic**

Both route files implement an identical multi-step "fan out across all business groups and all environments" pattern with `Promise.allSettled`. The shape of the duplicated code is:

```js
// Appears in applications.js AND apis.js
const orgs = await fetchAllOrgs(token);
const results = await Promise.allSettled(
  orgs.flatMap(org =>
    org.environments.map(env => fetchXxx(token, org.id, env.id))
  )
);
const items = results
  .filter(r => r.status === 'fulfilled')
  .flatMap(r => r.value ?? []);
```

**Recommended abstraction — `src/utils/fanOut.js`:**
```js
/**
 * Fan out an async task across every org × env pair.
 * @param {string} token
 * @param {(orgId: string, envId: string, envName: string) => Promise<any[]>} task
 * @returns {Promise<any[]>}
 */
export async function fanOut(token, task) {
  const orgs = await fetchAllOrgs(token);
  const settled = await Promise.allSettled(
    orgs.flatMap(org =>
      org.environments.map(env => task(org.id, env.id, env.name))
    )
  );
  return settled
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value ?? []);
}
```

This single abstraction eliminates ~40 lines of duplicated code across two route files and will also benefit `metrics.js` if it adopts the same pattern in the future.

---

### 2.7 Backend — `src/routes/cps.js` — **Monolithic Route File**

| # | Severity | Issue |
|---|---|---|
| B-14 | 🔴 High | `cps.js` handles 10+ distinct operations in a single file: listing projects, fetching namespaces, reading/writing/deleting non-secure and secure properties, uploading binary assets, credential testing, and project deletion. The file is too large to maintain safely. |
| B-15 | 🟡 Medium | `multer` disk/memory storage is configured inline inside the route handler. It should be extracted to `src/config/upload.js` so any future route that needs file upload can share the configuration and limits. |
| B-16 | 🟡 Medium | The binary upload endpoint does not validate MIME type or enforce a maximum file size. An attacker (or a misconfigured client) can submit arbitrarily large payloads, exhausting server memory. |
| B-17 | 🟢 Low | Inline anonymous transformation functions (e.g., mapping CPS API response shapes to dashboard-friendly objects) are defined inside `router.get(...)` callbacks. These belong in a `cpsService.js` or `cpsHelpers.js` utility module. |

**Recommended split:**
```
backend/src/
  controllers/cpsController.js   ← orchestrates service calls, formats responses
  services/cpsService.js         ← raw Anypoint CPS HTTP calls
  config/upload.js               ← multer config with size limits + MIME filter
  routes/cps.js                  ← thin router: validates params, calls controller
```

---

### 2.8 Backend — `src/routes/health.js`

| # | Severity | Issue |
|---|---|---|
| B-18 | 🟡 Medium | The `pingPaths` array (`['/api/v1/ping', '/api/v2/ping', '/api/ping', '/ping']`) is embedded as an inline literal inside the route handler. It should be a named exported constant, and the request body should be able to supply `customPaths: string[]` to override it for non-standard Mule apps. |
| B-19 | 🟡 Medium | `httpsAgent: new https.Agent({ rejectUnauthorized: false })` is applied unconditionally to every ping request without an explanatory comment. This disables TLS verification globally for all targets. Gate it behind a `PING_ALLOW_SELF_SIGNED=true` environment variable and log a warning when it is active. |
| B-20 | 🟢 Low | No per-attempt request timeout is configured. If a target server accepts the TCP connection but never responds, the ping request hangs until the Node.js default socket timeout (~2 min), blocking a handler slot. Add `timeout: 10_000` to each attempt's Axios config. |

---

### 2.9 Backend — `src/utils/appHelpers.js`

| # | Severity | Issue |
|---|---|---|
| B-21 | 🟢 Low | `buildAppFilters` parses raw query-string parameters without an allowlist check. Callers could inject unexpected keys that propagate unvalidated into downstream Anypoint API calls. |
| B-22 | 🟢 Low | `enrichApplicationWithDetails` uses `Promise.all([details, metrics, logs])`. If the non-critical `getLogs` call throws, the entire enrichment rejects and the application card shows no data at all. Replace with `Promise.allSettled` and gracefully handle partial failures. |

---

### 2.10 Frontend — `src/services/api.js` — **Largest DRY Violation**

| # | Severity | Issue |
|---|---|---|
| F-01 | 🔴 High | Every API function reads `sessionStorage.getItem('anypointToken')` and manually builds `{ headers: { 'x-session-token': token } }`. This boilerplate appears **50+ times**. A single shared Axios instance with a `request` interceptor eliminates it entirely. |
| F-02 | 🔴 High | Error handling is inconsistent across functions: some `throw`, some `return null`, some `return []`, some `return {}`. Call sites must each implement their own defensive fallback, spreading error-handling logic across the entire component tree. |
| F-03 | 🟡 Medium | No request cancellation. Rapid Business Group switches trigger simultaneous in-flight requests that race. Stale responses from earlier requests can overwrite the data from the most recent call. Use `AbortController` per fetch and cancel the previous one when a new one starts. |
| F-04 | 🟡 Medium | The base URL string `${import.meta.env.VITE_API_URL}/api` is constructed inline in every function. 50+ hard-coded `/api` prefixes means a future path change requires find-and-replace across the whole file. |
| F-05 | 🟢 Low | No runtime response shape validation. API schema drift from the Anypoint side will silently produce `undefined` access errors deep inside components rather than a clear, catchable API error. |

**Recommended `src/services/axiosClient.js`:**
```js
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: `${import.meta.env.VITE_API_URL}/api`,
});

// Inject token on every request — eliminates F-01
apiClient.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('anypointToken');
  if (token) config.headers['x-session-token'] = token;
  return config;
});

// Uniform error handling — eliminates F-02
apiClient.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    if (status === 401 || status === 403) {
      // Trigger global logout
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
    return Promise.reject(err);
  }
);
```

All functions in `api.js` then become:
```js
export async function getApplications(orgId, envId) {
  const { data } = await apiClient.get('/applications', { params: { orgId, envId } });
  return data;
}
```

---

### 2.11 Frontend — `src/context/CredentialStoreContext.jsx` ↔ `src/context/CpsCredentialStoreContext.jsx` — **Near-Identical Contexts**

These two context files manage credential stores for (a) the general ping-test flow and (b) the CPS Manager flow respectively. The internal state shape, the `importFromCsv`, `getCredentials`, and `clear` methods, and the context/provider JSX are structurally **identical** — differing only in variable names and the `storageKey`.

**DRY fix — parameterised factory hook `src/hooks/useCredentialStore.js`:**
```js
import { useState, useCallback } from 'react';
import { parseCredentialCsv } from '../utils/csvCredentialStore';

export function useCredentialStore() {
  const [store, setStore] = useState(new Map());

  const importFromCsv = useCallback((file) => {
    parseCredentialCsv(file).then((entries) => {
      setStore(new Map(entries.map((e) => [e.clientId, e])));
    });
  }, []);

  const getCredential = useCallback((clientId) => store.get(clientId), [store]);

  const clear = useCallback(() => setStore(new Map()), []);

  return { store, importFromCsv, getCredential, clear, size: store.size };
}
```

Both `CredentialStoreContext` and `CpsCredentialStoreContext` then simply wrap this hook in a context provider with their respective context name — eliminating ~120 lines of duplication.

---

### 2.12 Frontend — `src/context/NotificationContext.jsx` ↔ `src/context/ToastContext.jsx` — **Redundant Notification Systems**

The app ships two separate notification systems:
- `NotificationContext` — manages a persistent notification list
- `ToastContext` — manages transient toast pop-ups

Components inconsistently import from one or the other, or from both. Two separate systems means two separate state trees, two separate portal render points, and two separate sets of styling rules.

**Recommendation:** Consolidate into a single `NotificationContext` that handles both persistent alerts and transient toasts via a `variant` field (`'toast' | 'alert'`). Toasts auto-dismiss after a configurable TTL; alerts persist until explicitly dismissed.

---

### 2.13 Frontend — `src/components/BgFilterModal.jsx` ↔ `src/components/EnvFilterModal.jsx` — **Duplicate Modal Pattern**

Both modals share an identical structural pattern:
- A backdrop overlay `div`
- A centred card with a header, a searchable checkbox list, and a footer with Apply/Clear/Cancel buttons
- Local state for a `search` string and a `selected` Set

The only differences are the item type (Business Group vs Environment) and the display label field.

**DRY fix — generic `src/components/FilterModal.jsx`:**
```jsx
export function FilterModal({ title, items, labelKey, selected, onApply, onClose }) {
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState(new Set(selected));
  const filtered = items.filter(i => i[labelKey].toLowerCase().includes(search.toLowerCase()));
  // ... render once, reuse everywhere
}
```

Replace both `BgFilterModal` and `EnvFilterModal` with:
```jsx
<FilterModal title="Filter Business Groups" items={orgs} labelKey="name" ... />
<FilterModal title="Filter Environments"    items={envs} labelKey="name" ... />
```

---

### 2.14 Frontend — `src/services/apiCache.js` — **Missing Cache Invalidation & Size Cap**

| # | Severity | Issue |
|---|---|---|
| F-06 | 🟡 Medium | The in-memory cache is never cleared on logout. After a user logs out and a new user logs in (e.g., in a shared-dashboard scenario), the second user sees the first user's cached API responses until the TTL expires. `AuthContext.logout()` must call `apiCache.clear()`. |
| F-07 | 🟢 Low | The cache has no maximum entry count. A long-running session that queries many different org/env combinations will silently grow without bound, eventually exhausting browser memory. Add a max size with LRU eviction. |

---

### 2.15 Frontend — `src/App.jsx` — **No Code Splitting or Error Boundaries**

| # | Severity | Issue |
|---|---|---|
| F-08 | 🟡 Medium | All 9 page components are imported eagerly at the top of `App.jsx`. The entire application JavaScript bundle is loaded before the user sees the login screen. Use `React.lazy` + `Suspense` for route-level code splitting to reduce initial load time. |
| F-09 | 🟡 Medium | No `<ErrorBoundary>` wraps the route tree. An unhandled JavaScript error in any single page component (e.g., a `TypeError` from unexpected API data) will unmount the entire React tree, showing a blank white screen with no recovery path. |

**Fix for F-08 in `App.jsx`:**
```jsx
const ApplicationsPage    = lazy(() => import('./pages/ApplicationsPage'));
const ApplicationDetailPage = lazy(() => import('./pages/ApplicationDetailPage'));
// ... etc.

<Suspense fallback={<PageSkeleton />}>
  <Routes>...</Routes>
</Suspense>
```

**Fix for F-09 — `src/components/ErrorBoundary.jsx`:**
```jsx
class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError)
      return <ErrorPage error={this.state.error} onReset={() => this.setState({ hasError: false })} />;
    return this.props.children;
  }
}
```

---

### 2.16 Frontend — `src/pages/ApplicationsPage.jsx` — **Unbounded State & Missing Optimisations**

| # | Severity | Issue |
|---|---|---|
| F-10 | 🟡 Medium | The search/filter state is managed with 5–6 individual `useState` calls. Every single-character keystroke in the search box triggers a component re-render. Consolidate into a single `useReducer` and add `useDeferredValue` (React 18) or a 300 ms `debounce` on the search input to avoid blocking renders. |
| F-11 | 🟡 Medium | Table row event handlers (expand row, select row, restart app) are recreated on every render because they are defined as inline arrow functions. Wrap with `useCallback` and pass stable references. |
| F-12 | 🟢 Low | The application list is rendered as a flat array map without `React.memo` on the row component. On every filter or selection change, all visible rows re-render even if their data did not change. Extract a memoised `AppTableRow` component. |

---

### 2.17 Frontend — `src/pages/CpsManagerPage.jsx` — **God Component**

`CpsManagerPage` is the largest component in the frontend. It manages:
- Project list fetch and display
- Selected project / namespace / property state
- All CRUD modal visibility flags (6+ boolean `useState` calls for modals)
- Inline credential resolution logic
- Binary file upload orchestration

| # | Severity | Issue |
|---|---|---|
| F-13 | 🔴 High | Modal open/close state is managed as 6+ independent `boolean` `useState` flags (`isCreateModalOpen`, `isDeleteModalOpen`, `isImportModalOpen`, etc.). A single `useState<string \| null>(null)` that holds the name of the currently open modal is cleaner, type-safe, and scales to new modals without adding new state. |
| F-14 | 🟡 Medium | Property fetch and namespace fetch logic lives inside the page component rather than in a custom hook. Extract a `useCpsProject(projectKey)` hook that encapsulates all data-fetching side effects for a selected project. |

---

### 2.18 Frontend — `src/utils/appUtils.js` ↔ `src/components/StatusBadge.jsx` — **Status Logic Duplication**

`appUtils.js` contains a `getStatusColor(status)` function. `StatusBadge.jsx` contains its own inline `status → class` mapping object. The two mappings must be kept in sync manually whenever a new status string is added.

**Fix:** Move the canonical status → Tailwind class mapping into `appUtils.js` as a named export (`STATUS_COLORS`). `StatusBadge.jsx` imports and uses it, eliminating the parallel definition.

---

### 2.19 Frontend — `src/utils/csvCredentialStore.js` — **No Input Validation**

The CSV parser does not validate:
- That required columns (`clientId`, `clientSecret`) are present
- That rows are non-empty after trimming
- That `clientId` values are unique (duplicates silently overwrite)

A malformed CSV is loaded silently, causing confusing downstream failures during ping runs when credentials are not found.

**Fix:** Add validation that throws descriptive errors (e.g., `"CSV is missing required column: clientSecret"`) before populating the store.

---

### 2.20 Frontend — Missing `PropTypes` / TypeScript Across All Components

None of the 24 components or 9 pages define `PropTypes` or TypeScript interfaces. There is no compile-time or runtime prop validation anywhere in the frontend.

**Impact:** Prop name typos, missing required props, and incorrect prop types all fail silently, producing hard-to-debug `undefined` errors deep in the render tree.

**Recommendation:** Either add `PropTypes` to every component as a short-term fix, or migrate the frontend to TypeScript (the `jsconfig.json` already has `"checkJs": true`, indicating TypeScript migration is intended).

---

## 🎨 3. UI/UX Enhancements

---

### 3.1 Loading States — Replace Spinners with Skeleton Screens

**Current:** Most pages show a single centered spinner or the text "Loading…" while data is fetched.

**Problem:** A bare spinner with no layout context causes significant layout shift when data arrives. It gives users no information about what is loading or how much.

**Recommended:** Implement skeleton loaders that mirror the shape of the actual content:

| Page | Current | Recommended |
|---|---|---|
| `ApplicationsPage` | Full-page spinner | Table skeleton: 10 grey animated rows with placeholder cells for name, badge, env, date |
| `ApplicationDetailPage` | Spinner inside each tab | Tab-content skeleton that matches the specific tab layout (key-value pairs for Properties, metric cards for Overview) |
| `ApiManagerPage` | Spinner | Accordion skeleton rows |
| `CpsManagerPage` | Spinner | Two-column skeleton (project list + property table) |
| `ExchangePage` | Spinner | Card-grid skeleton |

**Implementation:** A single reusable `Skeleton` component:
```jsx
// src/components/Skeleton.jsx
export function Skeleton({ className = '' }) {
  return <div className={`animate-pulse bg-gray-700 rounded ${className}`} />;
}

// Usage in ApplicationsPage loading state:
{loading && Array.from({ length: 10 }).map((_, i) => (
  <tr key={i}>
    <td><Skeleton className="h-4 w-40" /></td>
    <td><Skeleton className="h-5 w-16 rounded-full" /></td>
    <td><Skeleton className="h-4 w-24" /></td>
    <td><Skeleton className="h-4 w-20" /></td>
  </tr>
))}
```

---

### 3.2 Empty States — Add Instructional Empty State Panels

**Current:** When filters produce zero results, most pages show a blank table body or nothing at all.

**Recommended:** Each page/table should have a distinct empty-state panel:

```jsx
// src/components/EmptyState.jsx
export function EmptyState({ icon, title, description, action }) {
  return (
    <div className="flex flex-col items-center py-16 text-center text-gray-400">
      <span className="text-5xl mb-4">{icon}</span>
      <p className="text-lg font-semibold text-gray-300">{title}</p>
      <p className="text-sm mt-1 max-w-xs">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
```

| Page | Empty trigger | Suggested copy |
|---|---|---|
| `ApplicationsPage` | No apps match filters | "No applications match your filters. Try clearing the status or environment filter." + `[Clear Filters]` button |
| `ApiManagerPage` | No APIs found | "No API instances found in this environment." |
| `PingTestPage` | No prior ping run | "Run a ping test from the Applications page to see results here." + `[Go to Applications]` button |
| `ExchangePage` | No assets | "No Exchange assets found. Try a different search term or asset type." |
| `CpsManagerPage` | No projects | "No CPS projects found. Create a new project to get started." + `[New Project]` button |

---

### 3.3 Error Banners — Distinguish Error Types with Actionable Messages

**Current:** Errors are typically shown as a generic red text string (e.g., "Error loading applications") with no recovery action.

**Recommended:** A structured `ErrorBanner` component that shows context-appropriate recovery actions:

```jsx
// src/components/ErrorBanner.jsx
export function ErrorBanner({ error, onRetry, onLogin }) {
  const is401 = error?.response?.status === 401 || error?.status === 401;
  return (
    <div className="flex items-start gap-3 bg-red-900/40 border border-red-700 rounded-lg p-4 text-red-300">
      <span className="text-xl">⚠️</span>
      <div className="flex-1">
        <p className="font-semibold">{is401 ? 'Session expired' : 'Failed to load data'}</p>
        <p className="text-sm mt-1">
          {is401 ? 'Your Anypoint session has expired.' : error?.message || 'An unexpected error occurred.'}
        </p>
      </div>
      {is401
        ? <button onClick={onLogin} className="btn-sm btn-red">Log in again</button>
        : <button onClick={onRetry} className="btn-sm btn-red">Retry</button>
      }
    </div>
  );
}
```

---

### 3.4 StatusBadge — Improve Contrast & Add Pulse Animation

**Current:** `StatusBadge` uses Tailwind colour classes but some status combinations (e.g., `PARTIALLY_STARTED` on a dark background) have WCAG contrast ratios below 4.5:1.

**Recommendations:**
1. Add `role="status"` and `aria-label={status}` to every badge for screen-reader accessibility.
2. Add a subtle animated pulse dot for `DEPLOYING` and `PARTIALLY_STARTED` states to communicate in-progress activity without requiring a manual page refresh.
3. Ensure all badge colour combinations meet WCAG AA (4.5:1 contrast ratio). Specifically, yellow badges (`bg-yellow-500 text-yellow-900`) should use `text-black` for maximum legibility.

**Before:**
```jsx
<span className="px-2 py-0.5 rounded text-xs bg-yellow-500 text-yellow-900">
  DEPLOYING
</span>
```

**After:**
```jsx
<span
  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium bg-yellow-500 text-black"
  role="status"
  aria-label={`Status: ${status}`}
>
  <span className="w-1.5 h-1.5 rounded-full bg-black animate-pulse" />
  DEPLOYING
</span>
```

---

### 3.5 ApplicationsPage — Inline Quick-Filter Chip Bar

**Current:** Filtering requires opening the Business Group selector (dropdown) and the Environment selector (dropdown) separately. Status and deployment-type filters are additional dropdowns.

**Recommended:** Add a horizontal quick-filter chip bar below the search input showing all active filters as removable chips. Each chip has an `×` to clear that single filter, and a "Clear all" link clears everything at once.

```
[ 🔍 Search apps... ]  [BG: My Team ×]  [Env: Production ×]  [Status: RUNNING ×]  Clear all
```

This pattern dramatically reduces the number of click interactions needed to adjust a multi-filter view.

---

### 3.6 ApplicationDetailPage — Sticky Tab Bar

**Current:** On the Application Detail page, the 6 tab labels scroll off screen on smaller viewports when the tab content is long.

**Recommendation:** Make the tab bar `position: sticky; top: 0; z-index: 10` with a backdrop blur so it remains accessible while scrolling through long tab content (especially the Raw JSON and Properties tabs).

---

### 3.7 CpsComparisonPage — Inline Word-Diff Highlighting in Table

**Current:** The diff table shows values in plain text cells. To see a word-level diff, the user must click a row to open a modal.

**Recommendation:** For short values (under 80 characters), render the inline word diff directly in the table cell without requiring a modal click. Reserve the modal for long-value diffs. This makes the comparison table scannable at a glance for the common case of small property changes.

---

### 3.8 Ping Test Results — Latency Sparkline Column

**Current:** Latency is shown as a single number in milliseconds, colour-coded green/yellow/red.

**Recommendation:** If a ping is retried across multiple paths, the attempt latencies are available in the `attempts` array. Render a mini 4-bar sparkline (using a tiny inline SVG or the existing `recharts` dependency) showing the latency of each attempted path. This instantly conveys whether latency degraded across retries.

---

### 3.9 Global — Keyboard Shortcuts

None of the pages implement keyboard shortcuts. For a dashboard used by platform engineers daily, keyboard efficiency is critical.

| Shortcut | Action |
|---|---|
| `/` | Focus the search input on any list page |
| `Escape` | Close the currently open modal or side panel |
| `R` | Refresh current page data (when no input is focused) |
| `Ctrl+Enter` (in ping form) | Submit ping test |
| `Ctrl+E` | Open Export modal (on ApplicationsPage and CpsComparisonPage) |
| `←` / `→` | Navigate between tabs in ApplicationDetailPage |

Implement with a shared `useKeyboardShortcut(key, handler, options)` hook that attaches `keydown` listeners and automatically cleans them up on unmount.

---

### 3.10 Global — Relative Timestamps

**Current:** Date fields (e.g., "Last Modified") are displayed as raw ISO-8601 strings or locale-formatted dates.

**Recommendation:** Display relative timestamps by default ("2 hours ago", "3 days ago") with the absolute date visible on hover via a `Tooltip`. This is far more useful for operational triage. Use the browser's built-in `Intl.RelativeTimeFormat` API — no library needed.

```js
// src/utils/appUtils.js — add:
export function relativeTime(dateString) {
  const diff = Date.now() - new Date(dateString).getTime();
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diff < 60_000)  return rtf.format(-Math.round(diff / 1_000), 'second');
  if (diff < 3_600_000) return rtf.format(-Math.round(diff / 60_000), 'minute');
  if (diff < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), 'hour');
  return rtf.format(-Math.round(diff / 86_400_000), 'day');
}
```

---

### 3.11 CpsManagerPage — Property Value Masking

**Current:** Secure property values fetched from CPS are displayed in plain text in the properties table.

**Recommendation:** Mask secure property values by default (show `••••••••`) with a per-row eye-icon toggle (`👁`) to reveal. This prevents accidental credential exposure during screenshares and demos — a common operational risk for a dashboard used in team meetings.

```jsx
function SecureValueCell({ value }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <span className="flex items-center gap-2 font-mono text-sm">
      {revealed ? value : '••••••••'}
      <button
        onClick={() => setRevealed(v => !v)}
        aria-label={revealed ? 'Hide value' : 'Reveal value'}
        className="text-gray-400 hover:text-white transition"
      >
        {revealed ? '🙈' : '👁'}
      </button>
    </span>
  );
}
```

---

### 3.12 Global — Confirm Dialogs for Destructive Actions

**Current:** The Start / Stop / Restart buttons on the Applications page and the Delete buttons in CPS Manager trigger API calls with inline `window.confirm()` calls (native browser dialog) or without any confirmation at all.

**Issues:**
- `window.confirm()` is not styled, is not accessible, and cannot be dismissed by `Escape` in some browsers.
- Some delete operations in `CpsManagerPage` execute immediately without a confirmation step.

**Recommendation:** Replace all `window.confirm()` and unguarded destructive actions with a shared `ConfirmDialog` component that:
- Names the specific resource being affected (e.g., "Stop **my-customer-api**?")
- Uses a red "Confirm" button to visually signal danger
- Is keyboard-accessible and focus-trapped
- Can be dismissed with `Escape`

---

## 🚀 4. Feature Ideas & Implementation Plan

---

### Feature 1 — Scheduled Ping Automation with History

**Problem:** Ping tests are currently fully manual — a user must navigate to the Applications page, select apps, and trigger a run. There is no way to set up recurring health checks or view historical results.

**Proposed Feature:** Allow users to define a saved "Ping Schedule" — a named set of applications + credentials that runs automatically on a configurable interval (e.g., every 5, 15, or 30 minutes) and persists results across sessions.

#### Frontend Changes
- New page: `/ping-schedules` — list of saved schedules with last-run status summary
- `CreateScheduleModal` — select apps, set interval, attach credentials CSV
- `ScheduleResultHistory` panel — timeline of past runs with pass/fail counts per run, clickable to drill into full results
- Status indicator in the `Sidebar` showing the number of currently failing schedules (e.g., a red `●3` badge on the Ping Test nav item)

#### Backend Changes
- New `GET/POST/DELETE /api/schedules` routes to persist schedule definitions in `backend/data/` as JSON
- `src/jobs/pingScheduler.js` — a `node-cron` job that reads active schedules, calls the existing `/api/health/ping` logic, and appends results to a rolling history file (capped at the last 100 runs per schedule)
- `GET /api/schedules/:id/history` — returns the last N run results for a schedule

#### Key Files
- `backend/src/jobs/pingScheduler.js` (new)
- `backend/src/routes/schedules.js` (new)
- `frontend/src/pages/PingSchedulesPage.jsx` (new)
- `frontend/src/components/CreateScheduleModal.jsx` (new)

---

### Feature 2 — CPS Property Change History & Audit Log

**Problem:** There is no way to see who changed a CPS property, when it was changed, or what the previous value was. This makes post-incident forensics very difficult ("which CPS value changed before the app started failing?").

**Proposed Feature:** A lightweight audit log that captures before/after values whenever the CPS Manager page reads properties, storing them in the browser's `IndexedDB`. When a property's value changes between snapshots, a `CHANGED` badge appears in the property table and a diff modal shows the change timeline.

#### Frontend Changes
- `src/utils/cpsAuditLog.js` — reads from and writes to `IndexedDB` using the `idb` library; keyed by `(projectKey, propertyName, environment)`
- `CpsManagerPage` — after successfully fetching properties, compare with the last snapshot stored in IndexedDB; mark properties with `CHANGED` if values differ
- New `CpsHistoryModal` component — shows a chronological table of value snapshots for a selected property: `[timestamp, old value, new value, user]`

#### Backend Changes (minimal)
- Optionally expose `GET /api/cps/history/:projectKey/:propertyName` that returns server-side snapshots if the backend persists them. Without this, the feature is entirely client-side.

#### Key Files
- `frontend/src/utils/cpsAuditLog.js` (new)
- `frontend/src/components/CpsHistoryModal.jsx` (new)
- `frontend/src/pages/CpsManagerPage.jsx` (modified — integrate snapshot diff)

---

### Feature 3 — Real-Time Application Health Alerts via Server-Sent Events

**Problem:** The dashboard has no real-time awareness. If an application transitions from `RUNNING` to `FAILED` after page load, the user has no indication until they manually refresh. In production incident scenarios, minutes matter.

**Proposed Feature:** Implement a lightweight Server-Sent Events (SSE) stream from the backend that polls Anypoint application statuses on a configurable interval and pushes status-change events to all connected dashboard clients.

#### Backend Changes
- `GET /api/sse/status-stream` — an Express SSE endpoint that:
  1. Accepts a `?orgIds=...` query param from the client
  2. Polls `/api/applications` every 60 seconds
  3. Diffs results against the previous poll's state
  4. Emits `data: { appId, appName, previousStatus, currentStatus, timestamp }` for any status changes
- Rate-limit the SSE endpoint to prevent connection abuse

#### Frontend Changes
- `src/hooks/useStatusStream.js` — a custom hook that opens an `EventSource` connection to `/api/sse/status-stream` and returns a `statusAlerts` array
- `Header.jsx` — display a live alert bell icon with a count badge when `statusAlerts` is non-empty; clicking opens a slide-over panel listing the recent changes
- Toast notification (via unified `NotificationContext`) fires automatically for `RUNNING → FAILED` transitions

#### Key Files
- `backend/src/routes/sse.js` (new)
- `frontend/src/hooks/useStatusStream.js` (new)
- `frontend/src/components/AlertsPanel.jsx` (new)
- `frontend/src/components/Header.jsx` (modified)

---

### Feature 4 — Saved Filter Presets

**Problem:** Platform engineers who monitor specific Business Groups or environments must re-apply the same set of filters (BG + Env + Status) every time they load the Applications page or API Manager page. There is no way to save a named filter combination.

**Proposed Feature:** Allow users to save named filter presets that restore all filter state in one click.

#### Frontend Changes
- `src/utils/filterPresets.js` — CRUD operations against `localStorage` for named preset objects: `{ name, bgId, envId, status, deploymentType, search }`
- `ApplicationsPage` and `ApiManagerPage` — add a **Presets** dropdown next to the filter bar:
  - Lists saved presets by name
  - "Save current filters as preset…" option at the bottom
  - A `×` button on each saved preset to delete it
- `useFilterPresets(pageKey)` custom hook that scopes presets by page name so Applications and API Manager presets don't collide

#### Backend Changes
- None required — presets are stored in `localStorage` client-side. Optionally, persist to a `backend/data/presets.json` file via `POST /api/presets` for cross-device sync.

#### Key Files
- `frontend/src/utils/filterPresets.js` (new)
- `frontend/src/hooks/useFilterPresets.js` (new)
- `frontend/src/components/PresetDropdown.jsx` (new)
- `frontend/src/pages/ApplicationsPage.jsx` (modified)
- `frontend/src/pages/ApiManagerPage.jsx` (modified)

---

### Feature 5 — API Dependency Graph Visualisation

**Problem:** The dashboard shows individual applications and individual APIs in isolation. There is no view showing which Mule applications consume which API Manager instances (the consumer contract graph), making it impossible to answer "if I restart this API, which consuming apps will be affected?"

**Proposed Feature:** An interactive dependency graph that visualises API-to-application consumer relationships using the contract data already available from the API Manager contracts API.

#### Data Model
The existing `GET /api/apis/:id/contracts` endpoint already returns consumer application names and client IDs. The application list includes client IDs in deployment properties. By joining these two datasets, a directed graph can be constructed: `Application → consumes → API Instance`.

#### Backend Changes
- New `GET /api/graph/dependencies?orgId=...` route that:
  1. Fetches all API instances for the org
  2. Fetches contracts for each API instance (parallel, rate-limited)
  3. Matches contract `client_id` values against application deployment properties
  4. Returns a graph payload: `{ nodes: [{id, label, type: 'app'|'api'}], edges: [{source, target}] }`

#### Frontend Changes
- New page `/api-graph` using `react-flow` (or `vis-network`) to render the dependency graph
- Nodes: circular for API instances (colour by policy count), rectangular for Mule apps (colour by status)
- Edges: directed arrows from consuming app to API instance
- Clicking a node: highlights all connected nodes and shows a side panel with the full app/API detail
- Filter: "Show only Production", "Highlight unhealthy apps", "Show only apps with 2+ dependencies"

#### Key Files
- `backend/src/routes/graph.js` (new)
- `frontend/src/pages/ApiGraphPage.jsx` (new)
- `frontend/src/components/DependencyGraph.jsx` (new using `react-flow`)

---

## 📊 5. Issue Summary by Priority

### 🔴 Critical (Fix First)

| ID | File | Issue |
|---|---|---|
| B-01 | `server.js` | No global Express error handler — unhandled errors crash silently |
| B-14 | `routes/cps.js` | Monolithic route file — unmaintainable and untestable |
| F-01 | `services/api.js` | Token header boilerplate copy-pasted 50+ times |
| F-02 | `services/api.js` | Inconsistent error handling across all API functions |
| F-13 | `CpsManagerPage.jsx` | 6+ boolean modal state flags — unmaintainable |

### 🟡 Medium (Next Sprint)

| ID | File | Issue |
|---|---|---|
| B-02 | `server.js` | Missing `helmet` security headers |
| B-05 | `server.js` | Hardcoded dev CORS fallback |
| B-07 | `authMiddleware.js` | No empty-token validation |
| B-09 | `anypointClient.js` | No retry on transient Anypoint errors |
| B-10 | `anypointClient.js` | `ANYPOINT_BASE_URL` env var ignored |
| B-12 | `responseHelpers.js` | 401 from Anypoint reported as 500 to client |
| B-16 | `routes/cps.js` | No file size / MIME type validation on binary upload |
| B-19 | `routes/health.js` | Unconditional `rejectUnauthorized: false` |
| F-06 | `apiCache.js` | Cache not cleared on logout |
| F-08 | `App.jsx` | No route-level code splitting (`React.lazy`) |
| F-09 | `App.jsx` | No `ErrorBoundary` wrapping the route tree |
| F-10 | `ApplicationsPage.jsx` | No search debounce, no `useReducer` |

### 🟢 Low (Backlog)

| ID | File | Issue |
|---|---|---|
| B-03 | `server.js` | No `compression` middleware |
| B-04 | `server.js` | No request logger |
| B-06 | `server.js` | No rate limiting on `/api/login` |
| B-11 | `anypointClient.js` | No circuit breaker |
| B-22 | `appHelpers.js` | `Promise.all` should be `Promise.allSettled` for enrichment |
| F-07 | `apiCache.js` | No cache max-size / LRU eviction |
| F-12 | `ApplicationsPage.jsx` | Table rows re-render without `React.memo` |
| 2.18 | `appUtils.js` / `StatusBadge.jsx` | Duplicate status→class mapping |
| 2.19 | `csvCredentialStore.js` | No CSV input validation |
| 2.20 | All components | No `PropTypes` or TypeScript interfaces |

---

## 🗺️ 6. Recommended Refactoring Roadmap

### Phase 1 — Foundation (1–2 weeks)
1. Add global Express error handler to `server.js` (B-01)
2. Add `helmet`, `morgan`, `compression` to `server.js` (B-02, B-03, B-04)
3. Fix `authMiddleware` empty-token check (B-07)
4. Fix `handleRouteError` to forward 401/403 (B-12)
5. Create `src/services/axiosClient.js` and migrate all `api.js` functions to use it (F-01, F-02, F-04)
6. Add `ErrorBoundary` to `App.jsx` and add `React.lazy` route splitting (F-08, F-09)
7. Clear `apiCache` on logout (F-06)

### Phase 2 — DRY & Modularisation (2–3 weeks)
8. Merge `CredentialStoreContext` + `CpsCredentialStoreContext` via `useCredentialStore` hook (2.11)
9. Merge `NotificationContext` + `ToastContext` into unified system (2.12)
10. Replace `BgFilterModal` + `EnvFilterModal` with generic `FilterModal` (2.13)
11. Delete `routes/environments.js`, consolidate into `routes/organizations.js` (2.5)
12. Create `src/utils/fanOut.js` and refactor `applications.js` + `apis.js` (2.6)
13. Split `routes/cps.js` into controller/service/config layers (2.7)
14. Read `ANYPOINT_BASE_URL` from env in `anypointClient.js` (B-10)
15. Add `axios-retry` to `anypointClient.js` (B-09)

### Phase 3 — UI Polish (2–3 weeks)
16. Add `Skeleton` component and replace all spinners with skeleton screens (3.1)
17. Add `EmptyState` component to all list pages (3.2)
18. Add `ErrorBanner` component with retry/login actions (3.3)
19. Improve `StatusBadge` WCAG contrast + animated pulse (3.4)
20. Add inline quick-filter chip bar to `ApplicationsPage` (3.
