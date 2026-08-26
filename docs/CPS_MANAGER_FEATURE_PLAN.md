# CPS Property Manager — Feature Plan

**Feature:** Full CRUD + Auth Management for CPS Properties  
**Date:** August 2026  
**Status:** 📋 Planning  
**Reference:** `CPS.postman_collection.json` — actual API contracts verified

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [CPS Servers and Environments](#2-cps-servers-and-environments)
3. [Actual CPS API Contracts (from Postman)](#3-actual-cps-api-contracts-from-postman)
4. [Backend — New Routes](#4-backend--new-routes)
5. [Frontend — New Page Design](#5-frontend--new-page-design)
6. [Frontend — Auth Management Sub-Feature](#6-frontend--auth-management-sub-feature)
7. [Frontend — Component Changes](#7-frontend--component-changes)
8. [Data Flow Diagrams](#8-data-flow-diagrams)
9. [Security Considerations](#9-security-considerations)
10. [Implementation Steps (Ordered)](#10-implementation-steps-ordered)
11. [Files to Create / Modify](#11-files-to-create--modify)
12. [Out of Scope](#12-out-of-scope)

---

## 1. Feature Overview

The existing CPS pages are **read-only**. This feature adds a dedicated **CPS Property Manager** page with full write capability:

| Operation | Description |
|---|---|
| **Read** | View all non-secure, secure, and binary properties (already exists) |
| **Create** | Create a new project entry with properties (`POST`) |
| **Update** | Update an existing project's properties (`PUT`) |
| **Delete** | Delete an entire project entry (`DELETE ?keys=project-name`) |
| **Auth — View** | See which clientIds are allowed to access a project (`GET /auth`) |
| **Auth — Update** | Add/replace allowed clientIds for a project (`PUT /auth/add`) |
| **Binary Upload** | Upload binary files (`.jks`, `.pem`, `.gpg`, etc.) to CPS |
| **Bulk Import** | Upload CSV/JSON → creates/updates properties in bulk |
| **Bulk Export** | Download current properties as CSV for backup/audit |

### New Route: `/cps-manager`

---

## 2. CPS Servers and Environments

From the Postman collection, there are **4 distinct CPS servers**:

| Label | URL | CloudHub | Env |
|---|---|---|---|
| PROD 1.0 | `https://ei-sapi-config-property-v2-uw2-pd.internalapi.sfdcbt.net` | CH1 | Production |
| UAT 1.0 | `https://ei-sapi-config-property-v2-uw2-ut.stage.internalapi.sfdcbt.net` | CH1 | UAT/Staging |
| PROD 2.0 | `https://sapi-config-property-pd.bt-integration.api.sfdcbt.net` | CH2 | Production |
| UAT 2.0 | `https://sapi-config-property-ut.stage.bt-integration.api.sfdcbt.net` | CH2 | UAT/Staging |

All servers use `client_id` / `client_secret` as **request headers** (not Bearer token).

---

## 3. Actual CPS API Contracts (from Postman)

### 3.1 GET (Read) — Already Supported

| Method | Path | Query Params | Description |
|---|---|---|---|
| GET | `/api/v2/properties/non-secure` | `environment`, `keys` | Read non-secure properties for a project |
| GET | `/api/v2/properties/non-secure/all` | `environment`, `keys?` | Read ALL non-secure projects |
| GET | `/api/v2/properties/non-secure/auth` | `environment`, `keys` | **See who has access** to a project |
| GET | `/api/v2/properties/secure` | `environment`, `keys` | Read secure properties |
| GET | `/api/v2/properties/secure/all` | `environment` | Read ALL secure projects |
| GET | `/api/v2/properties/secure/auth` | `environment`, `keys` | See who has access (secure) |
| GET | `/api/v2/binaries/secure` | `environment`, `keys` | Read binary assets |
| GET | `/api/v2/binaries/secure/auth` | `environment`, `keys` | See who has access (binaries) |

### 3.2 POST (Create) — NEW

> ⚠️ **Key Discovery**: The write body uses `"properties"` array, NOT `"responses"` (which is the read response shape).

#### Non-Secure / Secure Properties

```
POST {baseUrl}/api/v2/properties/non-secure
POST {baseUrl}/api/v2/properties/secure

Headers:
  client_id: {clientId}
  client_secret: {clientSecret}
  Content-Type: application/json

Body:
{
  "properties": [
    {
      "environment": "prod",
      "key": "my-api-name",
      "properties": {
        "cps.secure.properties": "plt-cloudhub,https-jks-tls",
        "version": "1.0.0",
        "api.base.url": "https://api.example.com",
        "db.timeout": "30000"
      }
    }
  ]
}
```

> Multiple project entries can be POSTed in one call (array of length > 1).

#### Binary Upload

```
POST {baseUrl}/api/v2/binaries/secure

Headers:
  client_id: {clientId}
  client_secret: {clientSecret}
  Content-Type: application/octet-stream
  key: {filename}          ← e.g. "api-httplistener.jks"
  environment: {env}       ← e.g. "prod"

Body: <binary file bytes>
```

### 3.3 PUT (Update) — NEW

Same body format as POST. PUT is used to **update** an existing project entry.

#### Non-Secure / Secure Properties

```
PUT {baseUrl}/api/v2/properties/non-secure
PUT {baseUrl}/api/v2/properties/secure

Headers + Body: identical to POST
```

#### Binary Upload (Update)

```
PUT {baseUrl}/api/v2/binaries/secure

Headers:
  client_id, client_secret
  Content-Type: application/octet-stream
  environment: {env}
  key: {filename}

Body: <binary file bytes>
```

#### Auth Management — Full Replace

```
PUT {baseUrl}/api/v2/properties/non-secure/auth

Body:
{
  "properties": [
    {
      "environment": "prod",
      "key": "my-api-name",
      "allowedClientIds": ["clientId1", "clientId2"]
    }
  ]
}
```

#### Auth Management — Add to Existing (non-destructive)

```
PUT {baseUrl}/api/v2/properties/non-secure/auth/add
PUT {baseUrl}/api/v2/properties/secure/auth/add
PUT {baseUrl}/api/v2/binaries/secure/auth/add

Body:
{
  "properties": [
    {
      "environment": "prod",
      "key": "my-api-name",
      "allowedClientIds": ["newClientId1", "newClientId2"],
      "readOnlyClientIds": ["readOnlyClientId1"]
    }
  ]
}
```

> **`allowedClientIds`** = full read+write access  
> **`readOnlyClientIds`** = read-only access

### 3.4 DELETE — NEW

> ⚠️ **Critical Discovery**: DELETE removes the **entire project entry** for the given `keys` (project name). There is NO endpoint to delete an **individual property key** within a project — to remove one property you must `PUT` the full project with that key omitted.

```
DELETE {baseUrl}/api/v2/properties/non-secure?environment=prod&keys=my-api-name
DELETE {baseUrl}/api/v2/properties/secure?environment=prod&keys=my-secure-group
DELETE {baseUrl}/api/v2/binaries/secure?environment=prod&keys=api-httplistener.jks

Headers:
  client_id: {clientId}
  client_secret: {clientSecret}
```

### 3.5 Summary of Corrections vs. Initial Plan

| Initial Assumption | Actual CPS API |
|---|---|
| Write body uses `responses` array | ❌ Write body uses `properties` array |
| DELETE removes individual property key | ❌ DELETE removes entire project entry |
| Binary headers in query params | ❌ Binary `key` + `environment` are **request headers** |
| Auth = just credentials | ❌ Auth also = `allowedClientIds`/`readOnlyClientIds` per project |
| Single delete/update endpoint | ❌ Auth has two variants: `/auth` (replace) and `/auth/add` (append) |

---

## 4. Backend — New Routes

All routes are added to `backend/src/routes/cps.js` under the existing `/api/cps` prefix. All use `authMiddleware`.

### 4.1 `POST /api/cps/write` — Create or Update Project Properties

```javascript
// Body: { baseUrl, type, environment, projectKey, properties, bgOrgId }
// type: 'non-secure' | 'secure'
// properties: { "key1": "val1", "key2": "val2", ... }
// Method: 'POST' | 'PUT' (caller specifies which HTTP verb to use)
router.post('/write', authMiddleware, async (req, res) => {
  const { baseUrl, type, method = 'PUT', environment, projectKey, properties, bgOrgId } = req.body;
  const creds = getCredentials(req, baseUrl, bgOrgId, ...);
  if (!creds) return res.status(422).json({ error: 'CPS credentials not configured' });

  const normUrl = normaliseUrl(baseUrl);
  const pathMap = {
    'non-secure': '/api/v2/properties/non-secure',
    'secure':     '/api/v2/properties/secure',
  };
  const cpsPath = pathMap[type];
  const fullUrl = `${normUrl}${cpsPath}`;

  const body = {
    properties: [{ environment, key: projectKey, properties }]
  };

  const response = await axios({
    method: method.toLowerCase(),  // 'post' or 'put'
    url: fullUrl,
    headers: {
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      'Content-Type': 'application/json'
    },
    data: body,
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    return res.status(response.status).json({ error: response.data?.message || `CPS ${method} failed` });
  }
  res.json({ success: true, method, projectKey, propertyCount: Object.keys(properties).length });
});
```

### 4.2 `DELETE /api/cps/project` — Delete Entire Project Entry

```javascript
// Body: { baseUrl, type, environment, projectKey, bgOrgId }
// Deletes the ENTIRE project entry (all properties for that key+environment)
router.delete('/project', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, projectKey, bgOrgId } = req.body;
  const creds = getCredentials(req, baseUrl, bgOrgId, ...);

  const pathMap = {
    'non-secure': '/api/v2/properties/non-secure',
    'secure':     '/api/v2/properties/secure',
    'binaries':   '/api/v2/binaries/secure',
  };
  const fullUrl = `${normaliseUrl(baseUrl)}${pathMap[type]}`;

  const response = await axios.delete(fullUrl, {
    headers: { client_id: creds.clientId, client_secret: creds.clientSecret },
    params: { environment, keys: projectKey },
    validateStatus: () => true,
  });

  if (response.status >= 400) {
    return res.status(response.status).json({ error: `CPS DELETE failed (${response.status})` });
  }
  res.json({ success: true, deleted: projectKey, environment });
});
```

### 4.3 `GET /api/cps/auth` — Fetch Access Control List for a Project

```javascript
// Query: baseUrl, type, environment, projectKey, bgOrgId
router.get('/auth', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, projectKey, bgOrgId } = req.query;
  const creds = getCredentials(req, baseUrl, bgOrgId, ...);

  const authPathMap = {
    'non-secure': '/api/v2/properties/non-secure/auth',
    'secure':     '/api/v2/properties/secure/auth',
    'binaries':   '/api/v2/binaries/secure/auth',
  };
  const fullUrl = `${normaliseUrl(baseUrl)}${authPathMap[type]}`;

  const response = await axios.get(fullUrl, {
    headers: { client_id: creds.clientId, client_secret: creds.clientSecret },
    params: { environment, keys: projectKey },
    validateStatus: () => true,
  });
  res.status(response.status).json(response.data);
});
```

### 4.4 `POST /api/cps/auth` — Update Access Control List

```javascript
// Body: { baseUrl, type, environment, projectKey, allowedClientIds[], readOnlyClientIds[]?, replace, bgOrgId }
// replace = true → PUT /auth (full replace)
// replace = false → PUT /auth/add (append — non-destructive)
router.post('/auth', authMiddleware, async (req, res) => {
  const { baseUrl, type, environment, projectKey, allowedClientIds, readOnlyClientIds = [], replace = false, bgOrgId } = req.body;
  const creds = getCredentials(req, baseUrl, bgOrgId, ...);

  const baseAuthPath = {
    'non-secure': '/api/v2/properties/non-secure/auth',
    'secure':     '/api/v2/properties/secure/auth',
    'binaries':   '/api/v2/binaries/secure/auth',
  };
  const suffix = replace ? '' : '/add';
  const fullUrl = `${normaliseUrl(baseUrl)}${baseAuthPath[type]}${suffix}`;

  const body = {
    properties: [{
      environment,
      key: projectKey,
      allowedClientIds,
      ...(readOnlyClientIds.length > 0 && { readOnlyClientIds }),
    }]
  };

  const response = await axios.put(fullUrl, body, {
    headers: { client_id: creds.clientId, client_secret: creds.clientSecret, 'Content-Type': 'application/json' },
    validateStatus: () => true,
  });

  if (response.status >= 400) return res.status(response.status).json({ error: 'Auth update failed' });
  res.json({ success: true, allowedClientIds, readOnlyClientIds });
});
```

### 4.5 `POST /api/cps/credentials/test` — Test CPS Credential

```javascript
// Body: { baseUrl, clientId, clientSecret, environment, projectKey }
router.post('/credentials/test', authMiddleware, async (req, res) => {
  const { baseUrl, clientId, clientSecret, environment, projectKey } = req.body;
  const normUrl = normaliseUrl(baseUrl);
  const url = `${normUrl}/api/v2/properties/non-secure`;

  try {
    const r = await axios.get(url, {
      headers: { client_id: clientId, client_secret: clientSecret },
      params: { environment, keys: projectKey || '' },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (r.status === 401) return res.json({ valid: false, statusCode: 401, message: 'Invalid credentials' });
    if (r.status === 403) return res.json({ valid: false, statusCode: 403, message: 'Insufficient permissions' });
    if (r.status === 200) return res.json({ valid: true, statusCode: 200, message: 'Connected successfully' });
    return res.json({ valid: false, statusCode: r.status, message: `Unexpected response: HTTP ${r.status}` });
  } catch (err) {
    const msg = err.code === 'ECONNABORTED' ? 'CPS server unreachable (timeout)' : err.message;
    return res.json({ valid: false, statusCode: 0, message: msg });
  }
});
```

### 4.6 Audit Logging (all write routes)

```javascript
// Called inside every write handler before returning success:
console.info(`[CPS Write] user=${req.session.username} op=${op} project=${projectKey} env=${environment} type=${type} base=${normaliseUrl(baseUrl)}`);
```

---

## 5. Frontend — New Page Design

### 5.1 Route: `/cps-manager`

New page `frontend/src/pages/CpsManagerPage.jsx`

### 5.2 Page Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  🗄️ CPS Property Manager     [Import CSV] [Export] [🔑 Auth] [Test]  │
├──────────────────────────────────────────────────────────────────────┤
│  ⚠️ PRODUCTION — changes take effect immediately (red banner if prod) │
├──────────────────────────────────────────────────────────────────────┤
│  BG: [dropdown]  Env: [dropdown]  App: [dropdown]                    │
│  CPS URL: [auto-filled, editable] Env Prefix: [uat/prod, editable]   │
│  Project Key: [auto-filled, editable]   [🔑 Creds: auto-resolved]   │
│                                          [Load Properties] [+ Create]│
├──────────────────────────────────────────────────────────────────────┤
│  Tabs: [Non-Secure] [Secure] [Binaries] [🔐 Access Control]          │
├──────────────────────────────────────────────────────────────────────┤
│  🔍 [Search properties...]                       [Save Changes] [↺]  │
├──────────────────────────────────────────────────────────────────────┤
│  # │ Property Key           │ Value (editable inline) │ ✏️ 🗑️        │
│────┼───────────────────────┼────────────────────────┼──────────────│
│  1 │ api.base.url           │ [https://api.example]   │ ✏️ ➖        │
│  2 │ db.url                 │ [jdbc:oracle://...]     │ ✏️ ➖        │
│  3 │ cps.secure.properties  │ [plt-cloudhub,https-jks │ ✏️ ➖        │
│    │ [+ Add Property Row]   │                         │             │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.3 Key UX Decisions

1. **Inline editing** — click the Value cell to edit in-place; changes are buffered locally until **[Save Changes]** is clicked
2. **Batch save** — all edits are sent in a single `PUT` call with the full updated property map (not one call per edit)
3. **No per-row save** — avoids N API calls for N changes; operator reviews the full diff before saving
4. **Changed rows highlighted** — modified rows show a blue left border; new rows show a green border; deleted rows show strikethrough in red
5. **[Save Changes]** button is disabled when no changes; shows count of pending changes: `Save (3 changes)`
6. **[Discard]** button reverts to last loaded state

### 5.4 Property Type Tabs

| Tab | CPS Path | Write Method | Notes |
|---|---|---|---|
| Non-Secure | `/api/v2/properties/non-secure` | POST / PUT | Full key-value map |
| Secure | `/api/v2/properties/secure` | POST / PUT | Values masked in UI (write-only) |
| Binaries | `/api/v2/binaries/secure` | POST / PUT binary | File upload required |
| Access Control | `/api/v2/.../auth` | PUT/GET | See Section 6 |

### 5.5 Create New Project Modal

Opens when **[+ Create]** is clicked. For a project that doesn't exist yet.

```
┌──────────────────────────────────────────────────┐
│  Create New CPS Project Entry                    │
├──────────────────────────────────────────────────┤
│  Project Key   [my-api-name-v1-uw2-pd]           │
│  Environment   [prod]  (from page config)        │
│  Type          ● Non-Secure  ○ Secure            │
│                                                  │
│  Initial Properties (optional):                  │
│  [key]         [value]       [+ row]             │
│  [key]         [value]                           │
├──────────────────────────────────────────────────┤
│  ⚠️ This will immediately create a new CPS entry. │
│  [ Cancel ]          [ Create Project Entry ]    │
└──────────────────────────────────────────────────┘
```

### 5.6 Delete Project Confirmation

```
┌──────────────────────────────────────────────────┐
│  ⚠️ Delete Entire Project Entry?                  │
├──────────────────────────────────────────────────┤
│  This will delete ALL properties for:            │
│  Project Key: my-api-name-v1-uw2-pd              │
│  Environment: prod                               │
│                                                  │
│  ⛔ This removes the entire project — not just   │
│     individual keys. This cannot be undone.      │
│                                                  │
│  (prod only) ☐ I understand this is PRODUCTION  │
│  [ Cancel ]          [ 🗑️ Delete Project Entry ] │
└──────────────────────────────────────────────────┘
```

### 5.7 Binary Upload Panel (Binaries tab)

```
┌──────────────────────────────────────────────────┐
│  Binary Assets                                   │
├──────────────────────────────────────────────────┤
│  Existing binaries listed from cps.secure.binaries│
│  ─────────────────────────────────────           │
│  api-httplistener.jks        [Replace file] [🗑️] │
│  kafka.client.truststore.jks [Replace file] [🗑️] │
│  ─────────────────────────────────────           │
│  [+ Upload New Binary]                           │
│    Filename: [api-httplistener.jks    ]           │
│    Env:      [prod]                              │
│    [Drop .jks/.pem/.gpg file or browse]          │
│    [ Cancel ]  [ Upload Binary ]                 │
└──────────────────────────────────────────────────┘
```

Binary upload uses `Content-Type: application/octet-stream` with `key` and `environment` as **request headers** (confirmed from Postman collection).

---

## 6. Frontend — Auth Management Sub-Feature

The **Access Control** tab (4th tab) shows and manages which `clientId` values can access the current project key.

### 6.1 Access Control Tab Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔐 Access Control — my-api-name-v1-uw2-pd (prod)  [Refresh] [Edit] │
├──────────────────────────────────────────────────────────────────────┤
│  Mode: ● Replace all  ○ Add to existing (non-destructive)            │
├──────────────────────────────────────────────────────────────────────┤
│  Allowed ClientIds (read + write):                                   │
│  ┌─────────────────────────────────────────────────┐                │
│  │ ce6b10ff5d88467f9fa77fa895350011   [✕]          │                │
│  │ 83a728d71b8f4ec0b4862cfe99a53429   [✕]          │                │
│  │ [+ Add clientId...]                             │                │
│  └─────────────────────────────────────────────────┘                │
│  Read-Only ClientIds:                                                │
│  ┌─────────────────────────────────────────────────┐                │
│  │ 83a728d71b8f4ec0b4862cfe99a53429   [✕]          │                │
│  │ [+ Add clientId...]                             │                │
│  └─────────────────────────────────────────────────┘                │
├──────────────────────────────────────────────────────────────────────┤
│  [ Discard ]              [ Save Auth Changes ]                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 Auth Mode Explanation

| Mode | CPS Endpoint | Behaviour |
|---|---|---|
| **Replace all** | `PUT /auth` | Replaces the entire `allowedClientIds` list — removes IDs not in the new list |
| **Add to existing** | `PUT /auth/add` | Appends new IDs to existing list — safe, non-destructive |

> **Recommendation**: Default to "Add to existing" to prevent accidental removal of other apps' access.

### 6.3 Auth Data Flow

```
1. User clicks "Access Control" tab
2. Frontend: GET /api/cps/auth?baseUrl=X&type=non-secure&environment=prod&projectKey=Y&bgOrgId=Z
3. Backend: GET {baseUrl}/api/v2/properties/non-secure/auth?environment=prod&keys=Y
4. Response shows current allowedClientIds + readOnlyClientIds
5. User edits the list (add/remove clientIds)
6. User clicks [Save Auth Changes]
7. Frontend: POST /api/cps/auth { ..., replace: false/true }
8. Backend: PUT {baseUrl}/api/v2/properties/non-secure/auth[/add]
9. Toast: "Access control updated"
```

---

## 7. Frontend — Component Changes

### 7.1 New Components to Create

| Component | File | Purpose |
|---|---|---|
| `CpsCreateModal` | `components/CpsCreateModal.jsx` | Create new project entry (POST) |
| `CpsDeleteProjectModal` | `components/CpsDeleteProjectModal.jsx` | Delete entire project entry confirmation |
| `CpsBinaryUploadPanel` | `components/CpsBinaryUploadPanel.jsx` | Upload binary files to CPS |
| `CpsAuthPanel` | `components/CpsAuthPanel.jsx` | View + manage allowedClientIds/readOnlyClientIds |
| `CpsCredTestButton` | `components/CpsCredTestButton.jsx` | Test CPS credential validity |
| `CpsImportModal` | `components/CpsImportModal.jsx` | Bulk import CSV/JSON with preview |

### 7.2 Modified Components

| Component | Change |
|---|---|
| `Sidebar.jsx` | Add **CPS Manager** nav item with `Database` icon at `/cps-manager` |
| `CpsSettingsModal.jsx` | Add **Test** button per credential; show ✓/✗ badge after test |
| `App.jsx` | Add `<Route path="cps-manager" element={<CpsManagerPage />} />` |

### 7.3 Reused Components (no changes)

- `Select.jsx` — BG / Env / App dropdowns
- `CpsCredentialImportButton.jsx` — credential CSV import
- `CopyBtn.jsx` — copy property key/value
- `BgFilterModal.jsx` — BG filter

---

## 8. Data Flow Diagrams

### 8.1 Save Property Changes (PUT)

```
User edits properties inline → buffered in pendingChanges state
  │
  User clicks [Save Changes]
  │
  Frontend: POST /api/cps/write
  │   body: { baseUrl, type:'non-secure', method:'PUT', environment,
  │           projectKey, properties: {...mergedProperties}, bgOrgId }
  ▼
Backend: getCredentials(req, baseUrl, bgOrgId, envType, chType)
  │
  PUT {baseUrl}/api/v2/properties/non-secure
  │   body: { "properties": [{ "environment", "key", "properties": { all kv } }] }
  │   headers: { client_id, client_secret, Content-Type: application/json }
  ▼
CPS Server → 200 OK
  │
  Frontend: reload properties → clear pendingChanges → show success toast
```

### 8.2 Delete Project Entry

```
User clicks [🗑️ Delete Project] → CpsDeleteProjectModal opens
  │
  User types project key to confirm → clicks [Delete Project Entry]
  │
  Frontend: DELETE /api/cps/project
  │   body: { baseUrl, type, environment, projectKey, bgOrgId }
  ▼
Backend: getCredentials → resolve credentials
  │
  DELETE {baseUrl}/api/v2/properties/non-secure
  │   params: { environment, keys: projectKey }
  ▼
CPS Server → 204 No Content
  │
  Frontend: clear properties state → show "Project deleted" toast
```

### 8.3 Binary Upload

```
User selects file in CpsBinaryUploadPanel
  │   (file stays in browser memory — no server upload yet)
  │
  User confirms filename + environment → clicks [Upload Binary]
  │
  Frontend: reads file as ArrayBuffer
  │
  POST /api/cps/write (binary endpoint via Axios)
  │   headers: { client_id, client_secret,
  │              Content-Type: application/octet-stream,
  │              key: filename, environment: env }
  │   body: <raw binary bytes>
  ▼
Backend: resolves CPS URL + credentials
  │
  POST/PUT {baseUrl}/api/v2/binaries/secure
  │   headers: { client_id, client_secret,
  │              Content-Type: application/octet-stream,
  │              key: filename, environment: env }
  ▼
CPS Server → 200 OK
  │
  Frontend: refresh binaries list → show "Binary uploaded" toast
```

### 8.4 Auth Update (Add clientIds)

```
User opens Access Control tab
  │
  GET /api/cps/auth → returns current allowedClientIds + readOnlyClientIds
  │
  User adds new clientId to allowedClientIds list
  │
  User clicks [Save Auth Changes] (mode: Add to existing)
  │
  POST /api/cps/auth
  │   body: { baseUrl, type, environment, projectKey,
  │           allowedClientIds: [...existing + new], replace: false, bgOrgId }
  ▼
Backend: PUT {baseUrl}/api/v2/properties/non-secure/auth/add
  │   body: { "properties": [{ environment, key, allowedClientIds }] }
  ▼
CPS Server → 200 OK
  │
  Frontend: reload access control list → show "Auth updated" toast
```

---

## 9. Security Considerations

| Safeguard | Implementation |
|---|---|
| **Auth required** | All new routes use `authMiddleware` |
| **Credentials required** | Write routes use `getCredentials()` — 422 if not configured |
| **Production red banner** | `envType === 'production'` triggers persistent warning banner |
| **Production confirmation** | Delete + Save on prod shows "I understand this is PRODUCTION" checkbox |
| **Secure value masking** | Secure tab values shown as `••••••` — edit is write-only |
| **Batch save review** | Changed rows highlighted before saving — user sees full diff |
| **Auth mode default: Add** | Default to non-destructive `/auth/add` to prevent accidental removals |
| **Audit log** | All writes logged with `console.info` (user, op, project, env, base) |
| **No bulk delete** | Only per-project deletion; no "delete all" |

---

## 10. Implementation Steps (Ordered)

### Phase 1 — Backend (Days 1–2)

- [ ] **1.1** Add `POST /api/cps/write` — handles both POST and PUT via `method` param; correct body format `{ "properties": [...] }`
- [ ] **1.2** Add `DELETE /api/cps/project` — deletes entire project via query `?environment=X&keys=Y`
- [ ] **1.3** Add `GET /api/cps/auth` — fetch `allowedClientIds` for a project
- [ ] **1.4** Add `POST /api/cps/auth` — update auth (`/auth` replace or `/auth/add` append)
- [ ] **1.5** Add `POST /api/cps/credentials/test` — credential validity check
- [ ] **1.6** Add audit logging to all write handlers
- [ ] **1.7** Add binary write route (`POST /api/cps/binary`) — proxies `application/octet-stream` with `key`/`environment` headers

### Phase 2 — Frontend Components (Days 3–4)

- [ ] **2.1** Create `CpsCreateModal.jsx` — create new project with initial properties
- [ ] **2.2** Create `CpsDeleteProjectModal.jsx` — confirm deletion with project key type-to-confirm
- [ ] **2.3** Create `CpsBinaryUploadPanel.jsx` — file picker + upload to CPS binaries
- [ ] **2.4** Create `CpsAuthPanel.jsx` — view + edit `allowedClientIds`/`readOnlyClientIds`
- [ ] **2.5** Create `CpsCredTestButton.jsx` — test credential button with ✓/✗ badge
- [ ] **2.6** Create `CpsImportModal.jsx` — CSV/JSON bulk import with preview

### Phase 3 — Frontend Page (Days 5–6)

- [ ] **3.1** Create `CpsManagerPage.jsx`
  - BG → Env → App selector + ARM property auto-extraction (reuse `extractCpsConfig()`)
  - 4 tabs: Non-Secure | Secure | Binaries | Access Control
  - Inline-editable property table with buffered change tracking
  - `pendingChanges` state: `{ added: {k:v}, modified: {k:v}, deleted: Set<k> }`
  - [Save Changes] = merge original + pending → single `PUT /api/cps/write`
  - Production env red banner
  - [Import CSV] → `CpsImportModal` → `PUT /api/cps/write` with all imported properties
  - [Export] → `downloadCsv()` (existing utility)
  - [🗑️ Delete Project] button → `CpsDeleteProjectModal`
  - Binaries tab → `CpsBinaryUploadPanel`
  - Access Control tab → `CpsAuthPanel`

- [ ] **3.2** Wire `pendingChanges` state management:
  - Track `originalProperties` (loaded from CPS)
  - Track `pendingChanges` (user edits, additions, removals)
  - Compute `mergedProperties` for save: `{ ...originalProperties, ...pendingChanges.modified, ...pendingChanges.added }` with `pendingChanges.deleted` keys removed
  - Show diff count in [Save Changes] button label

### Phase 4 — Integration (Day 7)

- [ ] **4.1** Add to `frontend/src/App.jsx`:
  ```jsx
  import CpsManagerPage from './pages/CpsManagerPage';
  <Route path="cps-manager" element={<CpsManagerPage />} />
  ```

- [ ] **4.2** Add to `frontend/src/components/Sidebar.jsx`:
  ```jsx
  import { Database } from 'lucide-react';
  { to: '/cps-manager', icon: Database, label: 'CPS Manager' },
  ```

- [ ] **4.3** Update `frontend/src/services/api.js` demo mode mock handlers:
  ```javascript
  if (url === '/cps/write')          return { data: { success: true, method: 'PUT', propertyCount: 5 } };
  if (url === '/cps/project')        return { data: { success: true, deleted: 'mock-project' } };
  if (url === '/cps/auth')           return { data: { allowedClientIds: ['demo-id-1'], readOnlyClientIds: [] } };
  if (url === '/cps/credentials/test') return { data: { valid: true, statusCode: 200, message: 'Demo mode — connected' } };
  ```

- [ ] **4.4** End-to-end test with real CPS server:
  - Create a new non-secure project → verify it appears in App Detail CPS Config tab
  - Edit a property → verify value changes in subsequent read
  - Delete a project key → verify it is gone
  - Test credential → verify valid/invalid responses
  - Upload a binary → verify it appears in the binaries list
  - Add a clientId to auth → verify via GET /auth

---

## 11. Files to Create / Modify

### New Files

| File | Type | Description |
|---|---|---|
| `frontend/src/pages/CpsManagerPage.jsx` | New page | Main CRUD + Auth interface for CPS properties |
| `frontend/src/components/CpsCreateModal.jsx` | New component | Create new project entry (POST) |
| `frontend/src/components/CpsDeleteProjectModal.jsx` | New component | Delete entire project confirmation |
| `frontend/src/components/CpsBinaryUploadPanel.jsx` | New component | Upload binary files to CPS |
| `frontend/src/components/CpsAuthPanel.jsx` | New component | View + manage allowedClientIds/readOnlyClientIds |
| `frontend/src/components/CpsCredTestButton.jsx` | New component | Test CPS credential validity |
| `frontend/src/components/CpsImportModal.jsx` | New component | Bulk import CSV/JSON with preview |

### Modified Files

| File | Changes |
|---|---|
| `backend/src/routes/cps.js` | Add 7 new routes: `/write`, `/project` (DELETE), `/auth` (GET), `/auth` (POST), `/credentials/test`, `/binary` (POST) |
| `frontend/src/App.jsx` | Add `/cps-manager` route |
| `frontend/src/components/Sidebar.jsx` | Add CPS Manager nav item with `Database` icon |
| `frontend/src/components/CpsSettingsModal.jsx` | Add Test button + ✓/✗ badge per credential |
| `frontend/src/services/api.js` | Add demo mode mock handlers for 4 new endpoints |

### No Changes Required

| File | Reason |
|---|---|
| `backend/src/server.js` | New routes inside existing `/api/cps` prefix — no re-registration needed |
| `frontend/src/context/CpsCredentialStoreContext.jsx` | Already has `getAllCredentials()` for strategy-2 credential resolution |
| `frontend/src/utils/cpsHelpers.js` | `extractCpsConfig()` already extracts CPS connection details from ARM props |
| `frontend/src/utils/filterUtils.js` | BG/Env filter utilities work unchanged |
| `frontend/src/components/Select.jsx` | Dropdowns unchanged |

---

## 12. Out of Scope

| Feature | Reason |
|---|---|
| **Individual property key deletion** | CPS API only supports deleting the entire project entry (DELETE ?keys=projectName) |
| **Property history / rollback** | CPS API does not expose a history endpoint |
| **Cross-environment copy** | Use CPS Compare page (read) + CPS Manager page (write) together |
| **Scheduled property updates** | Not a CPS capability |
| **Real-time collaboration** | No WebSocket scope |
| **Auth removal (removing a clientId)** | `/auth/add` only adds; full replace via `/auth` is risky — implement separately if needed |

---

## Summary

### What the Postman Collection Confirmed

The Postman collection provided the **exact API contracts** that correct several initial assumptions:

1. **POST/PUT body format**: `{ "properties": [{ "environment", "key", "properties": { k:v } }] }` — NOT `responses`
2. **DELETE scope**: Deletes the entire project entry, not individual keys
3. **Binary uploads**: `Content-Type: application/octet-stream` with `key` + `environment` as **request headers**
4. **Auth management**: Separate `/auth` and `/auth/add` endpoints for `allowedClientIds` + `readOnlyClientIds`
5. **4 CPS servers**: CH1 prod/uat and CH2 prod/uat at different base URLs

### New Routes Added to Backend

| Route | Method | Purpose |
|---|---|---|
| `/api/cps/write` | POST | Create (POST) or Update (PUT) a project entry |
| `/api/cps/project` | DELETE | Delete an entire project entry |
| `/api/cps/auth` | GET | Fetch allowedClientIds for a project |
| `/api/cps/auth` | POST | Update allowedClientIds (replace or add) |
| `/api/cps/credentials/test` | POST | Test credential validity |
| `/api/cps/binary` | POST | Upload binary file to CPS |

### Estimated Effort

| Phase | Days | Risk |
|---|---|---|
| Phase 1: Backend routes | 2 days | Low — proven pattern from existing `/fetch` |
| Phase 2: New components | 2 days | Low — follows existing modal patterns |
| Phase 3: New page | 2 days | Medium — inline editing state management |
| Phase 4: Integration | 1 day | Low — wiring existing pieces |
| **Total** | **~7 days** | **Low-Medium** |

---

*Reference: [MuleSoft Anypoint Platform Documentation](https://docs.mulesoft.com/general/)*  
*CPS API verified from: `CPS.postman_collection.json` — PROD1.0, UAT1.0, PROD2.0, UAT2.0 environments*
