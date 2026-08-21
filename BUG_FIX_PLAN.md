# MuleSoft Dashboard — Bug Fix & Improvement Plan

**Created:** August 2026  
**Based on:** Full codebase analysis (see `CODEBASE_ANALYSIS.md`)  
**Status:** 🔴 Not Started

---

## How to Use This File

Each bug/improvement has:
- A **status badge**: 🔴 Not Started | 🟡 In Progress | ✅ Fixed
- The **exact file(s)** to change
- The **root cause** and **impact**
- The **exact fix** to apply

Work through them in priority order. Update the status badge as you go.

---

## Priority Order

```
Phase 1 — Critical (security + inaccessible features)
  Bug 1  → Missing routes for 3 existing pages
  Bug 2  → Missing sidebar navigation links
  Bug 3  → /ping and /oauth2-token unprotected (SSRF risk)
  Bug 4  → SESSION_SECRET defaults to known string + cookie insecure

Phase 2 — Logic Correctness
  Bug 5  → Dead context reference in LoginPage (setSessionFromResult)
  Bug 6  → _redirecting flag never resets after 401 redirect
  Bug 7  → api facade missing patch() and put() methods
  Bug 8  → 50MB body limit applied to all routes
  Bug 9  → ping-spec route ordering in exchange.js

Phase 3 — Improvements
  Imp 1–17 → Code quality, security hardening, UX
```

---

## Phase 1 — Critical Bugs

---

### BUG-03 ✅ — `/ping` and `/oauth2-token` endpoints have no authentication (SSRF risk)

**Status:** ✅ Fixed — added `authMiddleware` to both routes in `health.js`  
**File:** `backend/src/routes/health.js`  
**Severity:** Critical Security — unauthenticated SSRF vector

**Root Cause:**  
Two endpoints in `health.js` do NOT use `authMiddleware`:

```javascript
// health.js — MISSING authMiddleware
router.post('/ping', async (req, res) => { ... });          // ❌ No auth
router.post('/oauth2-token', async (req, res) => { ... });  // ❌ No auth

// These correctly use auth (inconsistency):
router.post('/auto-credentials', authMiddleware, ...);       // ✅
router.post('/auto-contract-creds', authMiddleware, ...);    // ✅
```

**Impact:**
- `/ping` accepts `appName`, `ch2IngressUrl`, `clientId`, `clientSecret` from anyone → SSRF: an attacker can use the server to make GET requests to any internal URL with custom headers. `rejectUnauthorized: false` makes this worse.
- `/oauth2-token` allows anyone to proxy OAuth2 token requests through the server to any `tokenUrl`.

**Fix to Apply:**
```javascript
// Add authMiddleware to both routes
router.post('/ping', authMiddleware, async (req, res) => { ... });
router.post('/oauth2-token', authMiddleware, async (req, res) => { ... });
```

> **Note:** If `/ping` is used from the App Detail page's Ping Test tab which requires login, adding auth here is safe and doesn't break any existing workflow.

---

### BUG-04 ✅ — SESSION_SECRET defaults to known string; cookie `secure: false` hardcoded

**Status:** ✅ Fixed — startup validation added; cookie hardened with `secure`, `httpOnly`, `sameSite`  
**File:** `backend/src/server.js`  
**Severity:** Critical Security — sessions can be forged; token transmitted in plaintext

**Root Cause:**
```javascript
app.use(session({
  secret: process.env.SESSION_SECRET || 'mulesoft-dashboard-secret', // ❌ Known default
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // ❌ Hardcoded false
}));
```

**Impact 1:** Default secret is in the README and source — can be used to forge valid session cookies.  
**Impact 2:** `secure: false` sends the session cookie over HTTP in production — the Anypoint bearer token stored in the session is exposed.

