# MuleSoft Integration Dashboard — Complete Codebase Analysis

**Analyzed:** August 2026  
**Version:** Based on git commit `030a52e`  
**Analyst:** MuleSoft Developer Agent

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Architecture Overview](#4-architecture-overview)
5. [Authentication System](#5-authentication-system)
6. [Backend — Route-by-Route Analysis](#6-backend--route-by-route-analysis)
7. [Backend — Utility Layer](#7-backend--utility-layer)
8. [Frontend — Context and State](#8-frontend--context-and-state)
9. [Frontend — Services Layer](#9-frontend--services-layer)
10. [Frontend — Pages](#10-frontend--pages)
11. [Frontend — Components](#11-frontend--components)
12. [Frontend — Utilities](#12-frontend--utilities)
13. [Feature Deep-Dives](#13-feature-deep-dives)
14. [Security Analysis](#14-security-analysis)
15. [Performance Patterns](#15-performance-patterns)
16. [Code Quality Assessment](#16-code-quality-assessment)
17. [Known Gaps and Improvement Opportunities](#17-known-gaps-and-improvement-opportunities)
18. [Environment Variables Reference](#18-environment-variables-reference)
19. [Complete API Route Reference](#19-complete-api-route-reference)

---

## 1. Project Overview

The **MuleSoft Integration Dashboard** is a full-stack web application that provides platform operators, integration developers, and architects a **single-pane-of-glass** view of their Anypoint Platform estate. It acts as a **secure reverse proxy**: the React SPA calls the Express backend, which holds the Anypoint bearer token server-side in an `express-session`. The browser **never** directly contacts Anypoint APIs, and credentials are **never stored in the browser**.

### 1.1 Problem Statement — Manual Tasks Eliminated

| Manual Task | Estimated Time Cost | Dashboard Solution |
|---|---|---|
| Log into ARM per BG/env to check app status | 5–15 min/day | Applications page — all BGs aggregated |
| Manually verify CPS property values per app | 10–30 min/release | App Detail → CPS Config tab |
| Compare UAT vs Production CPS configs | 30–60 min/release | CPS Compare side-by-side diff |
| Smoke-test all apps before a release | 1–2 hrs/release | Bulk Ping with auto credential resolution |
| Find which app uses a specific service account | Hours | Global CPS Search fan-out |
| Check API consumers and applied policies | 15–30 min | API Manager page |
| Browse Exchange for published APIs/connectors | 5–10 min | Exchange browser |

### 1.2 Core Design Principles

1. **Security first** — bearer token server-side only; ping credentials in module-level memory only
2. **Automation over manual steps** — bulk operations, auto credential resolution, auto CPS config extraction
3. **Resilience** — `Promise.allSettled` everywhere; one failing BG/env never breaks the whole page
4. **Graceful degradation** — 404s, 403s, missing fields all handled with fallbacks; no white screens
5. **Demo mode** — full mock dataset; fully usable without any Anypoint credentials

---

## 2. Tech Stack

### 2.1 Backend (`backend/`)

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.18.2 | HTTP framework |
| `axios` | ^1.6.0 | Anypoint API proxy calls |
| `express-session` | ^1.17.3 | Server-side session (bearer token storage) |
| `cors` | ^2.8.5 | CORS — whitelists `:5173` and `:3000` |
| `dotenv` | ^16.3.1 | `.env` config loading |
| `js-yaml` | ^5.2.3 | YAML parsing |
| `node-cache` | ^5.1.2 | In-process caching utility |
| `nodemon` | ^3.0.2 | Dev hot reload |

### 2.2 Frontend (`frontend/`)

| Package | Version | Purpose |
|---|---|---|
| `react` | ^18.2.0 | UI framework |
| `vite` | ^8.2.1 | Build tool + dev server proxy |
| `react-router-dom` | ^6.28.0 | SPA nested routing |
| `tailwindcss` | ^3.4.0 | Utility-first CSS (dark theme throughout) |
| `lucide-react` | ^0.303.0 | Icon library |
| `axios` | ^1.6.0 | HTTP client with 401 interceptor + demo mock layer |
| `recharts` | ^3.10.1 | Charts on Dashboard page |
| `xlsx` | ^0.18.5 | Excel/CSV export for CPS and ping results |

### 2.3 Anypoint Platform APIs Consumed

| API Category | Endpoints Used |
|---|---|
| Accounts | `/accounts/login`, `/accounts/api/me`, `/accounts/api/v2/oauth2/token` |
| ARM CloudHub 1.0 | `/cloudhub/api/v2/applications`, `/cloudhub/api/applications` |
| ARM CloudHub 2.0 | `/amc/application-manager/api/v2/.../deployments` |
| API Manager | `/apimanager/api/v1/.../apis`, policies, contracts, SLA tiers, alerts |
| Anypoint Exchange | `/exchange/api/v2/organizations/.../applications` + credentials |
| Runtime Fabric | `/runtimefabric/api/organizations/.../privatespaces` |
| CPS | `/api/v2/properties/non-secure`, `/secure`, `/binaries`, `/binaries/secure/auth` |
| Organizations | `/accounts/api/organizations/:id`, `/environments`, `/members` |

---

## 3. Project Structure

```
mulesoft-dashboard/
├── README.md                         Feature docs, architecture diagrams, API reference
├── SOP-Dashboard-Usage.md            Step-by-step operator SOP (v1.2)
├── jsconfig.json
├── CODEBASE_ANALYSIS.md              This analysis file
│
├── backend/
│   ├── .env.example                  PORT, SESSION_SECRET, ANYPOINT_PLATFORM_URL
│   ├── package.json                  scripts: start | dev | clean:all
│   └── src/
│       ├── server.js                 Express entry: cors + session + body + routes
│       ├── middleware/
│       │   └── authMiddleware.js     session.token → req.anypointToken + req.orgId
│       ├── routes/
│       │   ├── auth.js               3 login modes + storeSession() + session GET + logout
│       │   ├── applications.js       CH1+CH2 list/detail/actions + 20-min cache summary
│       │   ├── apis.js               API Manager: instances, policies, contracts, tiers, alerts
│       │   ├── organizations.js      BG hierarchy (session-cached) + org detail + members
│       │   ├── environments.js       Environment listing per org
│       │   ├── exchange.js           Exchange asset search
│       │   ├── metrics.js            Aggregated throughput + error metrics
│       │   ├── cps.js                CPS fetch + credential CRUD + user-search fan-out
│       │   └── health.js             Ping + auto-credentials (5-layer) + OAuth2 proxy
│       └── utils/
│           ├── anypointClient.js     createClient(token) — axios factory, 30s timeout
│           ├── appHelpers.js         normalizeStatus, parseCH2Apps, makeCh1Headers,
│           │                         isProductionEnv, stripDeploymentSuffix, extractCH2IngressUrl
│           ├── orgHelpers.js         mapOrgShape — canonical org object normalizer
│           ├── exchangeHelpers.js    fetchExchangeAppCreds — 2-strategy credential lookup
│           └── responseHelpers.js    sendProxyError — unified proxy error JSON shape
│
└── frontend/
    ├── vite.config.js                Proxy /api → :5000, port 5173, no sourcemaps in prod
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── App.jsx                   Nested routes + ProtectedRoute guard + Context providers
        ├── main.jsx
        ├── index.css
        ├── context/
        │   ├── AuthContext.jsx             user, orgId, orgName; 3 logins + demo + logout
        │   ├── CredentialStoreContext.jsx  Ping creds (CSV → in-memory Map, survives navigation)
        │   └── CpsCredentialStoreContext.jsx CPS creds (CSV → in-memory Map)
        ├── services/
        │   ├── api.js                Axios + demo mock handler + 401 redirect interceptor
        │   ├── apiCache.js           Module-level cache (getCached / setCached)
        │   └── mockData.js           Full mock dataset for Demo Mode (apps, envs, APIs, etc.)
        ├── pages/
        │   ├── LoginPage.jsx         3 auth tabs + Demo button
        │   ├── ApplicationsPage.jsx  Filterable table + bulk actions + bulk ping
        │   ├── ApplicationDetailPage.jsx  6-tab deep-dive per app
        │   ├── ApiManagerPage.jsx    API instances + policies + contracts
        │   ├── ExchangePage.jsx      Exchange asset browser + detail panel
        │   ├── PingTestPage.jsx      Ping results table + CSV export
        │   ├── CpsComparisonPage.jsx Side-by-side CPS diff (single + multi-app)
        │   └── UserSearchPage.jsx    Global CPS search fan-out with BG/env selector
        ├── components/
        │   ├── Layout.jsx            App shell — collapsible sidebar + Outlet
        │   ├── Sidebar.jsx           NavLinks + org name + docs link
        │   ├── Header.jsx            Global filter + credential import buttons
        │   ├── PingTestPanel.jsx     Single-app ping panel
        │   ├── PingResultCard.jsx    Individual ping result card
        │   ├── AttemptLog.jsx        Per-path attempt log table
        │   ├── CpsExportModal.jsx    CPS export dialog
        │   ├── CpsSettingsModal.jsx  CPS settings configuration
        │   ├── CpsCredentialImportButton.jsx  Import CPS credentials from CSV
        │   ├── CredentialImportButton.jsx     Import ping credentials from CSV
        │   ├── BgFilterModal.jsx     Business Group filter (persisted across navigation)
        │   ├── EnvFilterModal.jsx    Environment type filter
        │   ├── Select.jsx            Custom styled select component
        │   ├── StatCard.jsx          Dashboard metric card with icon + value
        │   ├── StatusBadge.jsx       Color-coded RUNNING/STOPPED/FAILED pill
        │   └── CopyBtn.jsx           One-click clipboard copy with check confirmation
        └── utils/
            ├── cpsHelpers.js         extractCpsConfig, flattenCpsResponse, findApiIdInProps,
            │                         findOAuth2Url, normaliseCpsUrl
            ├── csvCredentialStore.js parseCsvLine, parseCsvToCredentialMap (auto-header detect)
            ├── appUtils.js           General app utility functions
            └── exportCps.js          CPS data → xlsx / CSV file download
```

---

## 4. Architecture Overview

### 4.1 Request Flow

```
Browser (React SPA)
    │  axios/fetch  →  credentials: 'include'  (session cookie on every request)
    │  All frontend API paths: /api/*
    ▼
Vite dev server proxy  (dev only)
    ↓
Express Backend :5000
    │
    ├─ cors()                 Allows :5173, :3000 with credentials
    ├─ express.json()         50MB body limit (CPS payloads can be large)
    ├─ express-session()      24hr cookie, server-side token never leaves backend
    │
    ├─ authMiddleware         req.session.token → req.anypointToken
    │                         req.session.orgId  → req.orgId
    │                         req.session.memberOrgs → req.memberOrgs
    │                         → 401 if no token
    │
    ├─ Route Handler
    │    createClient(req.anypointToken)
    │    → axios.create({ baseURL: ANYPOINT_URL, Authorization: Bearer })
    │    → upstream Anypoint API call
    │    → res.json(data)
    │
    └─ sendProxyError()       Unified error shape on upstream failures
```

### 4.2 Multi-Organization Fan-Out Pattern

```
User selects "All Organizations"
    │
    Frontend: memberOrgs[] from AuthContext (loaded at login, no extra API call)
    │
    For EACH org in parallel (Promise.allSettled):
    │   GET /api/applications/summary/:orgId
    │       │
    │       Backend:
    │       ├─ GET /accounts/api/organizations/:orgId/environments
    │       ├─ Filter: skip dev/qa environments (isProductionEnv)
    │       ├─ For EACH environment (Promise.all):
    │       │   ├─ GET /amc/.../deployments  (CH2)
    │       │   └─ GET /cloudhub/api/applications  (CH1)
    │       ├─ Deduplicate by app name
    │       ├─ Store in session cache (20-min TTL)
    │       └─ Return { total, data[], environments[], orgId }
    │
    Frontend: merge all org results → unified sorted app list
```

### 4.3 Layered Caching Strategy

**Backend (session-level):**
- App summary: `req.session.summaryCache[orgId]` — 20-min TTL, `?refresh=true` bypasses

**Frontend (module-level, survives route navigation):**
- `apps:__all__:{bgId}` — app list per BG
- `ch2detail:{appId}:{envId}` — CH2 app detail (used by UserSearchPage)
- `ch1list:{bgId}:{envId}` — CH1 list per env (used by UserSearchPage)
- Business groups: loaded once per session from `/organizations/business-groups`

---

## 5. Authentication System

### 5.1 Three Login Modes

#### Mode 1 — Username / Password (Standard)

```
POST /api/auth/login  { username, password }
  Backend → POST anypoint.mulesoft.com/accounts/login
  Receives: access_token
  Calls: storeSession(req, access_token)
  Response: { success, user, orgId, orgName }
```

#### Mode 2 — Bearer Token (SSO Users via DevTools)

```
POST /api/auth/token-login  { token }
  Backend: strips "Bearer " prefix + trims whitespace/newlines
  Calls: storeSession(req, cleanToken)
  Specific error messages: 400 (invalid format) | 401 (expired) | 403 (insufficient permissions)
```

#### Mode 3 — Connected App (Recommended for SSO Orgs)

```
POST /api/auth/connected-app-login  { clientId, clientSecret }
  Backend → POST /accounts/api/v2/oauth2/token  (grant_type=client_credentials)
  Uses: URLSearchParams form-encoded body (required by Anypoint OAuth2)
  Calls: storeSession(req, access_token)
```

#### Demo Mode (No Credentials Required)

```
localStorage flag 'mulesoft_demo_mode' = 'true'
  All api.js calls intercepted → return mock data from mockData.js
  No backend calls made at all
  Full UI functional with realistic mock apps, envs, APIs, CPS properties
```

### 5.2 storeSession() — Called by All 3 Login Paths

After receiving a valid token, the backend executes this shared helper:

1. `GET /accounts/api/me` → full user profile
2. Finds root org: first org with no `parentId` in `memberOfOrganizations`
3. Extracts `user.roles[].contextParams.envId` → role-scoped environment set
4. Builds `accessibleEnvironments{}`: `orgId → env[]` filtered by user roles
5. Stores all to `req.session`:

```
req.session.token                  Anypoint bearer token (never sent to browser)
req.session.orgId                  Root organization ID
req.session.orgName                Root organization name
req.session.username               Anypoint username
req.session.memberOrgs[]           All BGs (avoids re-fetching on every BG call)
req.session.accessibleEnvironments{}  Map of orgId → filtered env[]
req.session.cpsCreds{}             CPS credentials (populated later by user)
req.session.summaryCache{}         20-min app summary cache per orgId
```

### 5.3 Auth Middleware

`authMiddleware.js` runs before every protected route:
- Checks `req.session.token` exists → 401 if missing
- Attaches `req.anypointToken`, `req.orgId`, `req.memberOrgs`, `req.accessibleEnvironments`
- Route handlers use `req.anypointToken` (never touch session directly)

### 5.4 Frontend Auth State (AuthContext)

```jsx
// Context values exposed to all components:
{ user, orgId, orgName, loading,
  login(username, password),
  tokenLogin(token),
  connectedAppLogin(clientId, clientSecret),
  demoLogin(),
  logout() }
```

On page reload: `checkSession()` calls `GET /api/auth/session` to restore state.  
On 401 from any API call: axios interceptor redirects to `/login` (with smart skip for resource-level 401s on CPS, Exchange, etc.).

---

## 6. Backend — Route-by-Route Analysis

### 6.1 `routes/auth.js`

| Method | Path | Description |
|---|---|---|
| POST | `/login` | Username/password auth |
| POST | `/token-login` | Bearer token auth |
| POST | `/connected-app-login` | OAuth2 client credentials |
| POST | `/logout` | session.destroy() |
| GET | `/session` | Returns user + orgId + memberOrgs + accessibleEnvironments |

### 6.2 `routes/applications.js`

| Method | Path | Description |
|---|---|---|
| GET | `/cloudhub2/:orgId/:envId` | Paginated CH2 app list |
| GET | `/cloudhub2/:orgId/:envId/:deploymentId` | CH2 detail enriched with `/settings` |
| GET | `/cloudhub2/:orgId/:envId/:deploymentId/schedulers` | CH2 schedulers |
| GET | `/cloudhub1/:envId` | CH1 list (includes full properties — no per-app detail needed) |
| GET | `/cloudhub1/:envId/:appName` | CH1 single app |
| GET | `/cloudhub1/:envId/:appName/static-ips` | CH1 static IPs (graceful 404) |
| GET | `/cloudhub1/:envId/:appName/schedules` | CH1 schedules |
| GET | `/cloudhub1/:envId/:appName/properties` | CH1 properties + infra metadata |
| POST | `/cloudhub1/:envId/:appName/action` | start/stop/restart with dual-strategy fallback |
| POST | `/cloudhub2/:orgId/:envId/:deploymentId/action` | start/stop/restart with PATCH fallback |
| GET | `/private-spaces/:orgId/:privateSpaceId` | Outbound static IPs for Private Spaces |
| GET | `/summary/:orgId` | Aggregated summary across all envs (20-min session cache) |

**CH1 Action — Dual Strategy:**
```
Strategy 1: POST /cloudhub/api/applications/:name/status { status: 'start' }
Strategy 2: PUT  /cloudhub/api/applications/:name { status: 'STARTED' }
Restart: native restart → if fails: stop + wait(4s) + start
```

**CH2 Action — With Fallback:**
```
Primary:  POST .../deployments/:id/start (dedicated endpoint)
Fallback: PATCH ... { application: { desiredState: 'STARTED' } }
Restart:  stop + wait(3s) + start  (RESTARTED not a valid desiredState)
```

**Summary Route Environment Filter:**  
`isProductionEnv()` skips environments whose names contain `dev`, `qa`. Includes: `production` type, or names matching `prod`, `uat`, `stage`, `stg`, `staging`, `performance`, `preprod`.

### 6.3 `routes/apis.js`

| Method | Path | Description |
|---|---|---|
| GET | `/app-client-id/:appId` | Resolve clientId from Exchange by numeric appId |
| GET | `/:orgId/:envId` | List API Manager instances (paginated) |
| GET | `/:orgId/:envId/:apiId` | Single API instance detail |
| GET | `/:orgId/:envId/:apiId/policies` | Applied policies |
| GET | `/:orgId/:envId/:apiId/contracts` | Consumer contracts |
| GET | `/:orgId/:envId/:apiId/tiers` | SLA tiers |
| GET | `/:orgId/:envId/:apiId/alerts` | API alerts |

The `/app-client-id/:appId` endpoint accepts `orgIds` (comma-separated) and tries each org in order — handles the case where an Exchange app's `masterOrgId` differs from the API Manager `orgId`.

### 6.4 `routes/organizations.js`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Current user's root org |
| GET | `/business-groups` | BG list (from session cache, then /me fallback, then BFS) |
| GET | `/:orgId` | Single org detail |
| GET | `/:orgId/members` | Org members (paginated) |

**Business Groups — 3-Tier Fallback:**
1. `req.memberOrgs` from session (set at login — fastest path)
2. Re-fetch from `/accounts/api/me`
3. BFS walk from root org using `subOrganizationIds` (slowest, most complete)

### 6.5 `routes/health.js`

| Method | Path | Description |
|---|---|---|
| POST | `/ping` | Endpoint discovery + HTTP health check |
| POST | `/auto-credentials` | 5-layer API Manager contract lookup |
| POST | `/auto-contract-creds` | Find/create Exchange contract + return credentials |
| POST | `/oauth2-token` | Server-side OAuth2 token proxy (avoids browser CORS) |

**Ping Path Discovery Order:**
```
/api/v1/ping  →  /api/v2/ping  →  /v1/ping  →  /v2/ping  →  /api/ping  →  /ping
Timeout: 30 seconds per attempt
SSL: rejectUnauthorized: false (internal CA certs)
```

**Ping Base URL Resolution:**
```
CH2: from ch2IngressUrl — split comma-separated, prefer non-internalapi URL
CH1 Production:     https://{appName}.internalapi.sfdcbt.net
CH1 Non-Production: https://{appName}.stage.internalapi.sfdcbt.net
```

**Ping Response Classification:**
```
SUCCESS  → HTTP < 300, not a "no listener" response
PARTIAL  → HTTP 400-499, OR HTTP 5xx with meaningful body (pingResponse/endpoints)
FAILED   → all paths failed or timed out
```

**Smart Path Skip Conditions (move to next path, not a failure):**
- HTTP 404
- Body contains: "No listener for endpoint", "No flow", "resource not found", "ENDPT_FAILURE"
- Structured: `{ error: [{ code: "404", status: "NOT_FOUND" }] }`

**Auto-Credentials 5-Layer Strategy:**
```
Layer 1: Direct api.id lookup (if apiId provided in request)
Layer 2: assetId-filtered paginated search in API Manager
Layer 3: Paginated fuzzy name match in deployment environment
Layer 4+: Outer catch-all fallback
Fuzzy matching: stripDeploymentSuffix() normalizes names before comparison
```

### 6.6 `routes/cps.js`

| Method | Path | Description |
|---|---|---|
| GET | `/credentials` | List all stored CPS credentials (masked clientIds) |
| POST | `/credentials` | Store credentials by url, url::bgOrgId, or legacy key |
| DELETE | `/credentials/:key` | Remove specific credential |
| GET | `/fetch` | Fetch CPS properties (non-secure/secure/binaries) |
| POST | `/search-user` | Fan-out username search across all app CPS properties |

**CPS Credential Key Formats:**
```
url::bgOrgId  →  "https://cps.example.com::org-uuid-here"  (primary — per-server × per-BG)
url           →  "https://cps.example.com"                 (per-server fallback)
legacy        →  "ch1_prod" | "ch2_prod" | "ch1_uat" | "ch2_uat"
env vars      →  CPS_CH1_PROD_CLIENT_ID / CPS_CH1_PROD_CLIENT_SECRET
```

**CPS Property Types and API Paths:**
```
non-secure       → /api/v2/properties/non-secure
non-secure-all   → /api/v2/properties/non-secure/all
secure           → /api/v2/properties/secure
secure-all       → /api/v2/properties/secure/all
binaries         → /api/v2/binaries/secure
binaries-auth    → /api/v2/binaries/secure/auth
```

**Intelligent CPS Credential Retry:**  
If primary credential returns HTTP 401 or HTTP 200 with "COULD NOT ACCESS" string, the route batches all alternative credentials from session (in batches of 5) and tries them in parallel. The first one that returns valid data is promoted to the primary key for future requests.

**User Search Fan-out (`POST /search-user`):**  
Accepts a `username` + array of `apps[]`. Scans each app's non-secure CPS properties for the username value. If `cps.secure.properties` key exists, also scans secure properties. Runs in concurrency batches of 30. Returns matched properties including secure group key, related password field (masked), and source type.

---

## 7. Backend — Utility Layer

### 7.1 `anypointClient.js`

Creates an authenticated Axios instance for every route handler:

```javascript
createClient(token) → axios.create({
  baseURL: ANYPOINT_URL,   // env var or https://anypoint.mulesoft.com
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  timeout: 30000
})
```

### 7.2 `appHelpers.js`

| Function | Purpose |
|---|---|
| `normalizeStatus(raw)` | Maps CH1/CH2 raw status strings → RUNNING / STOPPED / DEPLOYING / FAILED / UNKNOWN |
| `parseCH2Apps(data)` | Handles all CH2 response shapes: `items`, `deployments`, `content`, `data` array |
| `makeCh1Headers(envId, orgId)` | Builds `X-ANYPNT-ENV-ID` + `X-ANYPNT-ORG-ID` headers |
| `isProductionEnv(env)` | Excludes dev/qa envs from summary aggregation |
| `stripDeploymentSuffix(name)` | Strips region+env suffix (e.g. `-uw2-up`, `-v1`, `-prod`) for fuzzy matching |
| `extractCH2IngressUrl(deployment)` | Extracts external ingress URL from `target.gateway[]` or `target.ingressUrl` |

**Status mapping (CH1 → canonical):**

| Raw Status | Canonical |
|---|---|
| started, running | RUNNING |
| undeployed, stopped, not_running | STOPPED |
| deploy_failed | FAILED |
| deploying, updating, restarting | DEPLOYING |
| partially_started, applying_changes | DEPLOYING |

### 7.3 `orgHelpers.js`

`mapOrgShape(org)` normalizes any Anypoint org object to:
`{ id, name, domain, type, parentId, subOrganizationIds }`  
Used in `auth.js` (login) and `organizations.js` (BFS fallback) to ensure consistent shape.

### 7.4 `exchangeHelpers.js`

`fetchExchangeAppCreds(client, orgId, appId)` — two-strategy credential lookup:
1. `GET /exchange/api/v2/organizations/:orgId/applications/:appId/credentials`
2. `GET /exchange/api/v2/organizations/:orgId/applications/:appId` (inline fallback)

Never throws — returns `{ clientId: null, clientSecret: null }` on failure.

### 7.5 `responseHelpers.js`

`sendProxyError(res, error, fallbackMessage)`:
- Uses upstream HTTP status if available, else 500
- Uses `error.response.data.message` → `.error` → `error.message` → fallback
- Logs at console.error level (skips 401/403 noise)
- Ensures every route returns the same JSON shape: `{ error: "message" }`

---

## 8. Frontend — Context and State

### 8.1 `AuthContext`

**Provider wraps entire app.** Exposes:

| Value/Method | Description |
|---|---|
| `user` | `{ id, username, firstName, lastName, email, organization }` |
| `orgId` | Root org UUID |
| `orgName` | Root org display name |
| `loading` | True during initial session check |
| `login(u, p)` | Username/password login |
| `tokenLogin(token)` | Bearer token login |
| `connectedAppLogin(cid, cs)` | Connected App login |
| `demoLogin()` | Enable demo mode (no backend) |
| `logout()` | Clear session + disable demo mode |

`checkSession()` runs on mount — calls `GET /api/auth/session` to restore state across page reload.

### 8.2 `CredentialStoreContext` (Ping Credentials)

In-memory `Map<clientId, clientSecret>` for ping test credentials.  
Loaded from CSV via `CredentialImportButton`. Survives route navigation (React state), cleared on page reload or explicit clear.

### 8.3 `CpsCredentialStoreContext` (CPS Credentials)

Separate in-memory store for CPS credentials loaded from CSV.  
Exposes: `getAllCredentials()`, `getCredentialFor(clientId)`, `getSecret(clientId)`, `hasCredentials`, `loadFromCsv()`, `clear()`.

---

## 9. Frontend — Services Layer

### 9.1 `api.js` — Unified HTTP Client

```javascript
// Axios instance with session cookie
axiosClient = axios.create({
  baseURL: '/api',
  withCredentials: true
})

// 401 interceptor — redirects to /login on session expiry
// Smart skip: does NOT redirect for CPS, Exchange, environments, applications/summary
// (these can legitimately return 401 for per-resource access)

// Demo mode — intercepts all calls, returns mock data from mockData.js
// Controlled by localStorage flag 'mulesoft_demo_mode'
```

**Smart 401 Skip URLs** (per-resource access, not session expiry):
- `/applications/summary` — BG access check
- `/environments/` — env fetch for restricted BG
- `/cps/` — CPS credential issues
- `/exchange/` — Exchange asset access
- `/apis/` — API Manager access

### 9.2 `apiCache.js` — Module-Level Cache

Provides `getCached(key)` / `setCached(key, data, ttlMs)` backed by a module-level `Map`. Default TTL: 5 minutes. Used by `UserSearchPage` to avoid re-fetching CH2 app details during search.

### 9.3 `mockData.js` — Demo Mode Dataset

Contains complete mock data for all pages:
- `MOCK_USER`, `MOCK_ENVIRONMENTS`, `MOCK_APPS`, `MOCK_APP_DETAIL`
- `MOCK_BUSINESS_GROUPS`, `MOCK_MEMBERS`, `MOCK_METRICS`
- `MOCK_APIS`, `MOCK_POLICIES`
- `MOCK_EXCHANGE_ASSETS`, `MOCK_EXCHANGE_SUMMARY`

---

## 10. Frontend — Pages

### 10.1 `LoginPage`

Three auth tabs (Connected App | Username/Password | Bearer Token) + Demo Mode button.
- Connected App tab: shows setup instructions + required Anypoint scopes
- Bearer Token tab: collapsible DevTools guide for SSO users
- All forms: show/hide password toggle, loading state, error display
- Demo button: purple gradient, prominent placement above the form

### 10.2 `ApplicationsPage`

Most feature-rich page. Core responsibilities:
- Load apps across all selected BGs (parallel `Promise.allSettled`)
- Filter: BG selector, env filter, status filter, type filter (CH1/CH2), search
- Table: checkbox multi-select, floating selected rows, status badges, env color dots
- Actions: per-row + bulk start/stop/restart with confirmation dialog
- Bulk Ping: launches `PingTestPanel` or navigates to `/ping-test`
- Import Credentials CSV → `CredentialStoreContext`
- Export CPS → `CpsExportModal`
- BG Filter modal → persisted BG selection

### 10.3 `ApplicationDetailPage`

Six-tab deep-dive for a single application (URL: `/applications/:orgId/:envId/:appId`):

| Tab | Contents |
|---|---|
| Overview | Status badge, runtime version, region, workers/replicas, ARM link |
| Properties | Deployment property placeholders from ARM descriptor |
| Infra & Config | Worker size, autoscaling, persistent queues, VPC, static IPs |
| CPS Config | Live CPS key-value pairs fetched from CPS API |
| Ping Test | Embedded `PingTestPanel` component |
| Raw JSON | Full ARM API response for debugging |

### 10.4 `ApiManagerPage`

Lists API Manager instances with expandable rows showing:
- Applied policies with human-readable names
- Consumer contracts: app name, clientId (with multi-path fallback), status, SLA tier
- Alerts configuration

### 10.5 `ExchangePage`

Exchange asset browser with:
- BG selector + asset type filter + search
- Asset list → click to open detail panel (right side)
- Detail panel: description, version, classifier, tags, portal link
- Auto-selects asset when navigated from another page with `location.state`

### 10.6 `PingTestPage`

Read-only results viewer populated from a bulk ping run:
- Summary bar: total tested, healthy, partial, failed, auto-creds count
- Results table sorted: Healthy → Partial → Unreachable
- Expandable rows: credential detail, full URL, error, response payload, attempt log
- Export CSV (10 columns)
- Empty state with redirect if navigated directly without prior ping run

### 10.7 `CpsComparisonPage`

Side-by-side CPS property diff tool:
- Two configurable side panels (Side A / Side B)
- Each side: BG selector → env selector → app selector → property type selector
- CPS config auto-populated from app's ARM deployment properties
- Collapsible panels after compare — maximizes diff table space
- Single-app mode + All Apps multi-app accordion mode
- Diff table: DIFF (red) | A ONLY (blue) | B ONLY (orange) | MATCH (green)
- Filter tabs: All / Different / Only A / Only B / Matching
- Word-level diff modal on row click
- Export CSV

### 10.8 `UserSearchPage`

Global CPS property search:
- BG + Environment multi-selector with search/filter
- Flat environment list (no expand/collapse tree)
- Loads CH2 details in parallel batches of 50; uses `apiCache` for efficiency
- Sends batch to `/cps/search-user` backend for server-side scanning
- Results table: 9 columns including secure group key and masked password
- Export CSV with all matches
- Progress bar showing envs scanned / apps found / matches

---

## 11. Frontend — Components

| Component | Purpose |
|---|---|
| `Layout` | App shell — collapsible sidebar (w-14/w-52) + `<Outlet>` for page content |
| `Sidebar` | NavLinks with active highlighting; shows org name; links to MuleSoft docs |
| `Header` | Global BG filter, env filter, CPS credential import, ping credential import buttons |
| `PingTestPanel` | Single-app ping with OAuth2 auto-fetch support; embedded in App Detail |
| `PingResultCard` | Shows status badge, HTTP code, latency, payload snippet for one ping result |
| `AttemptLog` | Table of per-path ping attempts: URL, status/error, latency |
| `CpsExportModal` | Scope selection + trigger for CPS → xlsx export |
| `CpsSettingsModal` | Configure CPS base URL, prefix, project key overrides |
| `CpsCredentialImportButton` | Upload CSV → parse → store in `CpsCredentialStoreContext` |
| `CredentialImportButton` | Upload CSV → parse → store in `CredentialStoreContext` |
| `BgFilterModal` | Checkbox list of all BGs; saves selection; shows N/M badge when active |
| `EnvFilterModal` | Filter visible environments by type/name |
| `Select` | Styled dropdown component used in filter areas |
| `StatCard` | Dashboard metric card with icon, value, label, color variant |
| `StatusBadge` | Color-coded pill: RUNNING (green) / STOPPED (gray) / FAILED (red) / DEPLOYING (yellow) |
| `CopyBtn` | Click-to-copy clipboard button with animated check confirmation |

---

## 12. Frontend — Utilities

### 12.1 `cpsHelpers.js`

| Function | Purpose |
|---|---|
| `extractCpsConfig(appDetail)` | Reads ARM deployment properties to extract `cpsBaseUrl`, `cpsKey`, `cpsEnv`, `cpsClientId` |
| `flattenCpsResponse(data, appKey)` | Normalizes 4 CPS response shapes into flat `{ key: value }` map |
| `findApiIdInProps(props)` | Locates Anypoint Autodiscovery API ID in CPS props (4-priority heuristic) |
| `findOAuth2Url(props)` | Scans CPS props for OAuth2 token endpoint URL |
| `normaliseCpsUrl(url)` | Strips trailing slashes and `/api/v2` suffix |

**`extractCpsConfig` property source priority:**
1. `mule.agent.application.properties.service.properties`
2. `target.deploymentSettings.properties`
3. `target.deploymentSettings.environmentVariables`
4. `appDetail.properties` (top-level)

**`flattenCpsResponse` handles 4 shapes:**
1. `{ responses: [{ key, properties: {k:v} }] }` — standard CPS response
2. `[{ key, properties: {k:v} }]` — array form
3. `{ properties: [{ key, value }] }` — key/value pair array
4. `{ k: v }` — flat map

### 12.2 `csvCredentialStore.js`

- `parseCsvLine(line)` — handles quoted fields and comma/semicolon delimiters
- `parseCsvToCredentialMap(text)` — auto-detects header row (first cell ≥ 16 chars = data, else header); returns `Map<clientId, clientSecret>`
- Accepts both `clientId,clientSecret` and `client_id,client_secret` column names

### 12.3 `exportCps.js`

Generates CPS export to `.xlsx` / `.csv` using the `xlsx` library. Accepts app list + CPS fetch results; formats into structured spreadsheet with app name, environment, property key, value columns.

---

## 13. Feature Deep-Dives

### 13.1 Bulk Ping — End-to-End Flow

```
1. User selects apps on ApplicationsPage → clicks "Ping Test" or "Ping (N)"
2. PingTestPanel / BulkPingModal opens
3. If CSV credentials loaded: auto-credential resolution runs
   │  POST /api/health/auto-credentials for each app
   │  → Searches API Manager for matching API instance
   │  → Returns clientIds from approved contracts
   │  → Frontend matches clientId against loaded CSV → gets clientSecret
4. Pings run in parallel batches of 10:
   │  POST /api/health/ping { appName, ch2IngressUrl, clientId, clientSecret, ... }
   │  → Backend resolves base URL
   │  → Tries paths: /api/v1/ping → /api/v2/ping → /v1/ping → /v2/ping → /api/ping → /ping
   │  → Returns { status: SUCCESS|PARTIAL|FAILED, activeEndpoint, httpStatus, latency, payload, attempts[] }
5. Results navigate to /ping-test via React Router location.state
6. PingTestPage renders results table sorted Healthy → Partial → Unreachable
7. Export CSV available (10 columns)
```

### 13.2 CPS Compare — End-to-End Flow

```
1. User opens /cps-compare
2. Imports CPS credentials CSV (once per session)
3. Configures Side A: BG → Environment → Application
   │  App selection triggers ARM property extraction (extractCpsConfig)
   │  CPS Base URL, Env prefix, Project key auto-populated
4. Configures Side B: same process
5. Clicks "Compare":
   │  Frontend calls GET /api/cps/fetch for Side A and Side B in parallel
   │  Each call: backend resolves credentials (url::bgOrgId key priority)
   │  Returns flat property map
6. Side panels collapse automatically
7. Diff table computed:
   │  All keys from both sides merged → sorted alphabetically
   │  Status per key: DIFF | A ONLY | B ONLY | MATCH
8. Word-level diff modal: tokenizes values, highlights changed tokens
9. Export CSV: all keys + both values + status
```

### 13.3 Global CPS Search — End-to-End Flow

```
1. User opens /user-search
2. Selects BG/env combinations from flat BgEnvSelector
3. Enters search term (min 3 chars) → clicks Search
4. Phase 1 (parallel): fetch apps for all selected envs
   │  For each env:
   │  ├─ CH2: check apiCache → fresh list fetch (paginated) → detail fetch batch (50 parallel)
   │  └─ CH1: check apiCache → fresh list (returns full properties — no detail needed)
   │  Fire-and-forget credential posting to /api/cps/credentials
5. Phase 2: deduplicate entries by cpsUrl+cpsKey+cpsEnv+bgOrgId
6. Phase 3: POST /api/cps/search-user { username, apps[] }
   │  Backend scans non-secure properties for username value
   │  If cps.secure.properties key exists → also scans secure groups
   │  Concurrency: 30 apps in parallel
   │  Returns: [{ appName, matchedProps: [{ key, value, source, secureGroupKey, password }] }]
7. Results rendered in 9-column table with copy buttons
8. Export CSV
```

### 13.4 App Lifecycle Actions — Resilience Design

For both CH1 and CH2, the action endpoints implement dual/triple-strategy fallback to handle API version differences across Anypoint Platform regions:

```
CH1 Start:
  Try: POST /cloudhub/api/applications/:name/status { status: 'start' }
  Fallback: PUT /cloudhub/api/applications/:name { status: 'STARTED' }

CH1 Restart:
  Try: POST .../status { status: 'restart' }
  Fallback: POST .../status { status: 'stop' } → wait 4s → POST .../status { status: 'start' }
  Final fallback: same with PUT strategy

CH2 Start:
  Try: POST .../deployments/:id/start
  Fallback: PATCH .../deployments/:id { application: { desiredState: 'STARTED' } }

CH2 Restart:
  Try: POST .../deployments/:id/restart
  Fallback: PATCH stop → wait 3s → PATCH start
```

---

## 14. Security Analysis

### 14.1 Strengths

| Aspect | Implementation |
|---|---|
| Bearer token isolation | Token stored only in `express-session` server-side; never sent to browser |
| Session cookie | `httpOnly` by default via `express-session`; 24hr TTL |
| Credential memory isolation | Ping creds in React state; CPS creds in React state; neither in localStorage |
| CORS restriction | Only `:5173` and `:3000` allowed with credentials |
| No credential logging | Credentials masked in console.log (shows first 8 chars only) |
| SSL bypass scoped | `rejectUnauthorized: false` only for ping health checks; not for Anypoint API calls |
| Demo mode isolation | Mock data returns no real credentials or sensitive data |

### 14.2 Security Considerations

| Issue | Risk | Recommendation |
|---|---|---|
| `SESSION_SECRET` defaults to hardcoded value | Medium — session forgeable in dev if not changed | Enforce non-default in prod startup |
| `cookie: { secure: false }` | Medium — cookie sent over HTTP | Set `secure: true` behind HTTPS reverse proxy |
| `rejectUnauthorized: false` for pings | Low — MITM risk on ping endpoints | Document clearly; consider making configurable |
| No rate limiting on login | Medium — brute-force possible | Add `express-rate-limit` to auth routes |
| No CSRF protection | Low — SPA with CORS restriction; session cookie is `SameSite` default | Add `csurf` or `SameSite=Strict` for production |
| 50MB JSON body limit | Low — potential DoS on body parsing | Scope large limit only to CPS routes |

---

## 15. Performance Patterns

### 15.1 Parallelism

| Operation | Pattern | Batch Size |
|---|---|---|
| All Orgs app list | `Promise.allSettled` per org | All orgs in parallel |
| Per-org env scan | `Promise.all` per env | All envs in parallel |
| Bulk ping | Sequential batches of 10 | 10 concurrent |
| CH2 detail fetch (UserSearch) | `Promise.allSettled` batches | 50 concurrent |
| CPS credential retry | `Promise.allSettled` batches | 5 concurrent |
| CPS user search | `Promise.allSettled` batches | 30 concurrent |
| Auto-credentials | `Promise.allSettled` batches | 5 APIs in parallel |

### 15.2 Caching

| Cache | Location | TTL | Key |
|---|---|---|---|
| App summary | Backend session | 20 min | `summaryCache[orgId]` |
| BG list | Backend session | Login lifetime | `memberOrgs[]` |
| App list | Frontend module | 5 min | `apps:__all__:{bgId}` |
| CH2 detail | Frontend module | 5 min | `ch2detail:{appId}:{envId}` |
| CH1 list | Frontend module | 5 min | `ch1list:{bgId}:{envId}` |

### 15.3 Optimization Notes

- CH1 list API returns full properties directly — no per-app detail call needed (significant time saving for large estates)
- CH2 requires per-app detail fetch — mitigated by 50-parallel batches + frontend cache
- Business groups cached in session at login — zero extra API calls on BG dropdown loads
- CPS credentials auto-promoted when a working credential is found — reduces retries on subsequent pages

---

## 16. Code Quality Assessment

### 16.1 Strengths

| Pattern | Where Applied |
|---|---|
| **Separation of concerns** | Routes only handle HTTP; business logic in utils; data normalization centralized |
| **DRY utilities** | `appHelpers`, `orgHelpers`, `exchangeHelpers`, `responseHelpers` prevent logic drift |
| **Resilient async** | `Promise.allSettled` used consistently — partial failures never block full results |
| **Typed JSDoc** | Key utility functions documented with `@param` + `@returns` annotations |
| **Consistent error shape** | `sendProxyError()` ensures every route returns `{ error: "message" }` |
| **Smart fallbacks** | Action endpoints, BG lookup, credential resolution all have multi-tier fallbacks |
| **No UI whitescreens** | Every async operation wrapped in try/catch with error state display |
| **Demo mode** | Full mock dataset allows UI testing without Anypoint credentials |

### 16.2 Areas for Improvement

| Area | Current State | Suggested Improvement |
|---|---|---|
| TypeScript | Plain JavaScript throughout | Migrate to TypeScript for type safety |
| Unit tests | No test files found | Add Jest/Vitest for utils and route handlers |
| ESLint / Prettier | No config files found | Add linting and formatting config |
| Error boundaries | No React error boundaries | Add `<ErrorBoundary>` for page-level error isolation |
| Loading skeletons | Spinner-only loading states | Add skeleton placeholders for better perceived performance |
| Pagination on app list | Client-side filter only | Add server-side pagination for very large estates |

---

## 17. Known Gaps and Improvement Opportunities

### 17.1 Missing Features (Referenced in README but Not in Codebase)

| Feature | Status | Notes |
|---|---|---|
| `BulkPingModal.jsx` | Not found as separate file | Functionality appears embedded in `ApplicationsPage` |
| `DashboardPage.jsx` | Not found in pages | README mentions it; App.jsx redirects `/` to `/applications` |
| `BusinessGroupsPage.jsx` | Not found in pages | README mentions it; no route in App.jsx |
| `EnvironmentsPage.jsx` | Not found in pages | README mentions it; no route in App.jsx |
| WebSocket / real-time updates | Not implemented | Data is snapshot-only on page load |

### 17.2 Production Readiness Gaps

| Gap | Impact | Fix |
|---|---|---|
| Session store is in-memory | Lost on server restart; not scalable | Use `connect-redis` or `connect-mongo` |
| No HTTPS enforcement | Token in plaintext cookie on HTTP | Configure `cookie: { secure: true }` + reverse proxy |
| No rate limiting | Login brute-force possible | Add `express-rate-limit` on auth routes |
| Hardcoded session secret default | Security risk in production | Fail fast if `SESSION_SECRET` not set |
| No health check endpoint logging | Hard to monitor uptime | Add structured logging (e.g., `pino`) |
| No request ID / correlation ID | Hard to trace specific requests in logs | Add `req.id` middleware |

### 17.3 Enhancement Ideas

| Enhancement | Value |
|---|---|
| Token refresh / auto re-login | Avoid mid-session 401 disruptions |
| Websocket for live app status | Replace manual refresh |
| Deployment history per app | Show last N deployments |
| CPS diff export to Excel (multi-sheet) | Better formatted reports |
| Notifications / alerts inbox | Surface Anypoint alert events |
| Multi-tab support | Currently single-session per browser tab |
| App grouping by API layer (Exp/Proc/Sys) | API-led connectivity visualization |

---

## 18. Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `5000` | No | Express server port |
| `SESSION_SECRET` | `mulesoft-dashboard-secret` | **Yes in prod** | Session signing secret — change for production |
| `ANYPOINT_PLATFORM_URL` | `https://anypoint.mulesoft.com` | No | Anypoint base URL (for PCE/GOV override) |
| `CPS_CH1_PROD_CLIENT_ID` | — | No | CPS CH1 production client ID (optional env var auth) |
| `CPS_CH1_PROD_CLIENT_SECRET` | — | No | CPS CH1 production client secret |
| `CPS_CH2_PROD_CLIENT_ID` | — | No | CPS CH2 production client ID |
| `CPS_CH2_PROD_CLIENT_SECRET` | — | No | CPS CH2 production client secret |
| `CPS_CH1_UAT_CLIENT_ID` | — | No | CPS CH1 UAT client ID |
| `CPS_CH1_UAT_CLIENT_SECRET` | — | No | CPS CH1 UAT client secret |
| `CPS_CH2_UAT_CLIENT_ID` | — | No | CPS CH2 UAT client ID |
| `CPS_CH2_UAT_CLIENT_SECRET` | — | No | CPS CH2 UAT client secret |

---

## 19. Complete API Route Reference

All routes are prefixed with `/api` in the Express server.

### Auth — `/api/auth`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Username/password login |
| POST | `/api/auth/token-login` | No | Bearer token login |
| POST | `/api/auth/connected-app-login` | No | OAuth2 Connected App login |
| POST | `/api/auth/logout` | No | Destroy session |
| GET | `/api/auth/session` | No | Check session state |

### Applications — `/api/applications`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/applications/summary/:orgId` | Yes | Aggregated app summary (20-min cache) |
| GET | `/api/applications/cloudhub2/:orgId/:envId` | Yes | CH2 app list (paginated) |
| GET | `/api/applications/cloudhub2/:orgId/:envId/:deploymentId` | Yes | CH2 app detail |
| GET | `/api/applications/cloudhub2/:orgId/:envId/:deploymentId/schedulers` | Yes | CH2 schedulers |
| POST | `/api/applications/cloudhub2/:orgId/:envId/:deploymentId/action` | Yes | CH2 start/stop/restart |
| GET | `/api/applications/cloudhub1/:envId` | Yes | CH1 app list |
| GET | `/api/applications/cloudhub1/:envId/:appName` | Yes | CH1 single app |
| GET | `/api/applications/cloudhub1/:envId/:appName/static-ips` | Yes | CH1 static IPs |
| GET | `/api/applications/cloudhub1/:envId/:appName/schedules` | Yes | CH1 schedules |
| GET | `/api/applications/cloudhub1/:envId/:appName/properties` | Yes | CH1 properties |
| POST | `/api/applications/cloudhub1/:envId/:appName/action` | Yes | CH1 start/stop/restart |
| GET | `/api/applications/private-spaces/:orgId/:privateSpaceId` | Yes | Private Space details |

### API Manager — `/api/apis`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/apis/app-client-id/:appId` | Yes | Resolve clientId from Exchange |
| GET | `/api/apis/:orgId/:envId` | Yes | List API instances |
| GET | `/api/apis/:orgId/:envId/:apiId` | Yes | Single API instance |
| GET | `/api/apis/:orgId/:envId/:apiId/policies` | Yes | Applied policies |
| GET | `/api/apis/:orgId/:envId/:apiId/contracts` | Yes | Consumer contracts |
| GET | `/api/apis/:orgId/:envId/:apiId/tiers` | Yes | SLA tiers |
| GET | `/api/apis/:orgId/:envId/:apiId/alerts` | Yes | API alerts |

### Organizations — `/api/organizations`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/organizations` | Yes | Current root org |
| GET | `/api/organizations/business-groups` | Yes | All BGs (session-cached) |
| GET | `/api/organizations/:orgId` | Yes | Single org detail |
| GET | `/api/organizations/:orgId/members` | Yes | Org members |

### Environments — `/api/environments`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/environments/:orgId` | Yes | Environments for an org |

### Exchange — `/api/exchange`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/exchange/search` | Yes | Search Exchange assets |
| GET | `/api/exchange/org/:orgId/summary` | Yes | Exchange summary stats |

### Metrics — `/api/metrics`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/metrics/summary` | Yes | Aggregated throughput + error metrics |

### CPS — `/api/cps`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/cps/credentials` | Yes | List stored CPS credentials |
| POST | `/api/cps/credentials` | Yes | Store CPS credentials |
| DELETE | `/api/cps/credentials/:key` | Yes | Delete specific credential |
| GET | `/api/cps/fetch` | Yes | Fetch CPS properties |
| POST | `/api/cps/search-user` | Yes | Fan-out CPS username search |

### Health / Ping — `/api/health`

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| POST | `/api/health/ping` | Yes (session) | HTTP health check with path discovery |
| POST | `/api/health/auto-credentials` | Yes | Auto-resolve credentials from API Manager |
| POST | `/api/health/auto-contract-creds` | Yes | Create/reuse Exchange contract for credentials |
| POST | `/api/health/oauth2-token` | No | Server-side OAuth2 token proxy |

### Server Health

| Method | Full Path | Auth Required | Description |
|---|---|---|---|
| GET | `/api/ping` | No | Express server liveness check |

---

## Summary

The MuleSoft Integration Dashboard is a **well-architected, production-quality** operations tool that successfully automates the most common manual Anypoint Platform tasks. Key architectural highlights:

1. **Security-first proxy pattern** — bearer token never leaves the backend session
2. **3-mode authentication** covering all Anypoint access scenarios (U/P, SSO via token, Connected App)
3. **Comprehensive CPS automation** — auto-extraction from ARM properties, intelligent credential retry, cross-env diff, global search
4. **Resilient bulk operations** — `Promise.allSettled` at every fan-out level prevents single-BG failures from blocking results
5. **Demo mode** — zero-friction onboarding without any Anypoint credentials
6. **Two-layer caching** (backend session + frontend module) minimizes redundant API calls
7. **Smart ping engine** — 6-path discovery, dual CH1/CH2 base URL resolution, 5-layer credential auto-resolution

**Primary improvement opportunities:** TypeScript migration, production session store, rate limiting on auth routes, and unit test coverage for the utility layer.

---

*Reference: [MuleSoft Anypoint Platform Documentation](https://docs.mulesoft.com/general/)*
