# SOP — MuleSoft Operations Dashboard: Setup & Installation

**Document owner:** Platform/DevOps
**Applies to:** `mulesoft-ops-dashboard` monorepo (`backend/` + `frontend/`)
**Last reviewed:** 2026-10-06

---

## 1. Purpose

This SOP describes how to install, configure, and run the MuleSoft Operations
Dashboard — a Node.js/Express backend that proxies and aggregates data from
the Anypoint Platform (Platform APIs, API Manager, CloudHub 1.0/2.0,
Exchange, and Configuration Property Server instances), paired with a
React/Vite frontend — for local development and for a production deployment.

## 2. Scope

Covers: prerequisites, repository layout, dependency installation,
environment configuration, Anypoint Connected App setup, running in
development, building/running in production, verification steps, and
troubleshooting. Does not cover infrastructure provisioning (reverse proxy,
TLS termination, process manager) beyond what's required to run the app
itself — adapt §8 to your actual hosting environment.

## 3. Prerequisites

| Requirement | Version | Why |
|---|---|---|
| Node.js | **≥ 22.5** (LTS "Jod" or newer recommended) | Backend uses Node's built-in `node:sqlite` (`DatabaseSync`) for session storage and app history — this API is not available on older Node versions. There is no `.nvmrc`/`engines` field in the repo, so this must be verified manually. |
| npm | bundled with Node | Repo uses npm workspaces (root `package.json` lists `backend` and `frontend` as workspaces). |
| Git | any recent version | To clone the repo. |
| Anypoint Platform access | — | A user account (and optionally a Connected App) with access to the organization(s) this dashboard will manage. |

Verify Node version before anything else:

```bash
node --version   # must print v22.5.0 or higher
```

If it's lower, install a newer Node (nvm/nvm-windows, volta, or direct
installer) and switch to it before proceeding.

## 4. Repository Layout (relevant to setup)

```
mulesoft-ops-dashboard/
├── package.json              # root — npm workspaces, orchestration scripts
├── backend/
│   ├── package.json
│   ├── .env.example          # copy to .env and fill in
│   ├── src/server.js         # entry point (node src/server.js)
│   └── data/                 # auto-created at runtime — SQLite files (app.db, sessions.db)
└── frontend/
    ├── package.json
    ├── vite.config.js        # dev server port 5173, proxies /api → :5000
    └── vendor/
        └── xlsx-0.20.3.tgz   # local tarball dependency — must exist before `npm install`
```

**No Docker files, no CI/CD pipeline, and no database server to provision**
exist in this repo — the backend is a stateless Anypoint API proxy/aggregator
with a local SQLite file for session storage, ping history, and a CPS audit
log, auto-created on first boot.

## 5. Installation Steps

### 5.1 Clone the repository

```bash
git clone <repo-url> mulesoft-ops-dashboard
cd mulesoft-ops-dashboard
```

### 5.2 Verify the frontend vendor dependency exists

The frontend's `xlsx` dependency is installed from a **local tarball**, not
the public npm registry:

```bash
ls frontend/vendor/xlsx-0.20.3.tgz
```

If this file is missing, `npm install` will fail for the frontend workspace.
Obtain the tarball from the original source/repo history before continuing.

### 5.3 Install dependencies (both workspaces)

From the repo root:

```bash
npm install
```