**Fix to Apply:**
```javascript
// Add startup validation
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET === 'mulesoft-dashboard-secret') {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: SESSION_SECRET must be set to a strong random string in production.');
    process.exit(1);
  } else {
    console.warn('WARNING: SESSION_SECRET is not set. Using insecure default. Set SESSION_SECRET in .env for production.');
  }
}

// Make cookie.secure dynamic
app.use(session({
  secret: process.env.SESSION_SECRET || 'mulesoft-dashboard-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // ✅ true in prod, false in dev
    httpOnly: true,                                // ✅ Explicit httpOnly
    sameSite: 'lax',                               // ✅ CSRF mitigation
    maxAge: 24 * 60 * 60 * 1000
  }
}));
```

Also add trust proxy for production behind nginx/load balancer:
```javascript
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
```

---

## Phase 2 — Logic Bugs

---

### BUG-05 ✅ — Dead context reference + double `useAuth()` call in `LoginPage`

**Status:** ✅ Fixed — removed `setSessionFromResult`; merged into single `useAuth()` call  
**File:** `frontend/src/pages/LoginPage.jsx`  
**Severity:** Medium — Dead code from incomplete refactor; `setSessionFromResult` is `undefined`

**Root Cause:**
```jsx
// Line ~14 — First call
const { login, demoLogin, setSessionFromResult } = useAuth();
// ❌ setSessionFromResult does not exist in AuthContext

// Line ~29 — Second call (redundant)
const { tokenLogin, connectedAppLogin } = useAuth();
```

**Fix to Apply:**  
Merge into a single `useAuth()` call and remove `setSessionFromResult`:
```jsx
const { login, tokenLogin, connectedAppLogin, demoLogin } = useAuth();
// Remove the second useAuth() call entirely
```

---

### BUG-06 ✅ — `_redirecting` flag in `api.js` never resets after 401 redirect

**Status:** ✅ Fixed — added `setTimeout(() => { _redirecting = false; }, 5000)` after redirect  
**File:** `frontend/src/services/api.js`  
**Severity:** Medium — After first session expiry redirect, future expiries silently fail

**Root Cause:**
```javascript
let _redirecting = false; // Module-level — lives for the entire SPA session

axiosClient.interceptors.response.use(null, (error) => {
  if (error.response?.status === 401 && !isDemoMode() && !_redirecting) {
    _redirecting = true;
    window.location.href = '/login'; // Page reload resets module state in most cases
  }
  // ❌ _redirecting is NEVER reset to false
});
```

**Impact:** If the SPA does a soft navigation (React Router) back from the login page without a full page reload, `_redirecting` stays `true`. Future 401 responses won't trigger the redirect. User sees empty/broken pages silently.

**Fix to Apply:**
```javascript
let _redirecting = false;

axiosClient.interceptors.response.use(null, (error) => {
  if (error.response?.status === 401 && !isDemoMode() && !_redirecting) {
    const url = error.config?.url || '';
    const skipRedirect =
      url.includes('/applications/summary') ||
      url.startsWith('/environments/')       ||
      url.includes('/environments/')         ||
      url.includes('/cps/')                  ||
      url.includes('/exchange/')             ||
      url.includes('/apis/');

    if (!skipRedirect) {
      _redirecting = true;
      // Reset after 5 seconds — allows re-triggering if user comes back
      // without a full page reload
      setTimeout(() => { _redirecting = false; }, 5000);
      window.location.href = '/login';
    }
  }
  return Promise.reject(error);
});
```

---

### BUG-07 ✅ — `api.js` facade missing `patch()` and `put()` methods

**Status:** ✅ Fixed — added `patch()` and `put()` to the `api` facade  
**File:** `frontend/src/services/api.js`  
**Severity:** Medium — Incomplete facade; any future component using `api.patch()` will crash

**Root Cause:**
```javascript
const api = {
  get:    async (url, config) => { ... },
  post:   async (url, data, config) => { ... },
  delete: async (url, config) => { ... },
  // ❌ No patch() — backend uses PATCH for CH2 desiredState updates
  // ❌ No put()   — backend uses PUT for CH1 fallback actions
};
```

