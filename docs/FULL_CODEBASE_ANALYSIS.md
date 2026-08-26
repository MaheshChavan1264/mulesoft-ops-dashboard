# MuleSoft Integration Dashboard — Full Codebase Analysis

**Generated:** August 2026  
**Analyst:** MuleSoft Developer Agent  
**Codebase:** `mulesoft-dashboard` (git `0e606a2`)  

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Tech Stack](#2-tech-stack)
3. [Complete File Structure](#3-complete-file-structure)
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
17. [Known Bugs and Issues](#17-known-bugs-and-issues)
18. [Environment Variables Reference](#18-environment-variables-reference)
19. [Complete API Route Reference](#19-complete-api-route-reference)
20. [Recommendations](#20-recommendations)

---

## 1. Project Overview

The **MuleSoft Integration Dashboard** is a full-stack web application that acts as a **secure reverse proxy** to Anypoint Platform APIs. It gives platform operators a single-pane-of-glass view of their entire MuleSoft estate — deployed applications, API Manager instances, Exchange assets, CPS (Config Property Server) properties, and live health checks.

### 1.1 Core Design Principles

1. **Security-first proxy pattern** — Anypoint bearer token stored exclusively in `express-session` on the backend; the browser never sees it.
2. **Automation over manual steps** — bulk operations, auto credential resolution, auto CPS config extraction from ARM deployment descriptors.
3. **Resilience** — `Promise.allSettled` everywhere; one failing BG/env never blocks the full page.
4. **Graceful degradation** — 404s, 403s, missing fields all handled with fallbacks; no white screens.
5. **Demo mode** — full mock dataset; fully usable with zero Anypoint credentials.

### 1.2 Manual Tasks Eliminated

| Manual Task | Estimated Time | Dashboard Solution |
|---|---|---|
| Log into ARM per BG/env to check app status | 5–15 min/day | Applications page — all BGs aggregated |
| Manually verify CPS property values per app | 10–30 min/release | App Detail → CPS Config tab |
| Compare UAT vs Production CPS configs | 30–60 min/release | CPS Compare side-by-side diff |
| Smoke-test all apps before a release | 1–2 hrs/release | Bulk Ping with auto credential resolution |
| Find which app uses a specific service account | Hours | Global CPS Search fan-out |
| Check API consumers and applied policies | 15–30 min | API Manager page |
| Browse Exchange for published APIs/connectors | 5–10 min | Exchange browser |

---

## 2. Tech Stack

### 2.1 Backend (`backend/`)

| Package | Version | Purpose |
|---|---|---|
| `express` | ^4.18.2 | HTTP framework |
| `axios` | ^1.6.0 | Anypoint API proxy calls |
| `express-session` | ^1.17.3 | Server-side session (bearer token storage) |
| `express-rate-limit` | ^8.6.2 | Auth route brute-force protection |
| `cors` | ^2.8.5 | CORS — whitelists `:5173` and `:3000` |
| `dotenv` | ^16.3.1 | `.env` config loading |
| `js-yaml` | ^5.2.3 | YAML parsing for Exchange spec files |
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
| `axios` | ^1.6.0 | HTTP client + 401 interceptor + demo mock layer |
| `xlsx` | ^0.18.5 | Excel/CSV export for CPS and ping results |

### 2.3 Anypoint Platform APIs Consumed

| API Category | Key Endpoints |
|---|---|
| Accounts | `/accounts/login`, `/accounts/api/me`, `/accounts/api/v2/oauth2/token` |
| ARM CloudHub 1.0 | `/cloudhub/api/v2/applications`, `/cloudhub/api/applications` |
| ARM CloudHub 2.0 | `/amc/application-manager/api/v2/.../deployments` |
| API Manager | `/apimanager/api/v1/.../apis`, policies, contracts, SLA tiers, alerts |
| Anypoint Exchange | `/exchange/api/v2/assets`, credentials, portal model |
| Runtime Fabric | `/runtimefabric/api/organizations/.../privatespaces` |
| CPS | `/api/v2/properties/non-secure`, `/secure`, `/binaries`, `/binaries/secure/auth` |
| Organizations | `/accounts/api/organizations/:id`, `/environments`, `/members` |

---

## 3. Complete File Structure

```
mulesoft-dashboard/
├── README.md                          Full feature documentation
├── CODEBASE_ANALYSIS.md               Previous analysis document
├── BUG_FIX_PLAN.md                    Bug tracking with fix status
├── SOP-Dashboard-Usage.md             Operator SOP v1.2
├── jsconfig.json
├── docs/
│   └── global-search-bugs.md          Bug report: UserSearchPage + cps.js (11 bugs)
│
├── backend/
│   ├── .env.example
│   ├── package.json
│   ├── package-lock.json
│   └── src/
│       ├── server.js                  Express entry: CORS + session + rate-limit + routes
│       ├── middleware/
│       │   └── authMiddleware.js      session.token → req.anypointToken + req.orgId
│       ├── routes/
│       │   ├── auth.js                3 login modes + storeSession() + logout + session check
│       │   ├── applications.js        CH1+CH2 list/detail/actions + 20-min summary cache
│       │   ├── apis.js                API Manager: instances, policies, contracts, tiers, alerts
│       │   ├── organizations.js       BG hierarchy (3-tier fallback: session→/me→BFS)
│       │   ├── environments.js        Env listing with role-based accessibility filtering
│       │   ├── exchange.js            Search + ping-spec (AMF JSON-LD/OAS/RAML parser)
│       │   ├── metrics.js             CH1+CH2 aggregated metrics summary
│       │   ├── cps.js                 CPS CRUD + credential retry + user search fan-out
│       │   └── health.js              Ping (6-path) + auto-credentials (3-layer) + OAuth2 proxy
│       └── utils/
│           ├── anypointClient.js      createClient(token) → axios factory, 30s timeout
│           ├── appHelpers.js          normalizeStatus, parseCH2Apps, isProductionEnv,
│           │                          makeCh1Headers, stripDeploymentSuffix, uniqueProductionEnvs
│           ├── orgHelpers.js          mapOrgShape → canonical org normalizer
│           ├── exchangeHelpers.js     fetchExchangeAppCreds (2-strategy lookup)
│           └── responseHelpers.js     sendProxyError → unified error JSON shape
│
└── frontend/
    ├── vite.config.js                 Proxy /api→:5000; 2-min timeout; port 5173
    ├── tailwind.config.js
    ├── postcss.config.js
    └── src/
        ├── App.jsx                    React Router + ProtectedRoute + 3 Context providers
        ├── main.jsx
        ├── index.css
        ├── context/
        │   ├── AuthContext.jsx         user, orgId, orgName; 3 logins + demo + logout
        │   ├── CredentialStoreContext.jsx  Ping creds → in-memory Map (never persisted)
        │   └── CpsCredentialStoreContext.jsx  CPS creds → Map + getAllCredentials()
        ├── services/
        │   ├── api.js                 Axios + demo mock interceptor + 401 redirect guard
        │   ├── apiCache.js            Module-level Map cache: getCached/setCached/bustCache
        │   └── mockData.js            Full demo dataset (apps, APIs, envs, Exchange assets)
        ├── pages/
        │   ├── LoginPage.jsx          3-tab auth form + demo button
        │   ├── ApplicationsPage.jsx   Filterable table + bulk ping modal + bulk actions
        │   ├── ApplicationDetailPage.jsx  8-tab deep-dive per app
        │   ├── ApiManagerPage.jsx     API instances + policies + contracts
        │   ├── ExchangePage.jsx       Exchange browser + inline API spec viewer
        │   ├── PingTestPage.jsx       Results table + retry + JWT auto-fetch + CSV export
        │   ├── CpsComparisonPage.jsx  Side-by-side diff (single + multi-app accordion)
        │   └── UserSearchPage.jsx     Global CPS fan-out username search
        ├── components/
        │   ├── Layout.jsx             App shell: collapsible sidebar (w-16/w-64) + Outlet
        │   ├── Sidebar.jsx            NavLinks with active styles + MuleSoft docs link
        │   ├── Header.jsx             BG filter + Env filter + credential import buttons
        │   ├── PingTestPanel.jsx      Single-app ping with OAuth2/JWT auto-fetch + cURL copy
        │   ├── PingResultCard.jsx     Per-app ping result card (used in BulkPingModal)
        │   ├── AttemptLog.jsx         Collapsible path attempt log with payload expand
        │   ├── CpsExportModal.jsx     CPS → multi-sheet .xlsx export
        │   ├── CpsSettingsModal.jsx   CPS credential CRUD UI (add/delete/view)
        │   ├── CpsCredentialImportButton.jsx  CSV → CpsCredentialStoreContext
        │   ├── CredentialImportButton.jsx     CSV → CredentialStoreContext (shared base)
        │   ├── BgFilterModal.jsx      BG filter (localStorage; re-exports utils)
        │   ├── EnvFilterModal.jsx     Env filter (localStorage; fires CustomEvent)
        │   ├── Select.jsx             Custom searchable dropdown with badge/tag support
        │   ├── StatusBadge.jsx        Color-coded RUNNING/STOPPED/FAILED/DEPLOYING pill
        │   └── CopyBtn.jsx            Clipboard copy button (fade/always-visible variants)
        └── utils/
            ├── appUtils.js            availableActions, ACTION_CONFIG, latencyColor,
            │                          PING_STATUS_CONFIG, ENV_BADGE, generateTxId,
            │                          downloadCsv, buildPingUrl, getDomainQualifier
            ├── cpsHelpers.js          extractCpsConfig, flattenCpsResponse,
            │                          findApiIdInProps, findOAuth2Url, normaliseCpsUrl
            ├── csvCredentialStore.js  parseCsvLine, parseCsvToCredentialMap (auto-header)
            ├── exportCps.js           CPS data → 4-sheet .xlsx (AllProps, HostAPI,
            │                          Schedules, StaticIPs) with parallel batch processing
            └── filterUtils.js         applyBgFilter, applyEnvFilter (localStorage-backed)
```

---

## 4. Architecture Overview

### 4.1 Request Flow

```
Browser (React SPA)
  │  axios withCredentials:true  (session cookie on every request)
  │  All frontend paths: /api/*
  ▼
Vite dev server proxy  (:5173 → :5000, 2-min proxy timeout)
  ▼
Express Backend  :5000
  ├── cors()            [only :5173, :3000 with credentials]
  ├── express.json()    [1MB global; 50MB for /api/cps only]
  ├── express-session   [httpOnly, sameSite:lax, secure:true in prod, 24hr TTL]
  ├── rateLimit         [20 req/15min on /api/auth/*, production-only]
  ├── authMiddleware    [session.token → req.anypointToken, req.orgId, req.memberOrgs]
  └── Route handler
       └── createClient(token) → axios.create({ baseURL: anypoint, timeout: 30s })
           └── Anypoint Platform API
```

### 4.2 Multi-Organization Fan-Out Pattern

```
User selects "All Organizations"
  │
  Frontend: memberOrgs[] from AuthContext (loaded at login — zero extra API calls)
  │
  For EACH org in parallel (Promise.allSettled):
  │   GET /api/applications/summary/:orgId
  │       ├── GET /accounts/api/organizations/:orgId/environments
  │       ├── Filter: skip names containing "dev" or "qa"  (isProductionEnv)
  │       ├── For EACH env (Promise.all):
  │       │   ├── CH2: GET /amc/.../deployments (limit=500)
  │       │   └── CH1: GET /cloudhub/api/applications
  │       ├── Deduplicate by app name
  │       └── Cache in session for 20 min (?refresh=true bypasses)
  │
  Frontend: merge all org results → unified sorted list
```

### 4.3 Layered Caching Strategy

| Layer | Location | TTL | Key |
|---|---|---|---|
| App summary | Backend session | 20 min | `summaryCache[orgId]` |
| BG list | Backend session | Login lifetime | `memberOrgs[]` |
| Accessible envs | Backend session | Login lifetime | `accessibleEnvironments{}` |
| App list | Frontend module | 20 min | `apps:${bgId}:${bgIds}` |
| CH2 app detail | Frontend module | 20 min | `ch2detail:${appId}:${envId}` |
| CH1 app list | Frontend module | 20 min | `ch1list:${bgId}:${envId}` |
| BG list | Frontend module | 20 min | `bgs:${orgId}` |

---

## 5. Authentication System

### 5.1 Three Login Modes

#### Mode 1 — Username / Password
```
POST /api/auth/login  { username, password }
  → POST anypoint.mulesoft.com/accounts/login
  → Receives access_token
  → storeSession(req, access_token)
  → Returns { success, user, orgId, orgName }
```

#### Mode 2 — Bearer Token (SSO via DevTools)
```
POST /api/auth/token-login  { token }
  → Strips "Bearer " prefix + trims whitespace/newlines
  → storeSession(req, cleanToken)
  → Specific messages: 400 (invalid format) | 401 (expired) | 403 (insufficient perms)
```

#### Mode 3 — Connected App (Recommended for SSO orgs)
```
POST /api/auth/connected-app-login  { clientId, clientSecret }
  → POST /accounts/api/v2/oauth2/token  (grant_type=client_credentials, URLSearchParams)
  → storeSession(req, access_token)
```

#### Demo Mode (No credentials required)
```
localStorage['mulesoft_demo_mode'] = 'true'
  → All api.js calls intercepted → return mockData.js
  → No backend calls made at all
  → Full UI functional with realistic mock data
```

### 5.2 storeSession() — Shared by All 3 Login Paths

1. `GET /accounts/api/me` → full user profile
2. Finds root org: first org with no `parentId` in `memberOfOrganizations`
3. Extracts `user.roles[].contextParams.envId` → role-scoped environment set
4. Builds `accessibleEnvironments{}`: `orgId → env[]` filtered by user roles
5. Stores to session:

| Session Key | Value |
|---|---|
| `token` | Anypoint bearer token (never sent to browser) |
| `orgId` | Root organization ID |
| `orgName` | Root organization display name |
| `username` | Anypoint username |
| `memberOrgs[]` | All BGs (avoids re-fetching on every BG call) |
| `accessibleEnvironments{}` | Map of orgId → filtered env[] |
| `cpsCreds{}` | CPS credentials (populated later by user) |
| `summaryCache{}` | 20-min app summary cache per orgId |
| `user{}` | Sanitized user object returned to frontend |

### 5.3 Auth Middleware (`authMiddleware.js`)

Runs before every protected route:
- Checks `req.session.token` exists → 401 if missing
- Attaches `req.anypointToken`, `req.orgId`, `req.memberOrgs`, `req.accessibleEnvironments`
- Route handlers use `req.anypointToken` — never touch session directly

### 5.4 Frontend Auth State (`AuthContext.jsx`)

```jsx
// Context values exposed to all components:
{ user, orgId, orgName, loading,
  login(username, password),
  tokenLogin(token),
  connectedAppLogin(clientId, clientSecret),
  demoLogin(),
  logout() }
```

- On page reload: `checkSession()` calls `GET /api/auth/session` to restore state
- On 401 from any API call: axios interceptor redirects to `/login` with smart skip for resource-level 401s (CPS, Exchange, environments, applications/summary)
- `_redirecting` flag with 5s reset prevents infinite redirect loops on soft navigation

### 5.5 Security Hardening (server.js)

- **Startup validation**: fails with `process.exit(1)` in production if `SESSION_SECRET` is the known default
- **Trust proxy**: `app.set('trust proxy', 1)` enabled in production for nginx compatibility
- **Cookie flags**: `secure: isProd`, `httpOnly: true`, `sameSite: 'lax'`
- **Rate limiting**: `express-rate-limit` — 20 req/15min per IP on all 3 auth endpoints, **production-only** (skipped in dev to avoid blocking local testing)

---

## 6. Backend — Route-by-Route Analysis

### 6.1 `routes/auth.js`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/login` | No | Username/password; calls storeSession() |
| POST | `/token-login` | No | Bearer token; strips prefix, calls storeSession() |
| POST | `/connected-app-login` | No | OAuth2 client credentials |
| POST | `/logout` | No | `req.session.destroy()` — full session wipe |
| GET | `/session` | No | Returns authenticated state + user + memberOrgs[] |

### 6.2 `routes/applications.js`

| Method | Path | Description |
|---|---|---|
| GET | `/cloudhub2/:orgId/:envId` | Paginated CH2 deployments list |
| GET | `/cloudhub2/:orgId/:envId/:deploymentId` | CH2 detail enriched with `/settings` |
| GET | `/cloudhub2/:orgId/:envId/:deploymentId/schedulers` | CH2 schedulers |
| GET | `/cloudhub1/:envId` | CH1 list (full properties — no per-app detail needed) |
| GET | `/cloudhub1/:envId/:appName` | CH1 single app |
| GET | `/cloudhub1/:envId/:appName/static-ips` | CH1 static IPs (graceful 404) |
| GET | `/cloudhub1/:envId/:appName/schedules` | CH1 schedules |
| GET | `/cloudhub1/:envId/:appName/properties` | CH1 properties + infra metadata |
| POST | `/cloudhub1/:envId/:appName/action` | start/stop/restart with dual-strategy fallback |
| POST | `/cloudhub2/:orgId/:envId/:deploymentId/action` | start/stop/restart with PATCH fallback |
| GET | `/private-spaces/:orgId/:privateSpaceId` | Outbound static IPs for Private Spaces |
| GET | `/summary/:orgId` | Aggregated summary (20-min session cache) |

**CH1 Action — Dual Strategy:**
```
Strategy 1: POST /cloudhub/api/applications/:name/status { status: 'start' }
Strategy 2: PUT  /cloudhub/api/applications/:name { status: 'STARTED' }
Restart: native restart → if fails: stop + wait(4s) + start
```

**CH2 Action — With Fallback:**
```
Primary:  POST .../deployments/:id/start
Fallback: PATCH ... { application: { desiredState: 'STARTED' } }
Restart:  stop + wait(3s) + start  (RESTARTED not a valid desiredState)
```

**Summary Route Environment Filter:**
`isProductionEnv()` skips environments whose names contain `dev` or `qa`. Includes: `production` type, or names matching `prod`, `uat`, `stage`, `stg`, `staging`, `performance`, `preprod`.

### 6.3 `routes/apis.js`

| Method | Path | Description |
|---|---|---|
| GET | `/app-client-id/:appId` | Resolve clientId from Exchange by numeric appId |
| GET | `/:orgId/:envId` | List API Manager instances (paginated) |
| GET | `/:orgId/:envId/:apiId` | Single API instance detail |
| GET | `/:orgId/:envId/:apiId/policies` | Applied policies with human-readable names |
| GET | `/:orgId/:envId/:apiId/contracts` | Consumer contracts with multi-path clientId fallback |
| GET | `/:orgId/:envId/:apiId/tiers` | SLA tiers |
| GET | `/:orgId/:envId/:apiId/alerts` | API alerts |

**Contract clientId resolution (5 fallback paths):**
```javascript
c.application?.coreServicesId    // PRIMARY — confirmed OAuth client_id
c._enrichedClientId              // Exchange API enrichment fallback
c.application?.clientId
c.clientApplication?.coreServicesId
c.clientId
```

### 6.4 `routes/organizations.js`

| Method | Path | Description |
|---|---|---|
| GET | `/` | Current user's root org |
| GET | `/business-groups` | BG list (3-tier fallback) |
| GET | `/:orgId` | Single org detail |
| GET | `/:orgId/members` | Org members (paginated) |

**Business Groups — 3-Tier Fallback:**
1. `req.memberOrgs` from session (set at login — fastest)
2. Re-fetch from `/accounts/api/me`
3. BFS walk from root org using `subOrganizationIds` (slowest, most complete)

### 6.5 `routes/environments.js`

Returns only environments the user can actually access, filtered through `req.accessibleEnvironments` stored at login. Falls back to API fetch + role intersection. Excludes dev/qa environments via `isProductionEnv()`.

### 6.6 `routes/exchange.js`

| Method | Path | Description |
|---|---|---|
| GET | `/search` | Exchange asset search (query, type, orgId, limit) |
| GET | `/org/:orgId/summary` | Asset count per type |
| GET | `/:groupId/:assetId/versions` | Asset version list |
| GET | `/:groupId/:assetId/:version` | Specific asset version |
| GET | `/ping-spec` | **Complex** — fetch and parse API spec, extract ping endpoints |

**`/ping-spec` — 3-Format API Spec Parser:**
- **Format A**: AMF JSON-LD graph (array of `@type` nodes) — walks node graph via `@id` references, extracts path+method+queryParams+headers
- **Format B**: RAML `{ resources: [...] }` object or OAS `{ paths: {...} }` object — walks recursively
- **Format C**: Raw spec file download (ZIP extraction with `zlib.inflateRawSync`) — fallback for specs not served via portal model API
- Scores Exchange asset candidates and picks best match using `stripDeploymentSuffix` normalization
- Supports direct `groupId/assetId/version` parameter OR auto-search by `appName`

### 6.7 `routes/health.js`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/ping` | Yes | 6-path endpoint discovery + HTTP health check |
| POST | `/auto-credentials` | Yes | 3-layer API Manager contract lookup |
| POST | `/auto-contract-creds` | Yes | Find/create Exchange contract + return credentials |
| POST | `/oauth2-token` | Yes | Server-side OAuth2 token proxy (avoids browser CORS) |

**Ping Path Discovery Order:**
```
/api/v1/ping  →  /api/v2/ping  →  /v1/ping  →  /v2/ping  →  /api/ping  →  /ping
Timeout: 30 seconds per attempt
SSL: rejectUnauthorized: false (enterprise internal CA certs)
```

**Domain Qualifier Support (EI-FI-FINANCIALS environments):**
- Detects `FINANCIALS` in env name → inserts `.fin.` segment into base URL
- Builds 3 URL groups: HTTPS qualified → HTTP qualified → standard HTTPS fallback
- Total up to 18 URL attempts for FINANCIALS envs (6 paths × 3 URL variants)

**Ping Response Classification:**
```
SUCCESS  → HTTP < 300, not a "no listener" response
PARTIAL  → HTTP 400-499, OR HTTP 5xx with meaningful pingResponse/endpoints body
FAILED   → all paths failed or timed out
```

**Smart Path Skip Conditions (skip to next path):**
- HTTP 404
- Body contains: "No listener for endpoint", "No flow", "resource not found", "ENDPT_FAILURE"
- Structured: `{ error: [{ code: "404", status: "NOT_FOUND" }] }`

**Auto-Credentials 3-Layer Strategy:**
```
Layer 1: Direct api.id lookup (if apiId provided in request body)
Layer 2: assetId-filtered paginated search in API Manager
Layer 3: Paginated fuzzy name search in deployment environment
         → stripDeploymentSuffix() normalizes names before comparison
         → Collects up to 5 APIs, extracts approved contract clientIds in parallel
```

### 6.8 `routes/cps.js`

| Method | Path | Description |
|---|---|---|
| GET | `/credentials` | List stored CPS credentials (masked clientIds) |
| POST | `/credentials` | Store credentials by url, url::bgOrgId, or legacy key |
| DELETE | `/credentials/:key` | Remove specific credential |
| GET | `/fetch` | Fetch CPS properties (non-secure/secure/binaries) |
| POST | `/search-user` | Fan-out username search across all app CPS properties |

**CPS Credential Key Formats (priority order):**
```
url::bgOrgId  →  "https://cps.example.com::org-uuid"  (per-server × per-BG)
url           →  "https://cps.example.com"             (per-server fallback)
url::clientId →  "https://cps.example.com::clientId"  (step 2b fallback entries)
legacy        →  "ch1_prod" | "ch2_prod" | "ch1_uat" | "ch2_uat"
env vars      →  CPS_CH1_PROD_CLIENT_ID / CPS_CH1_PROD_CLIENT_SECRET
```

**Intelligent CPS Credential Retry (`/fetch`):**
- HTTP 401 OR HTTP 200 + "COULD NOT ACCESS" string → tries all alternative session credentials in parallel batches of 5
- First working credential is promoted to `url::bgOrgId` for future requests
- **Per-group retry**: for `secure` type, groups that return "COULD NOT ACCESS" are retried individually with remaining credentials

**User Search Fan-out (`POST /search-user`):**
- Accepts `username` + array of `apps[]`
- Scans each app's non-secure CPS properties for the username value (case-insensitive)
- If `cps.secure.properties` key exists, also scans secure properties per group
- Runs in concurrency batches of 30
- Returns matched properties including secure group key, related password field (masked), and source type

### 6.9 `routes/metrics.js`

| Method | Path | Description |
|---|---|---|
| GET | `/cloudhub1/:envId/:appName` | CH1 dashboard data (duration, period) |
| GET | `/summary/:orgId` | Aggregated total/running/failed/stopped across all envs |

Metrics summary aggregates from `req.accessibleEnvironments` (session-cached), avoiding extra env-fetch API calls.

---

## 7. Backend — Utility Layer

### 7.1 `anypointClient.js`

```javascript
createClient(token) → axios.create({
  baseURL: ANYPOINT_URL,   // env var or https://anypoint.mulesoft.com
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  timeout: 30000
})
```

Single responsibility: authenticated Axios instance factory. Every route handler calls this.

### 7.2 `appHelpers.js`

| Function | Purpose |
|---|---|
| `normalizeStatus(raw)` | Maps CH1/CH2 raw status → RUNNING / STOPPED / DEPLOYING / FAILED / UNKNOWN |
| `parseCH2Apps(data)` | Handles all CH2 response shapes: `items`, `deployments`, `content`, `data` |
| `makeCh1Headers(envId, orgId)` | Builds `X-ANYPNT-ENV-ID` + `X-ANYPNT-ORG-ID` headers |
| `isProductionEnv(env)` | Excludes dev/qa envs from summary aggregation |
| `uniqueProductionEnvs(envs)` | Deduplicates by id then applies isProductionEnv filter |
| `stripDeploymentSuffix(name)` | Strips region+env suffix for Exchange name matching |

**Status mapping (CH1 raw → canonical):**

| Raw Status | Canonical |
|---|---|
| `started`, `running` | RUNNING |
| `undeployed`, `stopped`, `not_running` | STOPPED |
| `deploy_failed` | FAILED |
| `deploying`, `updating`, `restarting`, `partially_started`, `applying_changes` | DEPLOYING |

**`stripDeploymentSuffix` examples:**
```
sapi-workday-ar-refunds-v1-uw2-up   → sapi-workday-ar-refunds
xapi-coupa-ask-procurement-v1-uw2-ut → xapi-coupa-ask-procurement
my-app-v2                            → my-app
```

### 7.3 `orgHelpers.js`

`mapOrgShape(org)` → `{ id, name, domain, type, parentId, subOrganizationIds }`

Ensures consistent shape between auth.js (login) and organizations.js (BFS fallback).

### 7.4 `exchangeHelpers.js`

`fetchExchangeAppCreds(client, orgId, appId)` — 2-strategy credential lookup:
1. `GET /exchange/api/v2/organizations/:orgId/applications/:appId/credentials` (dedicated endpoint)
2. `GET /exchange/api/v2/organizations/:orgId/applications/:appId` (inline fallback)

Never throws — returns `{ clientId: null, clientSecret: null }` on failure.

### 7.5 `responseHelpers.js`

`sendProxyError(res, error, fallbackMessage)`:
- Uses upstream HTTP status if available, else 500
- Uses `error.response.data.message` → `.error` → `error.message` → fallback
- Logs at `console.error` level (does not suppress 401/403 noise)
- Ensures every route returns the same JSON shape: `{ error: "message" }`

---

## 8. Frontend — Context and State

### 8.1 `AuthContext.jsx`

**Provider wraps entire app.** Exposes:

| Value/Method | Description |
|---|---|
| `user` | `{ id, username, firstName, lastName, email, organization }` |
| `orgId` | Root org UUID |
| `orgName` | Root org display name |
| `loading` | True during initial session check |
| `login(u, p)` | Username/password login |
| `tokenLogin(token)` | Bearer token login |
| `connectedAppLogin(cid, cs)` | Connected App OAuth2 login |
| `demoLogin()` | Enable demo mode (no backend) |
| `logout()` | Clear session + disable demo mode |

`checkSession()` runs on mount — calls `GET /api/auth/session` to restore state across page reload.

### 8.2 `CredentialStoreContext.jsx` (Ping Credentials)

In-memory `Map<clientId, clientSecret>` for ping test credentials.

**Security model:**
- CSV parsed client-side; file bytes never leave the browser
- clientSecrets not sent to backend — only the matched pair travels over HTTPS at ping time
- Cleared on React tree unmount (page reload)

**Key methods:**
- `loadFromCsv(text)` → parses CSV, populates map, returns count
- `getSecret(clientId)` → returns secret or null
- `resolveFromCandidates(candidates[])` → finds first clientId whose secret is in the map
- `clearCredentials()` → wipes map immediately

### 8.3 `CpsCredentialStoreContext.jsx` (CPS Credentials)

Separate in-memory store for CPS (Config Property Server) credentials.

**Extra method vs CredentialStoreContext:**
- `getAllCredentials()` → returns all `{ clientId, clientSecret }` pairs — used for URL-based fallback resolution when posting credentials to backend session

Both contexts share the same `parseCsvToCredentialMap` utility from `csvCredentialStore.js` — no logic duplication.

---

## 9. Frontend — Services Layer

### 9.1 `api.js` — Unified HTTP Client

```javascript
axiosClient = axios.create({ baseURL: '/api', withCredentials: true })
```

**Demo mode interceptor:** checks `localStorage['mulesoft_demo_mode']` on every call, returns mock data from `mockData.js` — no network request made.

**401 interceptor smart skip** (resource-level 401, not session expiry):
```javascript
const skipRedirect =
  url.includes('/applications/summary')  // BG access check
  url.includes('/environments/')         // env fetch for restricted BG
  url.includes('/cps/')                  // CPS credential issues
  url.includes('/exchange/')             // Exchange asset access
  url.includes('/apis/')                 // API Manager access
```

**`_redirecting` flag:** prevents double-redirect from concurrent 401 responses; resets after 5s.

**Complete API facade:**
```javascript
api.get(url, config)         // GET
api.post(url, data, config)  // POST
api.delete(url, config)      // DELETE
api.patch(url, data, config) // PATCH
api.put(url, data, config)   // PUT
```
All methods check demo mode and return mock `{ data: { success: true } }` when active.

### 9.2 `apiCache.js` — Module-Level Cache

```javascript
const cache = new Map();   // lives in module scope — cleared on page reload
const CACHE_TTL_MS = 20 * 60 * 1000;  // 20 minutes
```

- `getCached(key)` → returns data if fresh, null if expired/missing
- `setCached(key, data)` → stores with current timestamp
- `bustCache(keyPrefix)` → deletes all entries starting with prefix
- `clearCache()` → wipes entire cache (e.g., on logout)

### 9.3 `mockData.js` — Demo Mode Dataset

Complete mock dataset for all pages:
- `MOCK_USER`, `MOCK_ENVIRONMENTS`, `MOCK_APPS`, `MOCK_APP_DETAIL`
- `MOCK_BUSINESS_GROUPS`, `MOCK_MEMBERS`, `MOCK_METRICS`
- `MOCK_APIS`, `MOCK_POLICIES`
- `MOCK_EXCHANGE_ASSETS`, `MOCK_EXCHANGE_SUMMARY`

---

## 10. Frontend — Pages

### 10.1 `LoginPage.jsx`

Three auth tabs (Connected App | Username/Password | Bearer Token) + Demo Mode button.
- Connected App tab: shows required Anypoint scopes + setup instructions
- Bearer Token tab: collapsible DevTools guide for SSO users
- All forms: show/hide password toggle, loading state, error display
- Demo button: purple gradient, prominent above the form

### 10.2 `ApplicationsPage.jsx` — Most Feature-Rich Page

**Core responsibilities:**
- Load apps across selected BGs (parallel `Promise.allSettled`)
- 5 filter types: BG selector, env filter, status filter, type filter (CH1/CH2), text search
- Multi-select with floating selected rows (selected rows sort to top)
- Per-row + bulk start/stop/restart with confirmation dialogs
- **BulkPingModal** (embedded component): 6-path ping, auto credential resolution, JWT auto-fetch
- Import CSV → `CredentialStoreContext`; Export CPS → `CpsExportModal`
- Filter state persisted in `localStorage` (BG, env, status, type)
- Frontend cache keyed as `apps:${bgId}:${bgIds}` (20-min TTL)

**Key internal components (defined in file):**
- `ConfirmModal` — single-app action confirmation
- `BulkConfirmModal` — bulk action with per-app result indicators
- `BulkPingModal` — full ping orchestration: auto-credential resolution + parallel batches of 10 + JWT auto-fetch + navigation to `/ping-test`

### 10.3 `ApplicationDetailPage.jsx` — 8-Tab Deep-Dive

URL: `/applications/:orgId/:envId/:appId`

| Tab | Contents |
|---|---|
| Overview | Status badge, runtime version, region, workers/replicas, replica IPs, ARM link |
| Properties | All deployment property placeholders from ARM descriptor |
| Schedulers & Object Store | CH2 schedulers (from `/schedulers` endpoint), cron resolution via CPS, persistent object store, HTTP endpoints |
| CPS Config | Live CPS key-value pairs; non-secure + on-demand secure + binary assets; search + copy |
| Contracts | Consumer contracts via API Manager auto-lookup (CPS api.id → auto-credentials) |
| API Spec | Exchange spec viewer (AMF/OAS/RAML); ping/health endpoints highlighted |
| Ping Test | Embedded `PingTestPanel` with OAuth2/JWT support |
| Raw JSON | Full ARM API response for debugging |

**Notable features:**
- Auto-resolves CPS credentials from imported CSV (Strategy 1: exact clientId match; Strategy 2: all CSV creds posted as fallback)
- Scheduler placeholder resolution: `${propName}` substituted from runtime props + CPS
- "Get Cron Expressions" button fetches CPS secure properties to resolve scheduler placeholders
- Context badges: BG name + env name resolved from separate API calls

### 10.4 `ApiManagerPage.jsx`

Lists API Manager instances → click to expand → shows policies (human-readable names from `template.name`) and consumer contracts (with multi-path `coreServicesId` fallback for clientId).

### 10.5 `ExchangePage.jsx`

Exchange browser with:
- BG selector + asset type filter + text search + pagination (100/page)
- Asset list → click → detail panel with Overview / API Spec / Files tabs
- API spec tab: fetches `/exchange/ping-spec` and renders all endpoints with method/path/query params/headers
- Auto-selects asset when navigated from AppDetailPage with `location.state`

### 10.6 `PingTestPage.jsx` — Results Viewer

Read-only results viewer populated from `BulkPingModal` run (via `location.state` or `sessionStorage`).

**Features:**
- Results persist in `sessionStorage` — survive navigation away and back
- Summary bar: total / healthy / partial / failed / auto-creds count
- Status filter chips: All / Healthy / Partial / Failed / Contract Pending / Contract Approved
- Show tested only ↔ Show all apps toggle
- Expandable rows: auto-resolved cred detail, endpoint URL, error, response payload (with structured `pingResponse.endpoints` table), attempt log
- **Retry button** per FAILED/PARTIAL row
- **JWT button** for PARTIAL+401/403 rows: fetches JWT from CPS, retries ping
- **Check Contract** button for pending contract rows
- **Bulk actions**: Retry All Failed, Ping All Approved, Check All Contracts, Re-resolve Creds
- Export CSV (10 columns); Upload CSV for batch ping by app name
- `cURL` copy button per row

### 10.7 `CpsComparisonPage.jsx` — Side-by-Side Diff

Two configurable side panels flanking a central Compare button:

**Side panels:**
- BG selector → Env selector → App selector (auto-populates CPS URL/env/key from ARM props)
- Property type tabs: Non-Secure / Secure / Binaries
- Manual credential override fields (auto-populated from CPS CSV import)
- Collapse/expand: panels auto-collapse after compare; click "▼ Edit" to re-expand

**Compare modes:**
- **1 App**: direct property fetch and diff
- **All Apps**: checklist selectors, positional pairing, batches of 5

**Diff table:**
| Badge | Color | Meaning |
|---|---|---|
| DIFF | Red | Values differ |
| A ONLY | Blue | Key in Side A only |
| B ONLY | Orange | Key in Side B only |
| MATCH | Muted | Identical |

**Additional features:**
- Filter tabs: All / Different / Only A / Only B / Matching
- Search by key name
- Word-level diff modal on row click (tokenizes values, highlights changes inline)
- Export CSV (all keys + both values + status)
- Export Diffs Only CSV
- Copy Diffs to clipboard

### 10.8 `UserSearchPage.jsx` — Global CPS Search

**Flow:**
1. BG + Env multi-selector (`BgEnvSelector` internal component) with flat list, search, and check-all
2. Enter username (min 3 chars) → Search
3. Phase 1: fetch apps for all selected envs (parallel) — CH2 with 50-parallel detail batches + per-app cache; CH1 list (includes full properties, 1 call per env)
4. Phase 2: deduplicate by `cpsUrl+cpsKey+cpsEnv+bgOrgId`
5. Phase 3: `POST /api/cps/search-user` — backend scans all apps
6. Results table: 9 columns (env, CH version, app name, NS key, CPS prefix, secure group key, property key, found value, masked password)
7. Export CSV

**Performance:** Loads CH2 details in parallel batches of 50; uses `apiCache` for efficiency; credential posting is fire-and-forget (no `await`).

---

## 11. Frontend — Components

### 11.1 `Layout.jsx`
App shell: collapsible sidebar (`w-64` open / `w-16` collapsed) + sticky `<Header>` + scrollable `<Outlet>`. Toggle controlled by `sidebarOpen` state in Layout — `Header` passes toggle callback.

### 11.2 `Sidebar.jsx`
Six `<NavLink>` items: Applications, API Manager, Exchange Assets, Ping Test, CPS Compare, Global Search. Shows active highlight (blue). Truncates labels when collapsed. Footer: org name + MuleSoft docs link.

### 11.3 `Header.jsx`
Global controls always accessible from any page:
- **BG Filter button** → opens `BgFilterModal` (loads BG list once on mount)
- **Env Filter button** → opens `EnvFilterModal` (loads envs from all visible BGs on demand)
- **Import Ping Creds** → `CredentialImportButton`
- **Import CPS Creds** → `CpsCredentialImportButton`
- Refresh button, user display, logout
- Demo mode `DEMO` badge when active

### 11.4 `PingTestPanel.jsx`
Single-app ping component (used in `ApplicationDetailPage` Ping Test tab).

**Features:**
- Auth mode toggle: Client ID/Secret ↔ Bearer Token (JWT)
- Bearer mode: OAuth2 helper form to fetch token from `/health/oauth2-token`
- **"Auto-fill from API Manager"** button: calls `/health/auto-credentials` using CPS api.id → populates clientId/secret fields
- **"Get JWT Token"** button: scans CPS non-secure+secure for OAuth2 token URL → fetches token → switches to bearer mode
- Query params field: appended to all ping paths
- Exchange spec integration: shows detected ping endpoints with "click to auto-fill query params" buttons
- cURL copy button: generates curl command with current credentials
- Auto-collapses config section after first ping
- 95s client-side timeout safety net (vs backend 30s per path)
- Displays structured `pingResponse.endpoints` health table when present in response

### 11.5 `PingResultCard.jsx`
Per-app result card used inside `BulkPingModal` during ping runs:
- Status pill with animated pulse dot
- Endpoint URL, HTTP status (color-coded), latency (color-coded)
- Auto-expanded payload for 5xx responses
- Attempt log (via `AttemptLog` component)
- JWT auto-used badge; contract pending indicator

### 11.6 `AttemptLog.jsx`
Collapsible list of per-path ping attempts. Auto-opens and expands first 5xx+payload row. Each row expandable to show response body (red for 5xx, green for 2xx).

### 11.7 `CpsExportModal.jsx`
Multi-sheet Excel (.xlsx) export for CPS properties.

**Modes:**
- **Pre-selected apps** (passed from ApplicationsPage): exports those apps directly
- **BG/Env selector**: tree selector with expandable BGs + env checkboxes; one file per environment

**4 Excel sheets:**
1. `AllPropertiesCatalog` — env, app, CH version, status, host, secure group key, all properties (secrets masked)
2. `Host_APIUsersCatalog` — hosts, API users, accessible flag
3. `ScheduleCatalog` — flow name, enabled, cron expression (placeholder-resolved), timezone, period
4. `StaticIPsCatalog` — app, env, CH version, status, static IPs enabled, IP list

Processes apps in **parallel batches of 10** with `Promise.allSettled`. CPS URL auto-detected from first selected app's ARM properties.

### 11.8 `CpsSettingsModal.jsx`
CRUD UI for CPS server credentials stored in backend session:
- Lists configured URL-keyed credentials with masked clientIds
- Add new server: URL + optional BG ID + clientId + clientSecret
- Credential key preview: shows `url::bgId` or `url` depending on BG input
- Delete existing credentials
- Legacy `.env` variable status display

### 11.9 `CredentialImportButton.jsx` + `CpsCredentialImportButton.jsx`
Shared base (`ImportCredentialButton`): file input → `FileReader` → `parseCsvToCredentialMap()` → store context.

Both are thin wrappers with different colors (emerald vs purple) and labels. When credentials are loaded: shows count badge + clear button. Uses `useRef` for file input to allow re-importing same file.

### 11.10 `BgFilterModal.jsx` + `EnvFilterModal.jsx`
Checkbox lists with search, Select All / Clear All. Saves to localStorage. Immediately re-exports utility functions (`applyBgFilter`, `applyEnvFilter`, etc.) for backward compatibility — actual logic lives in `filterUtils.js`.

`EnvFilterModal` dispatches `window.dispatchEvent(new CustomEvent('envFilterChanged'))` on save so pages can react without a storage listener.

### 11.11 `Select.jsx`
Custom dropdown: trigger button + overlay list + optional search input. Supports badges (color dots), tags (text chips), indented options, and selected checkmark. Closes on outside click via `mousedown` document listener.

### 11.12 `StatusBadge.jsx`
Color-coded pill for 17 distinct status values covering both CH1 and CH2 vocabularies. Unknown statuses get a gray fallback.

### 11.13 `CopyBtn.jsx`
Canonical copy button with `fade` prop (opacity-0 until parent `group` hover) and `size` prop. Shows green `<Check>` for 1.5s after copy. Prevents event bubbling via `e.stopPropagation()`.

---

## 12. Frontend — Utilities

### 12.1 `appUtils.js`

| Export | Description |
|---|---|
| `availableActions(status)` | Returns `['stop','restart']` for RUNNING, `['start']` for STOPPED/FAILED |
| `ACTION_CONFIG` | `{ label, Icon, btnCls, bulkCls, detailCls }` per action |
| `ENV_BADGE` | Tailwind dot color per env type |
| `PING_STATUS_CONFIG` | `{ label, cls, dot, ping }` for SUCCESS/PARTIAL/FAILED/SKIPPED_CONTRACT_PENDING |
| `latencyColor(ms)` | Tailwind text color: green <300ms, yellow <1s, red ≥1s |
| `generateTxId()` | UUID v4 via `crypto.randomUUID()` with manual fallback |
| `downloadCsv(rows, filename)` | Blob URL download trigger |
| `buildPingUrl(appName, envName)` | CH1 base URL with env slug mapping + domain qualifier |
| `getDomainQualifier(envName)` | Returns `'fin'` for FINANCIALS envs, `''` otherwise |

### 12.2 `cpsHelpers.js`

| Export | Description |
|---|---|
| `extractCpsConfig(appDetail)` | Merges all ARM property sources → extracts cpsBaseUrl, cpsKey, cpsEnv, cpsClientId |
| `flattenCpsResponse(data, appKey)` | Normalizes 4 CPS response shapes → `{ key: value }` map |
| `findApiIdInProps(props)` | 4-priority heuristic for autodiscovery API ID |
| `findOAuth2Url(props)` | Finds OAuth2/Okta token URL in CPS properties |
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

### 12.3 `csvCredentialStore.js`

- `parseCsvLine(line)` — handles quoted fields and comma/semicolon delimiters
- `parseCsvToCredentialMap(text)` — auto-detects header row (first cell ≥ 16 chars alphanumeric = data row, else header); returns `Map<clientId, clientSecret>`
- Accepts both `clientId,clientSecret` and `client_id,client_secret` column names

### 12.4 `exportCps.js`

Generates CPS export to 4-sheet `.xlsx`:
- `fetchAppCps(app, ...)` — fetches full ARM detail (runtime props + schedulers + static IPs) + CPS non-secure + CPS secure; handles CH1 and CH2 separately
- `buildRows(...)` — constructs output rows; resolves `${propName}` placeholders in cron expressions
- `exportCpsProperties(...)` — main entry: processes apps in parallel batches of 10 (configurable), builds rows in original order, writes `.xlsx` with `XLSX.writeFile`
- Static IPs: checks Private Space API for CH2; falls back to replica list

### 12.5 `filterUtils.js`

```javascript
BG_FILTER_KEY  = 'mulesoft_visible_bgs'
ENV_FILTER_KEY = 'mulesoft_visible_envs'
```

- `getVisibleBgIds()` / `getVisibleEnvIds()` → read from localStorage → `Set<id>`
- `saveVisibleBgIds()` / `saveVisibleEnvIds()` → write to localStorage; `saveVisibleEnvIds` also fires `CustomEvent('envFilterChanged')`
- `applyBgFilter(groups)` / `applyEnvFilter(envs)` → returns full list when filter is empty (show all)

---

## 13. Feature Deep-Dives

### 13.1 Bulk Ping — End-to-End Flow

```
1. User selects apps → clicks "Ping Test" or "Ping (N)"
2. BulkPingModal opens
3. Auto-credential resolution (if CSV loaded and no manual clientId):
   │  For EACH app (parallel, Promise.allSettled):
   │  a. fetchAppApiProps() → ARM detail → CPS non-secure → find api.id
   │  b. POST /api/health/auto-credentials { orgId, envId, appName, apiId? }
   │     → Layer 1: direct api.id lookup
   │     → Layer 2: assetId-filtered search
   │     → Layer 3: fuzzy name search
   │  c. resolveFromCandidates(matchInfo[].clientId) → match against CSV
   │  d. If no CSV match → POST /api/health/auto-contract-creds → create Exchange contract
4. Pings run in batches of 10:
   │  For EACH app:
   │  a. Fetch CH2 ingress URL from ARM detail (if CH2)
   │  b. POST /api/health/ping { targetType, appName, ch2IngressUrl, clientId, clientSecret }
   │     → Backend: buildBaseUrl() → try 6 paths (+ FINANCIALS variants)
   │     → Return { status, activeEndpoint, httpStatus, latency, payload, attempts[] }
   │  c. If status=PARTIAL + 4xx: auto-fetch JWT from CPS → retry ping with bearerToken
5. Navigate to /ping-test with results + autoResolvedMap in location.state
6. PingTestPage renders sorted results (Healthy → Partial → Unreachable)
7. sessionStorage persists results for navigation
```

### 13.2 CPS Compare — End-to-End Flow

```
1. User opens /cps-compare
2. Imports CPS credentials CSV → CpsCredentialStoreContext
3. Configures Side A: BG → Env → App
   → selectApp() fetches ARM detail → extractCpsProps() → posts credentials to session
4. Configures Side B: same
5. Clicks Compare:
   │  fetchSide(sideA, propTypeA) in parallel with fetchSide(sideB, propTypeB)
   │  For 'non-secure': direct fetch + flattenCpsResponse()
   │  For 'secure': fetch non-secure first → discover cps.secure.properties keys → fetch secure
   │  For 'binaries': fetch non-secure first → discover cps.secure.binaries keys → fetch binaries
6. Side panels auto-collapse
7. buildDiff(propsA, propsB) → sorted array of { key, valA, valB, status }
8. diff table rendered with inline word-level highlighting for DIFF rows
9. After compare: query /api/cps/credentials to fill masked credential fields
```

### 13.3 Global CPS Search — End-to-End Flow

```
1. User opens /user-search → selects BG+Env combinations
2. Enters search term → clicks Search
3. Phase 1 (parallel): fetch apps for ALL selected envs simultaneously
   │  CH2: check apiCache(ch2detail:*) → fresh list → 50-parallel detail fetches
   │  CH1: check apiCache(ch1list:*) → fresh list (returns full properties)
   │  Fire-and-forget: POST /api/cps/credentials for all apps (no await)
4. Phase 2: deduplicate by cpsUrl+cpsKey+cpsEnv+bgOrgId
5. Phase 3: POST /api/cps/search-user { username, apps[] }
   │  Backend scans non-secure properties (case-insensitive value match)
   │  If cps.secure.properties exists → scan secure groups
   │  Concurrency: 30 apps in parallel
6. Results: 9-column table with copy buttons per cell
7. Export CSV
```

### 13.4 App Lifecycle Actions — Resilience Design

```
CH1 Start:
  Try:      POST /cloudhub/api/applications/:name/status { status: 'start' }
  Fallback: PUT  /cloudhub/api/applications/:name { status: 'STARTED' }

CH1 Restart:
  Try:      POST .../status { status: 'restart' }
  Fallback1: POST .../status { stop } → wait 4s → POST .../status { start }
  Fallback2: PUT { stop } → wait 4s → PUT { start }

CH2 Start:
  Try:      POST .../deployments/:id/start
  Fallback: PATCH .../deployments/:id { application: { desiredState: 'STARTED' } }

CH2 Restart:
  Try:      POST .../deployments/:id/restart
  Fallback: PATCH stop → wait 3s → PATCH start
```

---

## 14. Security Analysis

### 14.1 Strengths

| Aspect | Implementation |
|---|---|
| Bearer token isolation | Stored only in `express-session` server-side; never in HTTP response or cookie value |
| Session cookie hardening | `httpOnly: true`, `sameSite: 'lax'`, `secure: true` (production) |
| Credential memory isolation | Ping creds and CPS creds in React state only; neither in localStorage |
| CORS restriction | Only `:5173` and `:3000` allowed with credentials |
| Rate limiting | 20 attempts per IP per 15-min window on all auth routes (production only) |
| No credential logging | Credentials masked in all console.log (shows first 8 chars only) |
| SSL bypass scoped | `rejectUnauthorized: false` only for ping health checks; NOT for Anypoint API calls |
| Demo mode isolation | Mock data returns no real credentials or sensitive data |
| Startup validation | `process.exit(1)` in production if SESSION_SECRET is default |

### 14.2 Security Considerations / Remaining Risks

| Issue | Risk Level | Recommendation |
|---|---|---|
| In-memory session store (`MemoryStore`) | Medium — lost on server restart; not scalable | Use `connect-redis` or `connect-mongo` |
| `rejectUnauthorized: false` for pings | Low — MITM risk on internal ping endpoints | Document clearly; make configurable |
| No CSRF protection | Low — SPA with CORS + `sameSite:lax` provides partial mitigation | Add `SameSite=Strict` or `csurf` for production |
| 50MB JSON body on /api/cps | Low — scoped to CPS routes, not global | Already mitigated by route-level override |
| No request ID / correlation ID | Low — hard to trace specific requests in logs | Add `req.id` middleware (e.g., `uuid`) |
| Session SECRET rotation | Medium — requires logout of all users | Document rotation procedure |

---

## 15. Performance Patterns

### 15.1 Parallelism Map

| Operation | Pattern | Batch Size |
|---|---|---|
| All Orgs app list | `Promise.allSettled` per org | All orgs in parallel |
| Per-org env scan | `Promise.all` per env | All envs in parallel |
| Bulk ping | Sequential batches | 10 concurrent |
| CH2 detail fetch (UserSearch) | `Promise.allSettled` batches | 50 concurrent |
| CPS credential retry | `Promise.allSettled` batches | 5 concurrent |
| CPS user search | `Promise.allSettled` batches | 30 concurrent |
| CPS export | `Promise.allSettled` batches | 10 concurrent |
| Auto-credentials per app | `Promise.allSettled` per app | All apps in parallel |
| Exchange ping-spec candidates | Sequential | Up to 5 candidates |

### 15.2 Key Optimization Notes

- **CH1 list API** returns full properties directly — no per-app detail call needed (major time saving for large estates)
- **CH2 requires per-app detail** — mitigated by 50-parallel batches + frontend cache
- **BG list cached in session at login** — zero extra API calls on BG dropdown loads
- **CPS credentials auto-promoted** when a working credential is found — reduces retries on subsequent pages
- **Summary route caches by orgId** in session — repeated All Organizations loads hit the cache
- **BulkPingModal defers JWT fetch** until PARTIAL result received — avoids unnecessary OAuth2 calls
- **UserSearchPage credential posting is fire-and-forget** — doesn't block UI while posting

---

## 16. Code Quality Assessment

### 16.1 Strengths

| Pattern | Where Applied |
|---|---|
| **Separation of concerns** | Routes handle HTTP only; business logic in utils; data normalization centralized |
| **DRY utilities** | `appHelpers`, `orgHelpers`, `exchangeHelpers`, `responseHelpers` prevent logic drift |
| **Resilient async** | `Promise.allSettled` consistently — partial failures never block full results |
| **Consistent error shape** | `sendProxyError()` ensures every route returns `{ error: "message" }` |
| **Smart fallbacks** | Action endpoints, BG lookup, credential resolution all have multi-tier fallbacks |
| **No UI whitescreens** | Every async operation wrapped in try/catch with error state display |
| **Demo mode** | Full mock dataset allows UI testing without Anypoint credentials |
| **Canonical shared utils** | `appUtils.js`, `cpsHelpers.js`, `csvCredentialStore.js`, `filterUtils.js` prevent per-file drift |
| **Co-located imports** | BgFilterModal and EnvFilterModal re-export their util functions for backward compat |
| **Type-safe-ish status** | `PING_STATUS_CONFIG` and `ACTION_CONFIG` objects instead of scattered string literals |

### 16.2 Areas for Improvement

| Area | Current State | Suggested Improvement |
|---|---|---|
| TypeScript | Plain JavaScript throughout | Migrate to TypeScript for type safety |
| Unit tests | No test files found | Add Jest/Vitest for utils and route handlers |
| ESLint / Prettier | No config files | Add linting and formatting config |
| Error boundaries | No React error boundaries | Add `<ErrorBoundary>` for page-level error isolation |
| Loading skeletons | Spinner-only loading states | Add skeleton placeholders for better perceived performance |
| Pagination on app list | Client-side filter only | Server-side pagination for very large estates |
| Session store | `MemoryStore` (in-process) | Use `connect-redis` for multi-instance deployments |

---

## 17. Known Bugs and Issues

### 17.1 Already Fixed (from `BUG_FIX_PLAN.md`)

| Bug | File | Fix |
|---|---|---|
| BUG-03: `/ping` + `/oauth2-token` unprotected | `health.js` | Added `authMiddleware` to both routes |
| BUG-04: SESSION_SECRET default + cookie insecure | `server.js` | Startup validation + httpOnly/sameSite/secure cookie |
| BUG-05: Dead `setSessionFromResult` ref | `LoginPage.jsx` | Removed dead ref, merged double `useAuth()` call |
| BUG-06: `_redirecting` never resets | `api.js` | Added 5s `setTimeout` reset after redirect |
| BUG-07: Missing `patch()`/`put()` in api facade | `api.js` | Added both with demo mode support |
| BUG-08: Global 50MB body limit | `server.js` | Global 1MB; 50MB scoped to `/api/cps` only |
| BUG-09: `ping-spec` route order | `exchange.js` | Handler extracted; registered before wildcards |
| IMP-01: Filter utils coupled to modal components | `filterUtils.js` | Extracted to canonical file; modals re-export |
| IMP-02: No rate limiting on auth | `server.js` | 20 req/15min per IP on login routes; prod-only |

### 17.2 Open Bugs (from `docs/global-search-bugs.md`)

#### Critical (🔴)

| # | File | Bug | Impact |
|---|---|---|---|
| 1 | `UserSearchPage.jsx` | Cache key mismatch (`apps:__all__:${bgId}` vs actual key format) — cache never hits | Extra API calls on every search |
| 2 | `UserSearchPage.jsx` | `extractCpsConfig` misses `ds.runtimeProperties` for CH2 apps | CH2 apps with CPS config in `runtimeProperties` never searched |
| 3 | `UserSearchPage.jsx` | `envName` always empty for CH2 apps — results show `chEnv: '—'` | Unreadable results table |
| 4 | `UserSearchPage.jsx` | `postCreds` stores all creds under wrong BG org ID (always uses `entries[0].bgOrgId`) | Multi-BG credential lookup fails silently |
| 5 | `cps.js` | `processApp` has no credential retry — wrong-credential apps silently skipped | False negatives in Global Search |
| 6 | `cps.js` | `detectEnvType` regex `\bstage\b` doesn't match `staging` — falls through to `'prod'` | STAGING envs use prod credentials → 401 → skipped |

#### Significant (🟠)

| # | File | Bug | Impact |
|---|---|---|---|
| 7 | `UserSearchPage.jsx` | Env-level fetch failures silently dropped — partial results with no warning | User thinks search was complete |
| 8 | `cps.js` | `processApp` catch-all swallows all errors — timeout vs wrong-cred indistinguishable | No diagnostic logging |
| 9 | `cps.js` | `scanned` counter double-counted in response (`scanned + results.length`) | Misleading metrics |

#### Minor (🟡)

| # | File | Bug | Impact |
|---|---|---|---|
| 10 | `UserSearchPage.jsx` | Progress bar always 100% (`w-full` hardcoded) | Misleading loading UX |
| 11 | `UserSearchPage.jsx` | "Select All" selects only filtered envs but count shows total | Confusing selection state |

### 17.3 Outstanding Improvements (from `BUG_FIX_PLAN.md`)

| IMP | Status | Description |
|---|---|---|
| IMP-03 | 🔴 Not Started | Persistent session store (connect-redis / connect-mongo) |
| IMP-04 | 🔴 Not Started | React Error Boundaries around Layout |
| IMP-05 | 🔴 Not Started | Fix README API route reference (outdated paths) |
| IMP-06 | 🔴 Not Started | Expose `memberOrgs` in AuthContext to avoid redundant BG fetches |
| IMP-07 | 🔴 Not Started | ESLint + Prettier configuration |
| IMP-08 | 🔴 Not Started | Unit tests for utility functions |

---

## 18. Environment Variables Reference

### Backend (`backend/.env`)

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `5000` | No | Express server port |
| `SESSION_SECRET` | _(none)_ | **Yes in prod** | Session signing secret — must not be default |
| `ANYPOINT_PLATFORM_URL` | `https://anypoint.mulesoft.com` | No | Anypoint base URL (for PCE/GOV) |
| `CPS_CH1_PROD_CLIENT_ID` | — | No | CPS CH1 production client ID |
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

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Username/password login |
| POST | `/api/auth/token-login` | No | Bearer token login |
| POST | `/api/auth/connected-app-login` | No | OAuth2 Connected App login |
| POST | `/api/auth/logout` | No | Destroy session |
| GET | `/api/auth/session` | No | Check session state |

### Applications — `/api/applications`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/applications/summary/:orgId` | Yes | Aggregated app summary (20-min cache) |
| GET | `/api/applications/cloudhub2/:orgId/:envId` | Yes | CH2 app list (paginated) |
| GET | `/api/applications/cloudhub2/:orgId/:envId/:id` | Yes | CH2 app detail |
| GET | `/api/applications/cloudhub2/:orgId/:envId/:id/schedulers` | Yes | CH2 schedulers |
| POST | `/api/applications/cloudhub2/:orgId/:envId/:id/action` | Yes | CH2 start/stop/restart |
| GET | `/api/applications/cloudhub1/:envId` | Yes | CH1 app list |
| GET | `/api/applications/cloudhub1/:envId/:appName` | Yes | CH1 single app |
| GET | `/api/applications/cloudhub1/:envId/:appName/static-ips` | Yes | CH1 static IPs |
| GET | `/api/applications/cloudhub1/:envId/:appName/schedules` | Yes | CH1 schedules |
| GET | `/api/applications/cloudhub1/:envId/:appName/properties` | Yes | CH1 properties |
| POST | `/api/applications/cloudhub1/:envId/:appName/action` | Yes | CH1 start/stop/restart |
| GET | `/api/applications/private-spaces/:orgId/:psId` | Yes | Private Space outbound IPs |

### API Manager — `/api/apis`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/apis/app-client-id/:appId` | Yes | Resolve clientId from Exchange |
| GET | `/api/apis/:orgId/:envId` | Yes | List API instances |
| GET | `/api/apis/:orgId/:envId/:apiId` | Yes | Single API instance |
| GET | `/api/apis/:orgId/:envId/:apiId/policies` | Yes | Applied policies |
| GET | `/api/apis/:orgId/:envId/:apiId/contracts` | Yes | Consumer contracts |
| GET | `/api/apis/:orgId/:envId/:apiId/tiers` | Yes | SLA tiers |
| GET | `/api/apis/:orgId/:envId/:apiId/alerts` | Yes | API alerts |

### Organizations — `/api/organizations`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/organizations` | Yes | Current root org |
| GET | `/api/organizations/business-groups` | Yes | All BGs (session-cached) |
| GET | `/api/organizations/:orgId` | Yes | Single org detail |
| GET | `/api/organizations/:orgId/members` | Yes | Org members |

### Environments — `/api/environments`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/environments` | Yes | All accessible environments (from session) |
| GET | `/api/environments/:orgId` | Yes | Environments for a specific org |

### Exchange — `/api/exchange`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/exchange/search` | Yes | Search Exchange assets |
| GET | `/api/exchange/org/:orgId/summary` | Yes | Asset counts per type |
| GET | `/api/exchange/:groupId/:assetId/versions` | Yes | Asset version list |
| GET | `/api/exchange/:groupId/:assetId/:version` | Yes | Specific asset version |
| GET | `/api/exchange/ping-spec` | Yes | Fetch + parse API spec for ping endpoint discovery |

### Metrics — `/api/metrics`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/metrics/cloudhub1/:envId/:appName` | Yes | CH1 app dashboard data |
| GET | `/api/metrics/summary/:orgId` | Yes | Aggregated throughput + error metrics |

### CPS — `/api/cps`

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/cps/credentials` | Yes | List stored CPS credentials (masked) |
| POST | `/api/cps/credentials` | Yes | Store CPS credentials |
| DELETE | `/api/cps/credentials/:key` | Yes | Delete specific credential |
| GET | `/api/cps/fetch` | Yes | Fetch CPS properties |
| POST | `/api/cps/search-user` | Yes | Fan-out CPS username search |

### Health / Ping — `/api/health`

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/health/ping` | Yes | HTTP health check with 6-path discovery |
| POST | `/api/health/auto-credentials` | Yes | Auto-resolve credentials from API Manager |
| POST | `/api/health/auto-contract-creds` | Yes | Create/reuse Exchange contract for credentials |
| POST | `/api/health/oauth2-token` | Yes | Server-side OAuth2 token proxy |

### Server Liveness

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/ping` | No | Express server liveness check |

---

## 20. Recommendations

### 20.1 Immediate Priority (Critical Bugs — `docs/global-search-bugs.md`)

1. **Fix `detectEnvType` STAGING regex** (`cps.js`) — one-line fix, unblocks all STAGING environment searches:
   ```javascript
   if (/\b(uat|ut|stag(e|ing)?|stg|uap|sandbox)\b/i.test(s)) return 'uat';
   ```

2. **Add `ds.runtimeProperties` to `extractCpsConfig`** (`UserSearchPage.jsx`) — one-line fix:
   ```javascript
   ...(ds.runtimeProperties || {}),
   ```

3. **Fix `envName` fallback** (`UserSearchPage.jsx`) — one-line fix:
   ```javascript
   envName: a.environment?.name || sel.envName,
   ```

4. **Fix `postCreds` BG key** (`UserSearchPage.jsx`) — use per-entry `bgOrgId` instead of `entries[0].bgOrgId`

5. **Add credential retry to `processApp`** (`cps.js`) — mirror the retry pattern from `/fetch` route

### 20.2 Short-term (Production Readiness)

6. **Persistent session store** — Replace `MemoryStore` with `connect-redis`:
   ```bash
   npm install connect-redis redis
   ```
   Sessions survive server restarts; enables horizontal scaling.

7. **React Error Boundaries** — Add `<ErrorBoundary>` in `App.jsx`:
   ```jsx
   <ProtectedRoute>
     <ErrorBoundary>
       <Layout />
     </ErrorBoundary>
   </ProtectedRoute>
   ```

8. **Expose `memberOrgs` in AuthContext** — The `/auth/session` endpoint already returns `memberOrgs[]`; adding it to context state avoids the redundant `/organizations/business-groups` call that several pages currently make on mount.

### 20.3 Medium-term (Code Quality)

9. **TypeScript migration** — Start with the utility layer (`appHelpers.ts`, `cpsHelpers.ts`, `orgHelpers.ts`) then extend to routes and React components. The function signatures are well-documented via JSDoc — straightforward conversion.

10. **Unit test coverage** — Priority targets:
    - `normalizeStatus()` — maps CH1/CH2 raw status strings
    - `stripDeploymentSuffix()` — drives fuzzy name matching
    - `flattenCpsResponse()` — handles 4 CPS response shapes
    - `extractCpsConfig()` — extracts CPS config from ARM properties
    - `parseCsvToCredentialMap()` — parses uploaded credentials
    - `findApiIdInProps()` — finds API ID with 4-priority fallback

11. **ESLint + Prettier** — Add configs to enforce consistent style. The codebase is clean but has minor style variations across files.

12. **Fix README API route references** (`README.md`) — The README documents wrong paths:
    - `POST /api/login` → should be `POST /api/auth/login`
    - `GET /api/logout` → should be `POST /api/auth/logout`
    - `GET /api/me` → should be `GET /api/auth/session`

### 20.4 Long-term (Enhancement Opportunities)

13. **WebSocket / SSE for live app status** — Replace manual refresh with server-sent events for real-time status updates on the Applications page.

14. **Deployment history per app** — Surface the last N deployments from ARM deployment history API.

15. **App grouping by API layer** — Classify apps as Experience / Process / System based on naming patterns (`xapi-*`, `papi-*`, `sapi-*`) for API-led connectivity visualization.

16. **Multi-tab support** — Current session is shared across browser tabs; a tab manager would allow different BG/env contexts in parallel.

17. **CPS diff export to multi-sheet Excel** — Currently exports to CSV; a multi-sheet `.xlsx` with one sheet per property type (non-secure / secure / binaries) would be more useful for reports.

18. **Token refresh / auto re-login** — Implement silent token refresh before the 60-minute Anypoint token expiry to avoid mid-session disruptions.

---

## Summary

The MuleSoft Integration Dashboard is a **well-architected, production-quality** operations tool that successfully automates the most common manual Anypoint Platform tasks.

### Key Architectural Highlights

1. **Security-first proxy pattern** — bearer token never leaves the backend session
2. **3-mode authentication** covering all Anypoint access scenarios (U/P, SSO via token, Connected App)
3. **Comprehensive CPS automation** — auto-extraction from ARM properties, intelligent credential retry, cross-env diff, global search
4. **Resilient bulk operations** — `Promise.allSettled` at every fan-out level prevents single-BG failures from blocking results
5. **Demo mode** — zero-friction onboarding without any Anypoint credentials
6. **Two-layer caching** (backend session + frontend module) minimizes redundant API calls
7. **Smart ping engine** — 6-path discovery, dual CH1/CH2 base URL resolution, domain qualifier support for FINANCIALS environments, 3-layer credential auto-resolution, JWT auto-fetch
8. **Shared utility pattern** — canonical exports in `appUtils.js`, `cpsHelpers.js`, `csvCredentialStore.js`, `filterUtils.js` prevent logic drift across pages

### Bug Status Summary

| Category | Count |
|---|---|
| ✅ Fixed (from BUG_FIX_PLAN.md) | 9 bugs |
| 🔴 Open Critical (Global Search) | 6 bugs |
| 🟠 Open Significant (Global Search) | 3 bugs |
| 🟡 Open Minor (Global Search) | 2 bugs |
| 🔴 Improvements Not Started | 6 items |

### File Count

| Category | Count |
|---|---|
| Backend source files | 14 |
| Frontend source files | 37 |
| Documentation files | 5 |
| **Total** | **56** |

---

*Reference: [MuleSoft Anypoint Platform Documentation](https://docs.mulesoft.com/general/)*

*This analysis was generated by reading every source file using only built-in file tools — no command prompt was used.*
