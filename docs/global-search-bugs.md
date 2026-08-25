# Global Search — Bug Analysis Report

**Feature:** Global Search (`UserSearchPage.jsx` + `backend/src/routes/cps.js`)  
**Date:** 2026-08-25  
**Severity levels:** 🔴 Critical · 🟠 Significant · 🟡 Minor

---

## Summary

| # | Severity | File | Description |
|---|----------|------|-------------|
| 1 | 🔴 Critical | `UserSearchPage.jsx` | Cache key mismatch — summary cache never hits |
| 2 | 🔴 Critical | `UserSearchPage.jsx` | `extractCpsConfig` misses `runtimeProperties` for CH2 apps |
| 3 | 🔴 Critical | `UserSearchPage.jsx` | `envName` always empty for CH2 apps — results show `chEnv: '—'` |
| 4 | 🔴 Critical | `UserSearchPage.jsx` | `postCreds` stores all credentials under the wrong BG org ID |
| 5 | 🔴 Critical | `cps.js` | `processApp` has no credential retry — wrong-credential apps silently skipped |
| 6 | 🔴 Critical | `cps.js` | `detectEnvType` doesn't match `STAGING` — defaults to `'prod'` credentials |
| 7 | 🟠 Significant | `UserSearchPage.jsx` | Silent env-level fetch failures — partial results with no warning |
| 8 | 🟠 Significant | `cps.js` | `processApp` catch-all swallows all errors silently |
| 9 | 🟠 Significant | `cps.js` | `scanned` counter in response is double-counted |
| 10 | 🟡 Minor | `UserSearchPage.jsx` | Progress bar is always 100% — doesn't reflect real progress |
| 11 | 🟡 Minor | `UserSearchPage.jsx` | "Select All" only selects filtered list, counter shows total |

---

## 🔴 Critical Bugs

---

### Bug 1 — Cache key mismatch: summary cache NEVER hits

**File:** `frontend/src/pages/UserSearchPage.jsx` — `fetchAppsForEnv`

**Root cause:**  
`UserSearchPage` attempts to read from the app summary cache using key `apps:__all__:${bgId}`, but `ApplicationsPage` writes its cache under key `apps:${bgId}:${bgIds.join(',')}`. These two formats never match.

```javascript
// UserSearchPage.jsx — line reads:
const cacheKey = `apps:__all__:${bgId}`;          // ← WRONG KEY FORMAT
const cachedSummary = getCached(cacheKey);

// ApplicationsPage.jsx — line writes:
const cacheKey = `apps:${bgId}:${bgIds.join(',')}`;  // ← DIFFERENT FORMAT
setCached(cacheKey, { apps: mergedApps, envs: mergedEnvs });
```

**Impact:**  
- `cachedSummary` is **always `null`** — the fast path is dead code.
- Every Global Search always performs a fresh CH2 list fetch for every selected environment, even when Applications page has already loaded and cached the data.
- Unnecessary API calls slow down every search.

**Fix:**  
Align the cache key in `UserSearchPage` to match what `ApplicationsPage` writes:
```javascript
// Use the same key ApplicationsPage stores
const cacheKey = `apps:${bgId}:${bgId}`;
```
Or better — export a shared `appsCacheKey(bgId)` helper from `apiCache.js` so both pages always use the same format.

---

### Bug 2 — `extractCpsConfig` misses `runtimeProperties` for CH2 apps

**File:** `frontend/src/pages/UserSearchPage.jsx` — `extractCpsConfig`

**Root cause:**  
The CH2 deployment detail API stores app properties in `target.deploymentSettings.runtimeProperties`, but `extractCpsConfig` never reads that field:

```javascript
function extractCpsConfig(app, orgId) {
  const ds = app.target?.deploymentSettings || {};
  const ps = (app.application?.configuration || {})['mule.agent.application.properties.service'] || {};
  const p = {
    ...(ps.properties || {}),
    // ❌ ds.runtimeProperties is never spread — this is where CH2 stores CPS props
    ...(ds.properties || {}),
    ...(ds.environmentVariables || ds.environmentVars || {}),
    ...(app.properties || {})
  };
  return {
    cpsBaseUrl: p['cps.configServerBaseUrl'] || p['config.server.base.url'] || '',
    cpsKey:     p['cps.projectName'] || p['cloudhub.api.name'] || app.name || '',
    // ...
  };
}
```