**Fix to Apply:**
```javascript
const api = {
  get:    async (url, config = {}) => { ... },        // existing
  post:   async (url, data, config = {}) => { ... },  // existing
  delete: async (url, config = {}) => { ... },        // existing
  patch:  async (url, data, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.patch(url, data, config);
  },
  put:    async (url, data, config = {}) => {
    if (isDemoMode()) return { data: { success: true } };
    return axiosClient.put(url, data, config);
  },
};
```

---

### BUG-08 ✅ — 50MB JSON body limit applied globally to all routes

**Status:** ✅ Fixed — global limit reduced to 1MB; 50MB scoped to `/api/cps` only  
**File:** `backend/src/server.js`  
**Severity:** Medium — Security/performance: unauthenticated endpoints accept 50MB payloads

**Root Cause:**
```javascript
app.use(express.json({ limit: '50mb' }));          // ❌ Global
app.use(express.urlencoded({ limit: '50mb', extended: true })); // ❌ Global
```

**Impact:** Routes like `/api/auth/login`, the unauthenticated `/api/health/ping`, and others don't need anywhere near 50MB. This wastes memory and enables DoS.

**Fix to Apply:**
```javascript
// Default small limit for all routes
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

// Override with large limit only for CPS routes that need it
app.use('/api/cps', express.json({ limit: '50mb' }));
```

---

### BUG-09 ✅ — `ping-spec` route defined after wildcard routes in `exchange.js`

**Status:** ✅ Fixed — extracted handler to `handlePingSpec()` function; route registered before wildcards  
**File:** `backend/src/routes/exchange.js`  
**Severity:** Low — Currently safe but creates maintenance trap

**Root Cause:**
```javascript
router.get('/search', ...);                 // ✅ Specific — defined first
router.get('/org/:orgId/summary', ...);     // ✅ Specific
router.get('/:groupId/:assetId/versions', ...); // Wildcard 2-segment
router.get('/:groupId/:assetId/:version', ...); // Wildcard 3-segment
router.get('/ping-spec', ...);              // ❌ Specific — defined AFTER wildcards
```

**Impact:** Currently works because `/ping-spec` is a 1-segment path that won't match 2-segment or 3-segment wildcard patterns. However, this ordering creates a maintenance trap — a future developer adding a route like `/ping-spec/something` will find it silently swallowed by the wildcard.

**Fix to Apply:**  
Move `ping-spec` to before the wildcard routes:
```javascript
router.get('/search', ...);
router.get('/org/:orgId/summary', ...);
router.get('/ping-spec', ...);                        // ✅ Moved BEFORE wildcards
router.get('/:groupId/:assetId/versions', ...);
router.get('/:groupId/:assetId/:version', ...);
```

---

## Phase 3 — Code Quality Improvements

---

### IMP-01 ✅ — Move filter utility functions out of modal components

**Status:** ✅ Fixed — extracted to `filterUtils.js`; modals re-export for backward compat  
**Files:** `frontend/src/components/BgFilterModal.jsx`, `frontend/src/components/EnvFilterModal.jsx`  
**Severity:** Low — Design smell; utility logic coupled to UI component files

**Issue:**  
`applyBgFilter()` and `applyEnvFilter()` are utility functions exported from modal UI components. Multiple pages import these functions directly from the modal files, creating tight coupling.

```javascript
// UserSearchPage.jsx — importing utility from a UI component
import { applyBgFilter } from '../components/BgFilterModal';
import { applyEnvFilter } from '../components/EnvFilterModal';
```

**Fix:** Extract these functions to `frontend/src/utils/filterUtils.js` and update all import references.

---

### IMP-02 ✅ — Add `express-rate-limit` to authentication routes

**Status:** ✅ Fixed — 20 req/15 min per IP; production-only enforcement  
**File:** `backend/src/server.js` or `backend/src/routes/auth.js`  
**Severity:** Medium Security — No brute-force protection on login

**Fix to Apply:**
```javascript
// npm install express-rate-limit
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,                   // 20 attempts per IP per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply only to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/token-login', authLimiter);
app.use('/api/auth/connected-app-login', authLimiter);
```

---

### IMP-03 🔴 — Replace in-memory session store with persistent store