This installs `backend/` and `frontend/` dependencies in one pass via npm
workspaces (root `package.json`'s `workspaces` field). Equivalent to running
`npm run install:all`. To install just one side:

```bash
npm run install:backend
npm run install:frontend
```

### 5.4 Configure backend environment variables

Copy the example env file and edit it:

```bash
cp backend/.env.example backend/.env
```

Open `backend/.env` and set the following. **Full variable reference:**

| Variable | Default if unset | Required? | Purpose |
|---|---|---|---|
| `PORT` | `5000` | No | Backend HTTP listen port |
| `NODE_ENV` | `development` | Set to `production` for prod | Enables trust-proxy, secure cookies, strict `SESSION_SECRET` check, rate-limit enforcement |
| `SESSION_SECRET` | insecure dev default (warns) | **Yes in production** — process exits if unset/default in prod | express-session cookie signing secret |
| `SESSION_DB_DIR` | `./data` | No | Directory for `app.db` (ping history, CPS audit log) and `sessions.db` — auto-created |
| `SESSION_MAX_AGE_MS` | `86400000` (24h) | No | Session cookie lifetime |
| `LOG_LEVEL` | `info` | No | Winston log verbosity (`debug`/`info`/`warn`/`error`) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3000` | **Yes for prod** | Comma-separated allowed frontend origin(s) — no wildcards allowed since cookies (`credentials: true`) are used |
| `ANYPOINT_PLATFORM_URL` | `https://anypoint.mulesoft.com` | No (change only for a different Anypoint control plane / Gov Cloud) | Base URL for all Anypoint API calls |
| `CPS_CA_CERT_PATH` | unset → TLS verification disabled for CPS/ping/internal calls only (warns once) | Recommended if your CPS servers use an internal/self-signed CA | PEM CA bundle path |
| `CPS_CREDS_ENC_KEY` | falls back to `SESSION_SECRET` | No | AES-256-GCM key encrypting CPS client secrets at rest |
| `RATE_LIMIT_ENFORCE_DEV` | `false` | No | Set `true` to test rate limiting locally |
| `AUTH_RATE_LIMIT_WINDOW_MS` / `AUTH_RATE_LIMIT_MAX` | `900000` / `20` | No | Login endpoint brute-force limiter |
| `API_RATE_LIMIT_WINDOW_MS` / `API_RATE_LIMIT_MAX` | `60000` / `300` | No | General `/api/*` limiter |
| `SEARCH_USER_RATE_LIMIT_WINDOW_MS` / `_MAX` | `60000` / `10` | No | `/api/cps/search-user` limiter |
| `CPS_CH1_PROD_CLIENT_ID` / `_SECRET` | blank | No — can be entered via the UI settings modal instead | CloudHub 1.0 production CPS credentials |
| `CPS_CH2_PROD_CLIENT_ID` / `_SECRET` | blank | No | CloudHub 2.0 production CPS credentials |
| `CPS_CH1_UAT_CLIENT_ID` / `_SECRET` | blank | No | CloudHub 1.0 UAT CPS credentials |
| `CPS_CH2_UAT_CLIENT_ID` / `_SECRET` | blank | No | CloudHub 2.0 UAT CPS credentials |

Generate a strong `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

> The frontend has **no environment file** — its only backend-reachability
> config is `vite.config.js`'s dev-server proxy (`/api` → `http://localhost:5000`),
> which only applies to `npm run dev`. In production the frontend is a static
> build (see §7) and must be served behind the same origin/reverse proxy as
> the backend, or `CORS_ORIGINS` must include the frontend's real origin.

### 5.5 Set up Anypoint access

Users log in through the dashboard's own login page using one of three
methods (`backend/src/routes/auth.js`), **not Okta/SSO** — all three resolve
to an Anypoint Platform bearer token used for every proxied API call:

1. **Username / password** — the user's own Anypoint credentials.
2. **Bearer token** — a token pasted directly (e.g. grabbed from Anypoint's
   own session) — no setup needed, but short-lived.
3. **Connected App (client_credentials)** — recommended for shared/service
   use. Create one in Anypoint:
   - Anypoint Platform → Access Management → Connected Apps → **Create App**
   - Grant type: **Client Credentials**
   - Scopes needed (grant generously — the dashboard proxies all of these):
     - Platform APIs: View Organization, View Environments, View Member
       (user profile `/accounts/api/me`)
     - API Manager: Manage/View APIs and Policies
     - CloudHub 1.0 and CloudHub 2.0: View/Manage Applications (start, stop,
       restart, scheduler trigger/toggle)
     - Exchange: View Assets
   - Save the generated **Client ID** and **Client Secret** — users enter
     these on the dashboard's login screen ("Connected App" tab).

CPS (Configuration Property Server) access is a **separate credential set**
from Anypoint login — either pre-filled via the `CPS_CH{1,2}_{PROD,UAT}_*`
env vars (§5.4) or uploaded per-session as a CSV via the dashboard's own UI
(Header → "CPS Creds" import, or the one-time welcome modal shown after
first login).

## 6. Running in Development

From the repo root:

```bash
npm run dev
```

This runs backend and frontend **concurrently** (prefixed `BACKEND`/`FRONTEND`
in the console):
- Backend: `nodemon` watching `backend/src/**/*.{js,json}`, auto-restarting on
  change, listening on `http://localhost:5000`.
- Frontend: Vite dev server on `http://localhost:5173`, proxying all `/api/*`
  requests to the backend.

Open **http://localhost:5173** in a browser and log in using one of the
methods from §5.5 (or click **"Try Demo Mode"** on the login page for a
fully mocked, no-backend-calls walkthrough).

On first login, a one-time **welcome modal** offers to import Ping Test and
CPS credential CSVs — these can be skipped and imported later from the
header at any time. All credentials are held in browser memory only (never
persisted to disk/localStorage) and are cleared on logout or page refresh.

## 7. Building for Production

```bash
npm run build
```

Equivalent to `npm run build -w frontend` — runs `vite build`, producing a
static bundle in `frontend/dist/`. There is no backend build step (plain
Node, no transpilation).

To run the production backend:

```bash
NODE_ENV=production npm run start -w backend
# or, from backend/:
NODE_ENV=production node src/server.js
```

Then serve `frontend/dist/` as static files — either:
- Via the same reverse proxy/static host that also forwards `/api/*` to the
  backend process (so both are same-origin and `CORS_ORIGINS` can stay
  permissive), **or**
- From a separate static host/CDN, in which case set `CORS_ORIGINS` in the
  backend's `.env` to that exact frontend origin (scheme + host + port).

**Production hard requirements** (the backend will refuse to start / log a
fatal error otherwise):
- `SESSION_SECRET` must be set to a non-default, sufficiently random value.
- `NODE_ENV=production` must be set for secure cookies, rate limiting, and
  trust-proxy behavior to activate.

> No process manager, Dockerfile, or CI/CD pipeline ships with this repo —
> wrap `node src/server.js` with your organization's standard (systemd, pm2,
> a container you build yourself, etc.) as appropriate for your environment.