**Impact:**  
Many CH2 apps have `cps.configServerBaseUrl` and `cps.projectName` stored in `runtimeProperties`. These are extracted as empty strings, and the app is silently filtered out by:
```javascript
.filter(e => e.cpsBaseUrl && e.cpsKey)
```
Those apps are **never searched** — false negatives.

**Fix:**
```javascript
const p = {
  ...(ps.properties || {}),
  ...(ds.runtimeProperties || {}),     // ← ADD THIS LINE
  ...(ds.properties || {}),
  ...(ds.environmentVariables || ds.environmentVars || {}),
  ...(app.properties || {})
};
```

---

### Bug 3 — `envName` always empty for CH2 apps — results show `chEnv: '—'`

**File:** `frontend/src/pages/UserSearchPage.jsx` — `runSearch` + `extractCpsConfig`

**Root cause:**  
`extractCpsConfig` derives environment name from `app.environment?.name`. The CH2 deployment detail API response does **not** include an `environment` object — `app.environment` is `undefined`. The correct `sel.envName` is available in the outer scope but is never used as a fallback.

```javascript
// extractCpsConfig returns:
envName: app.environment?.name || '',   // ← always '' for CH2 detail responses

// runSearch calls it as:
.map(a => ({
  appName: a.name,
  appId: a.id || a.name,
  ...extractCpsConfig(a, sel.bgId),    // sel.envName available here but not passed
}))
```

**Impact:**  
Every CH2 match row in the results table displays `—` in the **"Cloudhub Environment"** column, making results hard to interpret.

**Fix:**
```javascript
.map(a => ({
  appName: a.name,
  appId: a.id || a.name,
  ...extractCpsConfig(a, sel.bgId),
  envName: a.environment?.name || sel.envName,   // ← fallback to sel.envName
}))
```

---

### Bug 4 — `postCreds` stores all credentials under the wrong BG org ID

**File:** `frontend/src/pages/UserSearchPage.jsx` — `postCreds`

**Root cause:**  
When registering CPS credentials with the backend, the code always uses `entries[0]?.bgOrgId` as the BG org ID in the credential key — regardless of which BG each CPS server URL actually belongs to:

```javascript
for (const [norm, { clientId, clientSecret }] of urlMap.entries()) {
  api.post('/cps/credentials', { credentials: {
    [norm + '::' + (entries[0]?.bgOrgId || '')]: { clientId, clientSecret },  // ← always BG[0]
    [norm]: { clientId, clientSecret },
  }}).catch(() => {});
}
```

**Impact:**  
If BG-A (`orgId-A`) and BG-B (`orgId-B`) use different CPS servers, both get stored under `cpsUrl-A::orgId-A` and `cpsUrl-B::orgId-A`. When the backend looks up credentials for apps in BG-B, it searches for `cpsUrl-B::orgId-B` — which doesn't exist. Those apps get no credentials and are silently skipped.

**Fix:**  
Track which BG org ID owns each CPS URL in the `urlMap`, then store them individually:
```javascript
// Build map: norm-url → { clientId, clientSecret, bgOrgId }
const urlMap = new Map();
for (const e of entries) {
  if (!e.cpsBaseUrl) continue;
  const norm = e.cpsBaseUrl.trim().replace(/\/+$/, '').replace(/\/api\/v2\/?$/, '');
  const bgKey = `${norm}::${e.bgOrgId}`;
  if (urlMap.has(bgKey)) continue;
  // ... resolve credential
  urlMap.set(bgKey, { norm, bgOrgId: e.bgOrgId, clientId, clientSecret });
}

for (const [bgKey, { norm, bgOrgId, clientId, clientSecret }] of urlMap.entries()) {
  api.post('/cps/credentials', { credentials: {
    [bgKey]: { clientId, clientSecret },   // ← correct BG-specific key
    [norm]:  { clientId, clientSecret },   // ← URL-only fallback
  }}).catch(() => {});
}
```

---

### Bug 5 — `processApp` has no credential retry — wrong-credential apps silently skipped

**File:** `backend/src/routes/cps.js` — `processApp` inside `POST /search-user`

**Root cause:**  
The `/fetch` route implements sophisticated multi-credential retry:
- HTTP 401 → try all other session credentials in parallel batches of 5
- HTTP 200 + "COULD NOT ACCESS" → per-group retry with remaining credentials

`processApp` does a **single attempt** with `getCredentials(...)` and returns `null` on any failure:

```javascript
async function processApp(appEntry) {
  const creds = getCredentials(req, cpsBaseUrl, bgOrgId, envType, chType);
  if (!creds) return null;   // no credentials at all

  try {
    const nsRes = await axios.get(nsUrl, {
      headers: { client_id: creds.clientId, client_secret: creds.clientSecret },
      timeout: 15000,
    });
    // ❌ No check for HTTP 401
    // ❌ No check for "COULD NOT ACCESS"
    // ❌ No retry with alternate credentials
    const nsFlat = flattenProps(nsRes.data);
    // ...
  } catch { return null; }   // ← timeout, 401, network error all silently swallowed
}
```

**Impact:**  
Any app where the primary credential is wrong but another credential in the session would succeed is **silently skipped**. The search never reports these misses to the user.

**Fix:**  
Replicate the retry pattern from `/fetch` inside `processApp`:
```javascript
// After primary fetch, check for 401 or "COULD NOT ACCESS"
if (nsRes.status === 401 || isCouldNotAccess(nsRes)) {
  const altEntries = Object.entries(req.session.cpsCreds || {})
    .filter(([k, v]) => k.startsWith(normaliseUrl(cpsBaseUrl)) && v?.clientId !== creds.clientId);
  for (const [, altCred] of altEntries) {
    const retry = await axios.get(nsUrl, {
      headers: { client_id: altCred.clientId, client_secret: altCred.clientSecret },
      timeout: 8000, validateStatus: () => true,
    });
    if (retry.status !== 401 && !isCouldNotAccess(retry)) {
      nsRes = retry;
      break;
    }
  }
}
```

---

### Bug 6 — `detectEnvType` doesn't match `STAGING` — defaults to `'prod'` credentials

**File:** `backend/src/routes/cps.js` — `detectEnvType`

**Root cause:**  
The regex uses `\bstage\b` (word-boundary anchored), which does **not** match `staging` because there is no word boundary between `e` and `i` in `staging`:

```javascript
function detectEnvType(baseUrl = '', environment = '', envName = '') {
  const s = `${baseUrl} ${environment} ${envName}`.toLowerCase();
  if (/\b(prod|pd)\b/.test(s)) return 'prod';
  if (/\b(uat|ut|stage|stg|uap|sandbox)\b/.test(s)) return 'uat';
  //                   ^^^^^^ matches "stage" exactly but NOT "staging"
  return 'prod';   // ← STAGING falls through to here
}
```

**Verification:**
```
/\bstage\b/.test('ei-fi-financials-staging')  // → false
/\bstg\b/.test('ei-fi-financials-stg')         // → true  (works for STG)
```

**Impact:**  
Any environment named `*STAGING*` (e.g. `EI-FI-FINANCIALS-STAGING`, `EI-STAGING`) is classified as `'prod'`. This causes:
1. Credential lookup falls back to `ch1_prod` / `ch2_prod` session keys — production credentials are used for staging CPS servers.
2. The staging CPS server rejects with 401 (prod creds invalid for staging).
3. The app is silently skipped (`processApp` returns `null`).

**Fix:**
```javascript
if (/\b(uat|ut|stag(e|ing)?|stg|uap|sandbox)\b/i.test(s)) return 'uat';
//             ^^^^^^^^^^^^^^^^^ matches stage, stage, staging
```

---

## 🟠 Significant Bugs

---

### Bug 7 — Silent env-level fetch failures — partial results with no warning

**File:** `frontend/src/pages/UserSearchPage.jsx` — `runSearch`

**Root cause:**  
Env-level failures are swallowed in `Promise.allSettled`:
```javascript
const allEntries = envResults
  .flatMap(r => r.status === 'fulfilled' ? r.value : [])  // ← rejected silently dropped
```

**Impact:**  
If `fetchAppsForEnv` throws for 3 of 10 selected environments (network error, 403, etc.), the search proceeds with only 7 environments and returns results without warning. The user believes the search was complete.

**Fix:**  
Count and surface the failures:
```javascript
const failed = envResults.filter(r => r.status === 'rejected').length;
if (failed > 0) setError(`Warning: ${failed} environment(s) could not be loaded and were skipped.`);
```

---

### Bug 8 — `processApp` catch-all swallows all errors

**File:** `backend/src/routes/cps.js` — `processApp`

**Root cause:**
```javascript
try {
  const nsRes = await axios.get(nsUrl, { timeout: 15000, ... });
  // ...
} catch { return null; }   // ← all errors (timeout, 401, malformed) look identical
```