**Status:** 🔴 Not Started  
**File:** `backend/src/server.js`  
**Severity:** Medium — Sessions lost on server restart; not scalable

**Issue:**  
`express-session` default is `MemoryStore` which:
- Loses all sessions on server restart (users get logged out)
- Leaks memory as sessions accumulate
- Cannot be shared across multiple server instances

**Fix to Apply:**
```javascript
// Option A: Redis (recommended for production)
// npm install connect-redis redis
const RedisStore = require('connect-redis').default;
const { createClient } = require('redis');
const redisClient = createClient({ url: process.env.REDIS_URL || 'redis://localhost:6379' });
redisClient.connect().catch(console.error);

app.use(session({
  store: new RedisStore({ client: redisClient }),
  // ... rest of config
}));

// Option B: File-based (simple, no extra infra)
// npm install session-file-store
const FileStore = require('session-file-store')(session);
app.use(session({
  store: new FileStore({ path: './sessions', ttl: 86400 }),
  // ... rest of config
}));
```

---

### IMP-04 🔴 — Add React Error Boundaries

**Status:** 🔴 Not Started  
**File:** `frontend/src/App.jsx`  
**Severity:** Low — Unhandled render errors crash the entire SPA

**Fix to Apply:**
```jsx
// Create frontend/src/components/ErrorBoundary.jsx
import React from 'react';
export class ErrorBoundary extends React.Component {
  state = { hasError: false, error: null };
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen bg-gray-950 gap-4">
          <p className="text-red-400 font-semibold">Something went wrong</p>
          <p className="text-gray-500 text-sm">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm">
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Wrap Layout in App.jsx
<ProtectedRoute>
  <ErrorBoundary>
    <Layout />
  </ErrorBoundary>
</ProtectedRoute>
```

---

### IMP-05 🔴 — Fix README API route reference (outdated)

**Status:** 🔴 Not Started  
**File:** `README.md`  
**Severity:** Low — Misleading documentation

**Issue:**  
The README Backend API Routes Reference section documents wrong paths:

| README says | Actual path |
|---|---|
| `POST /api/login` | `POST /api/auth/login` |
| `GET /api/logout` | `POST /api/auth/logout` |
| `GET /api/me` | `GET /api/auth/session` |
| `GET /api/cps/:appName` | `GET /api/cps/fetch?baseUrl=...` |
| `POST /api/ping` | `POST /api/health/ping` |

**Fix:** Update the README API Route Reference section to match actual Express route registrations.

---

### IMP-06 🔴 — Add `memberOrgs` to AuthContext for pages that need it

**Status:** 🔴 Not Started  
**File:** `frontend/src/context/AuthContext.jsx`  
**Severity:** Low — Some pages call `/organizations/business-groups` on every load instead of using session data

**Issue:**  
The backend stores `memberOrgs[]` in session at login time. The `AuthContext` does not expose it, so pages like `DashboardPage` and `UserSearchPage` make a separate API call to `/organizations/business-groups` on every load.

**Fix to Apply:**
```jsx
// AuthContext — add memberOrgs state
const [memberOrgs, setMemberOrgs] = useState([]);

// In checkSession():
if (res.data.authenticated) {
  setUser(res.data.user);
  setOrgId(res.data.orgId);
  setOrgName(res.data.orgName);
  setMemberOrgs(res.data.memberOrgs || []); // ✅ Already returned by /auth/session
}

// In applyResult():
const applyResult = (data) => {
  setUser(data.user);
  setOrgId(data.orgId);
  setOrgName(data.orgName);
  setMemberOrgs(data.memberOrgs || []);
};

// In context value:
value={{ user, orgId, orgName, memberOrgs, loading, login, ... }}
```

---

### IMP-07 🔴 — Add ESLint and Prettier configuration

**Status:** 🔴 Not Started  
**Files:** Root, `frontend/`, `backend/`  
**Severity:** Low — No linting or code formatting enforced

**Fix to Apply:**
```bash
# Frontend
cd frontend
npm install -D eslint @eslint/js eslint-plugin-react eslint-plugin-react-hooks prettier

# Backend
cd backend
npm install -D eslint prettier
```