## 8. First-Run Verification Checklist

- [ ] `node --version` ≥ 22.5
- [ ] `frontend/vendor/xlsx-0.20.3.tgz` present before `npm install`
- [ ] `npm install` completes with no errors in either workspace
- [ ] `backend/.env` exists with a real `SESSION_SECRET` (not the example placeholder)
- [ ] `npm run dev` starts both processes without crash-looping
- [ ] `backend/data/app.db` and `backend/data/sessions.db` are created automatically on first backend boot
- [ ] Frontend loads at `http://localhost:5173` and the login page renders
- [ ] Logging in (any method, or Demo Mode) lands on `/applications` and lists apps
- [ ] (Optional) Welcome modal CSV import accepts a sample `client_id,client_secret` CSV without error

## 9. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Backend crashes immediately with a `node:sqlite` / `DatabaseSync` error | Node version too old | Upgrade to Node ≥ 22.5 |
| `npm install` fails resolving `xlsx` | `frontend/vendor/xlsx-0.20.3.tgz` missing | Restore the tarball into `frontend/vendor/` before installing |
| Backend logs a fatal error about `SESSION_SECRET` and exits | Running with `NODE_ENV=production` and an unset/default secret | Set a real `SESSION_SECRET` in `backend/.env` |
| Login succeeds but every subsequent API call returns 401 | Session cookie blocked by browser (cross-origin cookie, `CORS_ORIGINS` mismatch) | Ensure `CORS_ORIGINS` exactly matches the frontend's origin (scheme+host+port), and that frontend/backend are both `http` or both `https` in dev |
| All sessions are lost after every backend restart | Expected behavior — `sessions.db` is wiped on every process start (`clearOnStart: true`) | Not a bug; re-login after restarting the backend |
| CPS/ping requests fail TLS verification | Self-signed/internal CA not trusted | Set `CPS_CA_CERT_PATH` to a PEM bundle containing that CA |
| Ping/CPS credentials disappear after refreshing the page | Expected behavior — credentials are RAM-only, never persisted | Re-upload the CSV, or set the `CPS_CH*_CLIENT_ID/_SECRET` env vars for CPS so they don't need re-uploading |

## 10. Related Documents

- `backend/BACKEND_ANALYSIS_REPORT.md` — backend security/performance audit (background reading, not a setup guide).
- `SCHEDULERS_PAGE_FLOW.md` (repo root) — functional notes on the Schedulers page.

---
*This SOP reflects the repository state as of the last reviewed date above. If `backend/.env.example`, `package.json` scripts, or the Node version requirement change, update this document accordingly.*