**Impact:**  
There is no way to distinguish:
- App has CPS config but CPS server timed out (transient — should retry)
- App has CPS config but credentials were wrong (permanent — needs new creds)
- App has no matching props (correct `null`)

The backend log only sees `skipped++` for all three cases.

**Fix:**  
At minimum, log the error type before returning `null`:
```javascript
} catch (err) {
  const code = err.code || (err.response?.status ? `HTTP ${err.response.status}` : 'ERR');
  console.warn(`[search-user] processApp failed for "${appName}" [${code}]: ${err.message}`);
  return null;
}
```

---

### Bug 9 — `scanned` counter is double-counted in backend response

**File:** `backend/src/routes/cps.js` — fan-out loop in `POST /search-user`

**Root cause:**  
```javascript
} else {
  scanned++;                  // incremented for apps WITH matches
  results.push(outcome.value);
}
// ...
res.json({ results, scanned: scanned + results.length, skipped });
//                  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//  scanned == results.length (both count matched apps)
//  → response sends 2× the matched count, not the total scanned count
```

**Impact:**  
The logged `scanned` metric is meaningless — it always equals `2 × matched_app_count`.

**Fix:**  
Track scanned separately:
```javascript
let scanned = 0;   // total successfully queried (with or without matches)
let matched = 0;   // apps that had at least one match

// In the loop:
if (outcome.value === null) {
  skipped++;
} else {
  matched++;
  results.push(outcome.value);
}
scanned++;   // increment for every non-rejected outcome

res.json({ results, scanned, matched, skipped });
```

---

## 🟡 Minor Bugs

---

### Bug 10 — Progress bar always shows 100% (fake animation)

**File:** `frontend/src/pages/UserSearchPage.jsx` — loading UI

**Root cause:**
```jsx
<div className="h-full bg-cyan-600 rounded-full animate-pulse w-full" />
{/* ↑ w-full is hardcoded — never changes regardless of progress */}
```

**Impact:**  
The loading bar always shows as completely full with a pulse animation. The user cannot gauge how far along the scan is, even though `progress.envsDone` and `progress.envsTotal` are tracked and available.

**Fix:**
```jsx
<div
  className="h-full bg-cyan-600 rounded-full transition-all duration-300"
  style={{
    width: progress.envsTotal > 0
      ? `${Math.round((progress.envsDone / progress.envsTotal) * 100)}%`
      : '0%'
  }}
/>
```

---

### Bug 11 — "Select All" selects only filtered envs, but count badge shows total

**File:** `frontend/src/pages/UserSearchPage.jsx` — `BgEnvSelector`

**Root cause:**
```javascript
const selectAll = () => setSelections(new Set(filtered.map(e => `${e.bgId}:${e.envId}`)));
//                                             ^^^^^^^^ only the search-filtered subset

// Counter always shows against full list:
<span className="text-[10px] text-slate-500">{selections.size}/{allEnvs.length}</span>
```

**Impact:**  
User types `"staging"` in the BG/Env filter, clicks "All" (selects 3 staging envs), then clears the search. The counter now shows `3/100` and it is not obvious that 97 envs are unselected. The "All" button label is also misleading — it says "All" but means "all currently visible".

**Fix:**  
Either rename the button to "Select visible" when a search is active, or implement a clear visual distinction:
```jsx
<button onClick={selectAll} className="text-[10px] text-cyan-400 hover:text-cyan-300 font-medium">
  {searchLo ? 'Select visible' : 'All'}
</button>
```

---

## Files Affected

| File | Bugs |
|------|------|
| `frontend/src/pages/UserSearchPage.jsx` | #1, #2, #3, #4, #7, #10, #11 |
| `backend/src/routes/cps.js` | #5, #6, #8, #9 |

## Recommended Fix Priority

1. **Bug 6** (`detectEnvType` STAGING regex) — one-line fix, blocks all STAGING searches
2. **Bug 2** (`runtimeProperties` missing) — one-line fix, unblocks all CH2 apps
3. **Bug 3** (`envName` fallback) — one-line fix, fixes all CH2 result rows
4. **Bug 5** (`processApp` no retry) — moderate effort, fixes credential fallback
5. **Bug 4** (`postCreds` wrong BG key) — moderate effort, fixes multi-BG credential storage
6. **Bug 1** (cache key mismatch) — minor effort, performance improvement
7. **Bugs 7–9** — logging/UX improvements
8. **Bugs 10–11** — polish