Create `frontend/.eslintrc.json`:
```json
{
  "extends": ["eslint:recommended", "plugin:react/recommended", "plugin:react-hooks/recommended"],
  "rules": {
    "react/prop-types": "off",
    "no-unused-vars": ["warn", { "argsIgnorePattern": "^_" }]
  }
}
```

---

### IMP-08 🔴 — Add unit tests for utility functions

**Status:** 🔴 Not Started  
**Files:** `backend/src/utils/`, `frontend/src/utils/`  
**Severity:** Low — Zero test coverage on critical utility functions

**Priority test targets:**

| Function | File | Why Critical |
|---|---|---|
| `normalizeStatus()` | `backend/src/utils/appHelpers.js` | Maps all CH1/CH2 status strings |
| `stripDeploymentSuffix()` | `backend/src/utils/appHelpers.js` | Drives fuzzy name matching |
| `flattenCpsResponse()` | `frontend/src/utils/cpsHelpers.js` | Handles 4 different CPS response shapes |
| `extractCpsConfig()` | `frontend/src/utils/cpsHelpers.js` | Extracts CPS config from ARM properties |
| `parseCsvToCredentialMap()` | `frontend/src/utils/csvCredentialStore.js` | Parses uploaded credentials |
| `findApiIdInProps()` | `frontend/src/utils/cpsHelpers.js` | Finds API ID with 4-priority fallback |

**Setup:**
```bash
# Backend: Jest
cd backend && npm install -D jest

# Frontend: Vitest (compatible with Vite)
cd frontend && npm install -D vitest @vitest/ui
```

---

## Progress Tracker

| Bug/Improvement | Status | File(s) | Notes |
|---|---|---|---|
| ~~BUG-01 Missing routes~~ | ✅ Resolved | Deleted `DashboardPage`, `BusinessGroupsPage`, `EnvironmentsPage`, `StatCard`; removed `recharts` from `package.json` | Features removed per decision |
| ~~BUG-02 Missing sidebar links~~ | ✅ Resolved | N/A | Resolved by removing the pages |
| BUG-03 Unauthenticated /ping | ✅ Fixed | `health.js` | Added `authMiddleware` to `/ping` and `/oauth2-token` |
| BUG-04 Session secret + cookie | ✅ Fixed | `server.js`, `.env.example` | Validation + secure/httpOnly/sameSite cookie |
| BUG-05 Dead setSessionFromResult | ✅ Fixed | `LoginPage.jsx` | Removed dead ref + merged double useAuth() call |
| BUG-06 _redirecting never resets | ✅ Fixed | `api.js` | Added 5s reset timer after redirect |
| BUG-07 Missing patch/put in api | ✅ Fixed | `api.js` | Added patch() and put() with demo mode support |
| BUG-08 Global 50MB body limit | ✅ Fixed | `server.js` | Global 1MB; 50MB scoped to /api/cps only |
| BUG-09 ping-spec route order | ✅ Fixed | `exchange.js` | Handler extracted to named function; registered before wildcards |
| IMP-01 Move filter utils | ✅ Fixed | `filterUtils.js`, `BgFilterModal`, `EnvFilterModal` | Canonical utils in filterUtils.js; modals re-export |
| IMP-02 Rate limit auth routes | ✅ Fixed | `server.js` | 20 req/15 min per IP on login routes; prod-only |
| IMP-03 Persistent session store | 🔴 Not Started | `server.js` | |
| IMP-04 React Error Boundaries | 🔴 Not Started | `App.jsx` | |
| IMP-05 Fix README routes | 🔴 Not Started | `README.md` | |
| IMP-06 memberOrgs in AuthContext | 🔴 Not Started | `AuthContext.jsx` | |
| IMP-07 ESLint + Prettier | 🔴 Not Started | Root | |
| IMP-08 Unit tests for utils | 🔴 Not Started | `utils/` | |

---

*Update this file as bugs are fixed. Change status to 🟡 In Progress when starting, ✅ Fixed when complete.*
