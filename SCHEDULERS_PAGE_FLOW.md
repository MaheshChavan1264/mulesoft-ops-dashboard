# Schedulers Page — Flow Diagram

Covers `frontend/src/features/schedulers/SchedulersPage.jsx`, its backend
endpoint `GET /applications/schedulers/:orgId` (`backend/src/routes/applications.js`),
and its interplay with the per-app Infrastructure tab
(`frontend/src/features/applications/tabs/InfrastructureTab.jsx`).

```
┌─────────────────────────────┐
│   SchedulersPage mounts     │
└──────────────┬──────────────┘
               ▼
     Load Business Groups
     (cache hit? → instant | miss → fetch)
               ▼
     Pick selected BG (saved or "All")
               ▼
   Compute env scope (envIdsFilter):
   this page's env dropdown  OR
   global env-visibility filter
               ▼
┌──────────────────────────────────────┐
│   loadSchedulers(bgId, envIds)       │
└──────────────┬────────────────────────┘
               ▼
      Check frontend cache
      (CK.allSchedulers — keyed by bg+env)
       ┌───────┴────────┐
       ▼                ▼
   Fresh hit         Miss / Stale
   → show instantly  → fetch now (spinner if miss)
       │                │
       │                ▼
       │     GET /applications/schedulers/:orgId?envIds=...
       │     (one call per BG, max 4 concurrent)
       │                │
       │                ▼
       │     Backend: filter apps to requested envs →
       │     fetch CH1 "/schedules" or CH2 "/schedulers"
       │     per app (max 8 concurrent) → normalize rows
       │                │
       │                ▼
       │     Merge + dedupe + cache {schedulers, environments}
       │                │
       └───────┬────────┘
               ▼
   setSchedulers(rows) + setEnvironments(envs)
               ▼
┌──────────────────────────────────────┐
│   Apply filters (search/env/status/   │
│   type) → paginate → render rows      │
│   (cron placeholders auto-shown as    │
│   resolved if cached from a prior     │
│   "Resolve CPS Crons" / Infra visit)  │
└──────────────┬────────────────────────┘
               ▼
      User sees Schedulers table
               │
   ┌─────┬─────┼──────┬───────────┬──────────────┐
   ▼     ▼     ▼      ▼           ▼              ▼
Click   Run   Toggle  Bulk        "Resolve CPS   "Resolve
app     Now  Enable/  select →    Crons" button  from CPS →"
name   (confirm) Disable  Run/Enable/  (global,       link
   │     │     │      Disable      scoped to       (per-row)
   ▼     │     │      selected      filtered rows)      │
Open     │     │      │                 │                ▼
app        │     │      │                 ▼         Opens app's
detail     │     │      │          Fetch CPS props   Infrastructure
page       │     │      │          per affected app  tab directly
(Overview) │     │      │          → cache resolved
           ▼     ▼      ▼            values → rows
     Call backend endpoint(s)         re-render
     (POST run / PUT enable,
      per-row CH1 or CH2 branch)
           │
           ▼
   Update row(s) locally (optimistic)
   + bust caches (this page + per-app
     Infrastructure-tab cache)
           ▼
   Show success/error toast
```

## Key points

- **Env scoping happens server-side.** The backend only fans out requests
  for apps in the requested environments (`envIds` query param), not just
  filtering client-side after fetching everything — fewer Anypoint calls,
  not just a smaller response.
- **Cache keys include the env scope** (`CK.allSchedulers(bgId, bgIds, envIds)`
  in `services/cacheKeys.js`), so switching envs triggers a real (but
  cache-aware) re-fetch instead of silently reusing a differently-scoped
  cached list.
- **CPS cron placeholder resolution** (`${cps.property}` values) happens two
  ways:
  1. Per-app, via the Infrastructure tab's "Get Cron Expressions" button.
  2. In bulk, via this page's "Resolve CPS Crons" button
     (`utils/resolveSchedulerCpsCrons.js`), scoped to the currently filtered
     rows.
  Both write into a shared cross-page cache
  (`services/cpsCronResolutionCache.js`) so either path makes rows show real
  values on both pages without re-fetching.
- **Mixed CH1+CH2 selections in bulk actions are handled per-row** — each
  row's own `deploymentType` decides whether `runCloudhub1SchedulerNow` or
  `runCloudhub2SchedulerNow` (and the CH1/CH2 toggle equivalents) is called,
  so a single bulk Run/Enable/Disable action across a mixed selection works
  correctly.
- **Toggle/trigger actions invalidate both caches** that could show the
  scheduler's enabled/disabled state — this page's `CK.PREFIX.allSchedulers`
  and the per-app Infrastructure tab's `CK.schedulers(bgId, envId, appId)` —
  so neither page can show stale state after an action succeeds on the
  other.
