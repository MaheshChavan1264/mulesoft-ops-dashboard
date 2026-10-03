# Frontend Architecture Review — MuleSoft Dashboard

**Scope:** `frontend/src` only (React 18 + React Router 7 + Tailwind 3 + Vite 8, JavaScript, 61 files).
No TypeScript, no PropTypes, no `hooks/` directory, no Redux/Zustand/React Query.

---

## 1. Duplicate Code Analysis — Top Findings

| # | Files | Function/Component | Explanation | Impact | Suggested Refactor | Priority |
|---|---|---|---|---|---|---|
| 1 | `utils/exportCps.js:55-66` vs `utils/cpsHelpers.js:66-114` | `normalisePropsArray` vs `flattenCpsResponse` | Two parallel CPS-response-shape normalizers for the same ambiguous payload shapes; `cpsHelpers.js`'s own docstring calls out `exportCps.js` as a file it was meant to centralize | Backend contract changes must be fixed twice | Make `exportCps.js` consume `flattenCpsResponse` | **High** |
| 2 | `components/CpsRawJsonModal.jsx:8-123` vs `components/PostmanJsonViewer.jsx:14-86` | `LIGHT_PM`/`DARK_PM`, `tokenizeJSON`, `tokenColor` | Byte-identical regex tokenizer + color theme duplicated (comment literally says "mirrors CpsRawJsonModal.jsx") | Any tokenizer bugfix needs 2 edits | Extract `utils/postmanJsonTheme.js` | **High** |
| 3 | `components/PingTestPanel.jsx:329` | local `latencyColor` redefinition | Already imports `latencyColor` from `utils/appUtils` elsewhere (`AttemptLog.jsx`, `PingResultCard.jsx`) but redefines its own with **different thresholds** | Same latency value shows different colors on different pages — visible UX bug | Delete local def, import shared util | **High (bug)** |
| 4 | `components/PingTestPanel.jsx:83` | `flattenCpsProps` | Imports `flattenCpsResponse` from `utils/cpsHelpers` (line 6) but defines a second, slightly different local flattener instead of using it | Logic drift risk between CPS flattening paths | Delete local fn, use imported one | **High** |
| 5 | `context/CredentialStoreContext.jsx` vs `context/CpsCredentialStoreContext.jsx` | `loadFromCsv`, `getSecret`, `hasCredential`, `resolveFromCandidates` | ~45 lines of credential-map state logic duplicated verbatim between two confusingly-named contexts | Security-sensitive logic (secret resolution) must be bugfixed twice | Extract shared `useCredentialMapStore()` hook, compose in both | **Critical** |
| 6 | `pages/CpsManagerPage.jsx:606-639` vs `pages/GlobalCpsManagerPage.jsx:292-319` vs `CpsManagerPage.jsx:1833-1860` (`SecureGroupEditor`) | `updateProperty`, `addProperty`, `markDeleted`, `discardChanges` | Byte-identical pending-changes reducer implemented 3×; `GlobalCpsManagerPage` already drifted (no undo/draft autosave) | Property-edit bugs fixed inconsistently across CPS pages | Extract `hooks/usePendingPropertyChanges.js` | **High** |
| 7 | `ApplicationDetailPage.jsx`, `CpsComparisonPage.jsx:16-31`, `ApplicationsPage.jsx` (`BulkPingModal`), `GlobalSearchPage.jsx:81-148` | CPS config extraction (`configServerBaseUrl`, `projectName`, `prefix`, `clientId`) from ARM props | Reimplemented 4× with different fallback-key orderings; only `CpsManagerPage` correctly imports the canonical `utils/cpsHelpers.extractCpsConfig` | **Functional correctness bug** — same app resolves CPS config differently per page | Delete 4 inline duplicates, use `cpsHelpers.extractCpsConfig` everywhere | **Critical** |
| 8 | 7 CPS modal files (`BgFilterModal`, `CpsCreateModal`, `CpsDeleteProjectModal`, `CpsExportModal`, `CpsImportModal`, `EnvFilterModal`, `CpsSettingsModal`) | modal backdrop/card shell | Inconsistent opacity (`black/60` vs `black/70`) and radius (`rounded-2xl` vs `rounded-3xl`) from copy-paste drift | Any design tweak needs 7 edits; visible inconsistency already shipped | Extract `components/Modal.jsx` | **High** |
| 9 | `CopyBtn.jsx`, `CpsRequestResponsePanel.jsx` (`CopyCodeBtn`), `PostmanJsonViewer.jsx`, plus local re-implementations in `CpsComparisonPage.jsx:39-47`, `CpsManagerPage.jsx:31-41`, `GlobalSearchPage.jsx:13-21` | clipboard-copy logic | `writeText` + timed `copied` flag reimplemented 6× despite a shared `components/CopyBtn.jsx` existing and being correctly used in `ApplicationDetailPage`/`ApplicationsPage` | Inconsistent hover/fade UX; missing `.catch()` in some copies | Delete local defs, reuse `CopyBtn`, extract `useCopyToClipboard` hook | **Medium** |
| 10 | `CpsAuthPanel.jsx`, `CpsBinaryUploadPanel.jsx`, `CpsCreateModal.jsx`, `CpsDeleteProjectModal.jsx` | CPS base-URL cleaning regex `baseUrl.replace(/\/+$/,'').replace(/\/api\/v2\/?$/,'')` + fallback-request/onResult error reporting | Identical URL-cleaning + try/catch/onResult boilerplate copy-pasted 5× | High maintenance burden on any backend contract change | Extract `cleanCpsBaseUrl()` util + `useCpsOperation()` hook | **High** |
| 11 | `ApplicationsPage.jsx` (`ConfirmModal`, `BulkConfirmModal`), `ApplicationDetailPage.jsx` (`AppConfirmModal`, `SchedulerConfirmModal`, `ContractConfirmModal`) | confirm-action dialogs | 5 near-identical modal shells (~500 LOC total) for one generic "confirm dangerous action" pattern | Bloats both files, inconsistent confirm UX | `components/ConfirmActionModal.jsx` | **High** |
| 12 | 6+ pages (`ApiManagerPage`, `ApplicationsPage`, `CpsManagerPage`, `CpsComparisonPage`, `ExchangePage`, `GlobalSearchPage`) | BG/env filter state + "dummy version counter to force recompute" pattern | Each page independently reads/writes `localStorage`, listens to `window` `envFilterChanged`/`bgFilterChanged` events, and bumps an unused counter to force re-render | Systemic anti-pattern repeated 6× instead of one Context | New `BgEnvFilterContext` | **High** |
| 13 | `CpsAuthPanel.jsx:209-269` vs `271-332` | "Allowed ClientIds" vs "Read-Only ClientIds" lists | ~95% identical JSX within the *same file* | Internal duplication inflates file, fix drift risk | Extract `<ClientIdList accent/>` used twice | Medium |
| 14 | `ApplicationsPage.jsx:1152-1180` vs `PingTestPage.jsx:882-909` | CSV upload + app-name matching | Independent `FileReader` + header-detection + fuzzy-match implementations, already diverged (one supports `csvMatchMode`, other doesn't) | Two parsers to maintain | `hooks/useCsvAppMatcher()` | Medium |
| 15 | `services/mockCpsData.json` (**content is literally `{}`**) vs orphaned `utils/mockCpsData.js` (populated but never imported) | demo-mode CPS mocks | Same filename stem, two directories, one broken one dead | Demo mode CPS features silently return `undefined` | Delete orphan, repopulate the JSON actually wired into `api.js` | **High (bug)** |
| 16 | `utils/exportCps.js:179-186` and `189-195` | fallback credential-posting block | Identical ~8-line block copy-pasted twice in the *same function* | Easy to patch one copy and forget the other | Extract `postAllCredentialsFallback()` | Medium |
| 17 | `ApiManagerPage.jsx:ContractCard`, `ApplicationDetailPage.jsx` contracts tab | contract-status → Tailwind class mapping | Independently written twice with different exact classes | Visual inconsistency | Shared `utils/accentColors.js` | Medium |
| 18 | `ApplicationsPage.jsx`, `CpsComparisonPage.jsx`, `GlobalSearchPage.jsx` | CSV/XLSX export (`exportAppsToXlsx`, `exportCsv`, `exportGroupedXlsx`) | Column-autosize + CSV-escaping reimplemented per page instead of using the existing `utils/appUtils.downloadCsv` (correctly used only by `CpsManagerPage`/`PingTestPage`) | 3 parallel export implementations | Standardize on `downloadCsv` + new `utils/xlsxExport.js` | Medium |
| 19 | ~30+ call sites across `ApplicationDetailPage`, `ApplicationsPage`, `CpsManagerPage`, `CpsComparisonPage`, `GlobalSearchPage` | `e.response?.data?.error \|\| e.response?.data?.message \|\| e.message` | Identical error-extraction one-liner repeated 30+ times | Changing error-message convention = 30+ edits | `services/http.js:getErrorMessage(e)` | Medium |
| 20 | `CpsAuthPanel`, `CpsBinaryUploadPanel`, `CpsCreateModal`, `CpsImportModal`, `CpsDeleteProjectModal` | hand-rolled red error banner markup | A dedicated `components/ErrorBanner.jsx` exists in the same folder and is **not used** by any of these 6 files | Dead reusable component, 6× markup duplication instead | Replace inline markup with `<ErrorBanner/>` | **High** |

---

## 2. Component Reusability Review

| Reusable Component | Current Files | Suggested Props | Benefits |
|---|---|---|---|
| **`<Modal>`** | 7 modal files (see Dup #8) + `ConfirmActionModal` candidates | `size, title, icon, onClose, footer, children` | 1 place for backdrop/radius/dark-mode consistency |
| **`<Button>`** | every modal footer / page action button | `variant(primary/secondary/danger), size, loading, icon` | Kills ~15 repeated className strings |
| **`<Card>`** | 15+ sites across all pages sharing the ~190-char card wrapper string | `padding, className` | One edit point for the dark-mode shadow/border system |
| **`<ConfirmActionModal>`** | `ApplicationsPage` (`ConfirmModal`,`BulkConfirmModal`), `ApplicationDetailPage` (`AppConfirmModal`,`SchedulerConfirmModal`,`ContractConfirmModal`) | `icon, title, message, confirmLabel, dangerous, loading, onConfirm, onCancel` | Removes ~500 LOC of near-duplicate dialogs |
| **`<CheckboxTile>`** | `BgFilterModal`, `EnvFilterModal` (3 sub-components), `CpsExportModal`'s `BgEnvSelector` | `checked, indeterminate, color, onClick` | Also fixes the accessibility gap (keyboard support in one place) |
| **`<FileDropZone>`** | `CpsBinaryUploadPanel.jsx`, `CpsImportModal.jsx` | `onFile, accept, hint` | Removes duplicate drag/drop markup |
| **`<PageHeader>`** | all 7 pages' icon-chip+title+subtitle header | `icon, title, subtitle, gradient, actions` | Already drifted (`ApplicationsPage` missing the icon chip) — stops further drift |
| **`<SkeletonTable>`/`<SkeletonRow>`** | `ApplicationsPage`, `ApiManagerPage`, `ExchangePage` loading rows | `rows, cols` | Removes 3 ad hoc skeleton implementations |
| **`<ErrorBanner>` (reuse existing)** | Already built in `components/ErrorBanner.jsx`, unused by 6 CPS components | n/a | Zero new code — just wire it up |
| **`<ClientIdList>`** | `CpsAuthPanel.jsx` (used twice internally) | `title, accent, ids, onAdd, onRemove, search, setSearch` | Halves `CpsAuthPanel`'s size |
| **`<TableHeader>`** | 4 pages with 4 different header stylings (opacity 95/80/40/none, font sizes 11px/10px/default) | `sticky, className` | One canonical table-header style |

---

## 3. Custom Hook Opportunities

**No `hooks/` directory exists at all** — this is the single biggest structural gap. Concrete extractions, with sketches:

```js
// hooks/useLocalStorageState.js — collapses 4 independent implementations
// (ThemeContext.jsx, CpsCredentialStoreContext.jsx, demoMode.js, filterUtils.js)
function useLocalStorageState(key, defaultValue, { serialize = JSON.stringify, deserialize = JSON.parse } = {}) {
  const [value, setValue] = useState(() => {
    try { const raw = localStorage.getItem(key); return raw != null ? deserialize(raw) : defaultValue; }
    catch { return defaultValue; }
  });
  useEffect(() => { try { localStorage.setItem(key, serialize(value)); } catch {} }, [key, value]);
  return [value, setValue];
}
```

```js
// hooks/useAsyncAction.js — collapses the loading/error/success triad
// duplicated in CpsAuthPanel, CpsBinaryUploadPanel, CpsCreateModal, CpsDeleteProjectModal, CpsImportModal, CpsSettingsModal
function useAsyncAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const run = useCallback(async (fn) => {
    setLoading(true); setError('');
    try { return await fn(); }
    catch (e) { setError(e.response?.data?.error || e.message || 'Failed'); throw e; }
    finally { setLoading(false); }
  }, []);
  return { loading, error, setError, run };
}
```

```js
// hooks/useCredentialMapStore.js — resolves Critical finding #5 (context duplication)
function useCredentialMapStore() {
  const [credentialMap, setCredentialMap] = useState(new Map());
  const loadFromCsv = useCallback((text) => { const m = parseCsvToCredentialMap(text); setCredentialMap(m); return m.size; }, []);
  const getSecret = useCallback((id) => credentialMap.get(id), [credentialMap]);
  // ... hasCredential, resolveFromCandidates, getAllCredentials
  return { credentialMap, loadedCount: credentialMap.size, loadFromCsv, getSecret, /* ... */ };
}
```

```js
// hooks/useCachedQuery.js — wraps the already-solid services/apiCache.js SWR engine
// (currently 100% opt-in / undocumented at call sites)
function useCachedQuery(key, fetchFn, { staleMs } = {}) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    getOrFetch(key, fetchFn, { staleMs }).then(data => alive && setState({ data, loading: false, error: null }))
      .catch(error => alive && setState(s => ({ ...s, loading: false, error })));
    keepFresh(key, fetchFn);
    return () => { alive = false; stopKeepingFresh(key); };
  }, [key]);
  return state;
}
```

```js
// hooks/usePendingPropertyChanges.js — resolves Dup #6 (3x duplicated reducer)
function usePendingPropertyChanges(baseProps) {
  const [added, setAdded] = useState({});
  const [modified, setModified] = useState({});
  const [deleted, setDeleted] = useState(new Set());
  // updateProperty, addProperty, markDeleted, discardChanges, mergedProps (useMemo)
}
```

Also recommended: `useCopyToClipboard()`, `useBgEnvFilter()` (replaces the window-event + localStorage pattern in 6 pages), `useCsvAppMatcher()`, `useDebounce()` (for the many search inputs filtering large lists on every keystroke, e.g. `GlobalSearchPage`, `EnvFilterModal`).

---

## 4. Tailwind CSS Review

- **`index.css` is ~1600 lines of auto-generated `dark:` override CSS** targeting raw class names (`bg-white`, `bg-gray-50`, etc.) because many components use hardcoded light-theme classes instead of `dark:` variants. This is a parallel, competing dark-mode mechanism alongside the native `dark:` variants used extensively elsewhere — a genuine architectural red flag and the single largest piece of generated tech debt in the codebase. **Critical.**
- **Repeated ~190-char "card" className string** duplicated 15+ times verbatim across `ApiManagerPage`, `ExchangePage`, `CpsManagerPage`, `ApplicationsPage`, `CpsComparisonPage`, `PingTestPage`:
  ```
  bg-white dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-800/90 border border-gray-200
  dark:border-white/[0.07] rounded-2xl shadow-sm dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5)] overflow-hidden
  ```
  → Extract `components/Card.jsx` or `@layer components { .card {...} }`.
- **5-6 independent, slightly inconsistent "accent color" lookup tables**: `ApplicationDetailPage.jsx`'s `CARD_ACCENTS`/`STAT_TILE_ACCENTS`/`HERO_ACTION_ACCENTS`/`TAG_COLORS`/`NS_DOT_COLORS` (lines 176-277), `CpsComparisonPage.jsx`'s `STATUS_ROW`/`STATUS_BADGE`, `ApiManagerPage.jsx`'s `ENV_TAG_COLOR` duplicated near-identically in `ApplicationsPage.jsx` and `CpsComparisonPage.jsx` — despite `tailwind.config.js` already defining a clean `sf/sfteal/sfgreen/sfpurple/sforange/sfred` palette, no shared JS module maps semantic states → these colors consistently.
- **Modal backdrop opacity/radius drift**: `bg-black/60` vs `bg-black/70`, `rounded-2xl` vs `rounded-3xl` (see Dup #8).
- **4 different table-header stylings** across pages (opacity 95%/80%/none/40%, font-size 11px/10px/default) — no shared `<TableHeader>`.
- **Hardcoded raw hex/rgba bypassing the theme**: `CpsRawJsonModal.jsx`/`PostmanJsonViewer.jsx` inline `style={}` with raw hex (`#ff6c37`, `#1e1e1e`) and `rgba()` highlight colors instead of CSS variables; `AttemptLog.jsx`/`PingResultCard.jsx` both use `bg-[#0B0F17]` instead of a theme token like `bg-slate-950`; `LoginPage.jsx:73` inline `radial-gradient(circle, #0176d3 ...)` duplicating the `sf-600` theme color as a raw hex.
- **No `@layer components` usage at all** in `index.css` despite Tailwind supporting it — all composition is done ad hoc per file.

**Recommendations:** (1) delete the generated override block once components migrate to proper `dark:` variants; (2) add `@layer components` definitions for `.card`, `.btn-*`, `.modal-*`; (3) centralize accent-color mapping in one `utils/accentColors.js` keyed off the existing `sf*` palette; (4) replace raw hex in JSON viewers/`bg-[#...]` with theme tokens or CSS variables.

---

## 5. Architecture Review

**Good practices:**
- Clean `ProtectedRoute` auth-guard pattern (`App.jsx:21-31`).
- Well-engineered SWR cache (`services/apiCache.js`): TTL tiers, inflight dedup, idle-time keep-fresh sweep, dev diagnostics.
- `utils/appUtils.js` is well-factored — short, single-purpose, pure functions (`latencyColor`, `generateTxId`, `downloadCsv`, `buildPingUrl`).
- Named, semantic Tailwind palette in `tailwind.config.js` (sf/sfteal/sfgreen/sfpurple/sforange/sfred).
- `ApplicationsPage.jsx`'s `useMemo` usage for `filtered`/`displayFiltered`/`statusSummary` is a good example other pages should follow.

**Architecture smells / technical debt:**
- **God components**: `ApplicationDetailPage.jsx` (2939 lines, 40+ `useState` calls, 8 tabs inlined via IIFEs), `CpsManagerPage.jsx` (2200+ lines, exports 3 large components from one file), `ApplicationsPage.jsx` (2229 lines, 4 modals + page in one file), `GlobalSearchPage.jsx` (1785 lines).
- **No lazy-loading/code-splitting**: all 10 pages eagerly imported in `App.jsx:10-19`; `LoginPage` forces users to download CPS admin tooling bundles they may never visit.
- **No `hooks/` directory** — all reusable logic lives inside context files or is copy-pasted per component.
- **Two near-identical, confusingly-named contexts** (`CredentialStoreContext` vs `CpsCredentialStoreContext`).
- **One context mixing two security domains** — `CpsCredentialStoreContext` holds both RAM-only per-app CSV creds and `localStorage`-persisted plaintext Global CPS secrets, contradicting its own sibling file's documented security model.
- **No `services/<entity>.js` layer** — only a thin `services/api.js` facade; all CRUD/business orchestration lives inline in pages.
- **Demo-mode mock data is broken**: `services/mockCpsData.json` is literally `{}`; the populated mock module `utils/mockCpsData.js` exists but is never imported anywhere.
- **1600-line generated CSS override file** as a band-aid for inconsistent `dark:` usage (see §4).

**Scalability risks:** adding a new page means another copy-paste of the BG/env-filter-localStorage-pattern, another ad hoc error-extraction one-liner, another full page bundle with no code-splitting — the codebase has no "paved road" abstractions, so growth multiplies existing duplication linearly.

---

## 6. State Management Review

- **Prop/state duplication across pages**: BG/env selection + `localStorage` sync + `window` event listener + "dummy version counter" anti-pattern independently implemented in `ApiManagerPage`, `ApplicationsPage`, `CpsManagerPage`, `CpsComparisonPage`, `ExchangePage`, `GlobalSearchPage` (6×).
- **State that should be lifted to Context**: BG/env filter selection (→ new `BgEnvFilterContext`), per-page loading-flag explosion (`CpsManagerPage.jsx` alone has 9 separate `xLoading` booleans) → `useAsyncAction` hook.
- **State that should be normalized, not duplicated**: `CpsComparisonPage.jsx`'s `sideA`/`sideB` store full `apps`/`envs` arrays inside a 14-field object that gets fully replaced on every keystroke in text inputs; multiple `useMemo`s do linear `.find()` scans instead of a `Map` lookup.
- **God-component local state**: `ApplicationDetailPage.jsx`'s 40+ flat `useState` calls mean any single-tab interaction (e.g. typing in the CPS search box) re-executes the entire 2939-line render body, including dependency-scanning regex work for tabs not even visible.
- **Context re-render over-broadcast**: none of the 6 contexts memoize their `value={{...}}` object with `useMemo`; `AuthContext` wraps the whole app and `CpsCredentialStoreContext` has 9+ consumers, so unrelated state changes in either cascade broadly.

**Recommendations (only where justified):**
- **Context API** is sufficient for BG/env filter state and for splitting Auth/CpsCredentialStore into memoized state+actions contexts — no need for Redux/Zustand given the app's scale.
- **TanStack Query** would be justified specifically to replace the hand-rolled `apiCache.js` + manual `loading/error/data` boilerplate scattered across pages — it already does 90% of what's needed (TTL, dedup, background refresh) but isn't exposed as a hook. Adopting React Query would let `apiCache.js` be retired in favor of a battle-tested library, OR wrap `apiCache.js`'s existing primitives in the `useCachedQuery` hook sketched in §3 as a lower-risk interim step.
- Redux/Zustand: **not justified** — no evidence of state needs beyond what Context + the above hooks can cleanly solve.

---

## 7. API Layer Review

- **Direct `api.get/post/patch/delete` calls scattered in components**: 20+ sites in `ApplicationDetailPage.jsx`, ~20 in `ApplicationsPage.jsx`, 15+ in `CpsManagerPage.jsx`, 10+ in `CpsComparisonPage.jsx`, plus `GlobalSearchPage.jsx`, `PingTestPage.jsx`, `ApiManagerPage.jsx`, `ExchangePage.jsx` — no per-entity service modules exist.
- **Duplicate requests**: the CPS "post credentials then fetch" dance is reimplemented independently in `ApplicationDetailPage.jsx:974-1019`, `CpsComparisonPage.jsx:646-677`, `CpsManagerPage.jsx:466-490`, `GlobalSearchPage.jsx:434-478`.
- **Missing abstraction**: `services/api.js`'s `mockHandler` is a 100-line if/else URL-matching waterfall instead of a resource map; `axiosClient.js` hardcodes a 6-item URL-substring skip-list for redirect suppression as magic strings.
- **Missing error handling**: `axiosClient.js:50-60` silently swallows network errors in its session-revalidation fallback — during a backend outage, an expired session never redirects to login (stuck UI).
- **Missing loading states**: not globally missing, but duplicated ad hoc per page (9 separate loading flags in `CpsManagerPage.jsx` alone).
- **Caching bypassed at the facade level**: the well-built `services/apiCache.js` SWR engine is never called from `services/api.js`'s own `get()` — caching is 100% opt-in per call site (only `prefetch.js` uses it correctly within this codebase).

**Suggested structure:**
```
src/
 ├── services/
 │    ├── http.js            (axios instance, interceptors, getErrorMessage())
 │    ├── applicationsService.js
 │    ├── cpsService.js      (centralizes credential-posting + fetch dance)
 │    ├── apiManagerService.js
 │    └── apiCache.js        (keep, but wrap via hook)
 ├── hooks/
 │    ├── useAsyncAction.js
 │    ├── useCachedQuery.js
 │    └── useCredentialMapStore.js
 └── utils/
      └── (existing files, de-duplicated per §1)
```

---

## 8. Performance Review

| Finding | Files | Category |
|---|---|---|
| No lazy-loading of any of 10 pages; `App.jsx` eagerly imports everything including 2200-2900-line CPS admin pages | `App.jsx` | **Critical** |
| `ApplicationDetailPage.jsx` god-component: 40+ `useState`, unmemoized `allProps`/dependency-scan regex work re-run every render including on unrelated-tab keystrokes | `ApplicationDetailPage.jsx:937-938, 2326-2355, 1611-1616` | **Critical** |
| `GlobalSearchPage.jsx` rebuilds `Map`s (`termGroups`,`appMap`,`bgMap`,`skMap`) and re-sorts potentially thousands of rows inline in JSX (not `useMemo`) on every render | `GlobalSearchPage.jsx:1403-1409, 1411-1658` | **High** |
| 1600-line generated CSS override file inflates bundle/parse cost app-wide | `index.css` | **High** |
| No `React.memo` on any list-item component (`ContractCard`, `PolicyCard`, `ResultRow`, `EnvRow`, `BgGroupedList`) despite large lists | `ApiManagerPage.jsx`, `PingTestPage.jsx`, `EnvFilterModal.jsx` | **Medium** |
| `CpsComparisonPage.jsx` stores full `apps`/`envs` arrays in `sideA`/`sideB` state objects replaced wholesale on every text-input keystroke | `CpsComparisonPage.jsx:467,528-530` | **Medium** |
| Several `useEffect`s with `eslint-disable-line react-hooks/exhaustive-deps` masking real stale-closure risk | `CpsAuthPanel.jsx:69-71`, `CpsExportModal.jsx:101,111,272,325` | **Medium** |
| Inline arrow functions created per row in `.map()` loops throughout (blocks future memoization) | Pervasive — `ApplicationsPage.jsx:2054`, `ApiManagerPage.jsx:787`, `EnvFilterModal.jsx:347-354` | **Low** |
| `apiCache.js` SWR/dedup engine bypassed by `api.js`'s own facade — redundant network calls likely | `services/api.js` vs `apiCache.js` | **High** |
| `BgGroupedList` (`EnvFilterModal.jsx`) recomputes `bgIds`/`allSel`/`someSel` per BG per keystroke in search box, no `useMemo` | `EnvFilterModal.jsx:76-159` | **Medium** |

Bundle size: `xlsx` (full build, ~800KB) and `lucide-react` imported app-wide with no evidence of tree-shaking verification; combined with no code-splitting, this is a **High** bundle-size concern worth a `vite-bundle-visualizer` pass.

---

## 9. React Best Practices Review

| Principle | Status | Evidence |
|---|---|---|
| DRY | ✗ Violated extensively | §1 (20 findings) |
| SOLID (SRP) | ✗ Violated | `ApplicationDetailPage.jsx`, `utils/exportCps.js:fetchAppCps` (165 lines, 6+ responsibilities) |
| KISS | ✗ Mixed | `axiosClient.js`'s hardcoded skip-list; `api.js`'s if/else mock router |
| Separation of Concerns | ✗ Violated | `ToastContext.jsx` renders UI inside a state provider; `CpsExportModal.jsx` embeds ARM-extraction business logic in a modal |
| Component Composition | ✗ Weak | No `Modal`/`Button`/`Card` primitives; every modal/button hand-rolled |
| Reusability | ✗ Weak | `ErrorBanner`/`CopyBtn` exist but are routinely ignored in favor of inline re-implementations |
| Maintainability | ✗ At risk | 2900+ line files, 1600-line generated CSS |
| Accessibility | ✗ Violated | Clickable `<div>`s without `role`/`tabIndex`/keyboard handlers in `BgFilterModal`, `EnvFilterModal`, `CpsExportModal`'s `BgEnvSelector`; icon-only buttons missing `aria-label` in `CpsAuthPanel`, `CpsCreateModal`, `CpsDeleteProjectModal`, `CpsImportModal` |
| Responsive Design | ✓ Mostly fine | Tailwind responsive classes used consistently where checked; not a major finding |

Positive counter-examples worth propagating: `Tooltip.jsx` (correct `onFocus`/`onBlur` keyboard support), `ApplicationsPage.jsx`'s `useMemo` usage, `utils/appUtils.js`'s small pure functions, `CredentialImportButton.jsx`'s correct `aria-label` usage.

---

## 10. Folder Structure Recommendation

```
src/
├── assets/
├── components/
│   ├── ui/              # Modal, Button, Card, CheckboxTile, Spinner, Skeleton,
│   │                       EmptyState, ErrorBanner, Tooltip, StatusBadge, Select
│   ├── layout/           # Header, Sidebar, Layout, PageHeader
│   └── shared/           # CopyBtn, FileDropZone, ConfirmActionModal, PostmanJsonViewer (uses hooks/utils below)
├── features/
│   ├── applications/     # ApplicationsPage, ApplicationDetailPage split into tabs/, modals/
│   ├── api-manager/       # ApiManagerPage, ContractCard, PolicyCard
│   ├── cps/               # CpsManagerPage, GlobalCpsManagerPage, CpsComparisonPage,
│   │                        CpsCreateModal, CpsImportModal, CpsExportModal, CpsAuthPanel,
│   │                        CpsBinaryUploadPanel, CpsSettingsModal, CpsRawJsonModal, BgFilterModal, EnvFilterModal
│   ├── exchange/          # ExchangePage
│   ├── ping-test/         # PingTestPage, PingTestPanel, PingResultCard, AttemptLog
│   └── search/            # GlobalSearchPage
├── hooks/                 # useLocalStorageState, useAsyncAction, useCredentialMapStore,
│                             useCachedQuery, usePendingPropertyChanges, useCopyToClipboard,
│                             useBgEnvFilter, useCsvAppMatcher, useDebounce
├── services/
│   ├── http.js            # axios instance + interceptors + getErrorMessage()
│   ├── applicationsService.js
│   ├── cpsService.js
│   ├── apiManagerService.js
│   ├── apiCache.js (kept)
│   └── mocks/             # consolidated demo-mode data (fixes the empty-JSON/orphaned-file bug)
├── context/                # AuthContext, CredentialStoreContext (merged logic via hooks/useCredentialMapStore),
│                              GlobalCpsCredentialContext (split out of CpsCredentialStoreContext),
│                              ThemeContext, ToastContext (state only), NotificationContext,
│                              BgEnvFilterContext (new)
├── utils/                  # appUtils, cpsHelpers (sole CPS-response normalizer), filterUtils,
│                              csvCredentialStore, globalCpsCsvParser, demoMode, accentColors.js (new)
├── routes/                 # App.jsx route table, extracted from main App component, React.lazy()'d
└── pages/                   # thin route-level wrappers only, composing feature components
```

**What moves where:** Split `ApplicationDetailPage.jsx`'s 8 inline tab IIFEs into `features/applications/tabs/*.jsx`; split `CpsManagerPage.jsx`'s exported `PropertyTable`/`SecureGroupEditor` into `features/cps/PropertyTable.jsx` / `SecureGroupEditor.jsx` so `GlobalCpsManagerPage` doesn't force-load the whole manager page; move the 7 modal shells to use the new `components/ui/Modal.jsx`; move `ToastContext`'s rendered JSX into `components/ui/ToastContainer.jsx`.

---

## 11. Final Report

### Executive Summary
The app is functional and has some genuinely solid pieces (SWR cache engine, Tailwind theme, `appUtils.js`), but it was built by extending a flat `components/`/`pages/` structure without ever introducing a `hooks/` layer or UI primitives (`Modal`, `Button`, `Card`). The result is systemic copy-paste across 7+ modals, 6+ pages' filter logic, 4+ CPS-config extraction implementations (one with an actual correctness bug), and two confusingly-named, partially-duplicated credential contexts — one of which persists secrets to `localStorage` against its own documented security model. The biggest single risk is the pair of god-components (`ApplicationDetailPage.jsx` 2939 lines, `CpsManagerPage.jsx` 2200+ lines) with no code-splitting anywhere in `App.jsx`.

### Top 20 Refactoring Opportunities
1. Fix CPS-config-extraction divergence (Dup #7) — correctness bug.
2. Fix broken demo-mode CPS mocks (`mockCpsData.json` empty).
3. Fix `PingTestPanel.jsx` latency-color/flatten-props drift from shared utils.
4. Merge `CredentialStoreContext`/`CpsCredentialStoreContext` via shared hook.
5. Split Global CPS secret storage out of localStorage-persisted context.
6. Introduce `hooks/` directory with `useAsyncAction`, `useLocalStorageState`, `useCachedQuery`.
7. Extract `components/ui/Modal.jsx`, migrate all 7 modals.
8. Extract `components/ui/ConfirmActionModal.jsx`, migrate 5 confirm dialogs.
9. Wire the existing `ErrorBanner` into the 6 CPS components hand-rolling error markup.
10. Replace all local `CopyBtn` re-implementations with the shared component.
11. Dedupe `CpsRawJsonModal`/`PostmanJsonViewer` tokenizer into `utils/postmanJsonTheme.js`.
12. Dedupe `exportCps.js`'s `normalisePropsArray` into `cpsHelpers.flattenCpsResponse`.
13. Extract `usePendingPropertyChanges` hook from the 3 CPS pending-change implementations.
14. Create `BgEnvFilterContext`, remove the 6× window-event/localStorage/dummy-counter pattern.
15. Split `ApplicationDetailPage.jsx` into per-tab components.
16. Split `CpsManagerPage.jsx`'s co-located `PropertyTable`/`SecureGroupEditor` into own files.
17. Add `React.lazy()`/`Suspense` for all page routes in `App.jsx`.
18. Memoize all 6 context `value={{...}}` objects with `useMemo`.
19. Add keyboard support (`role`, `tabIndex`, `onKeyDown`) to checkbox `<div>`s in `BgFilterModal`/`EnvFilterModal`.
20. Fix `axiosClient.js`'s silently-swallowed network error in session-revalidation fallback.

### Top 10 Duplicate Code Areas
1. CPS config extraction (4 divergent re-implementations — correctness bug)
2. Modal shells (7 near-identical overlays/cards/footers)
3. CPS pending-changes reducer (3× byte-identical)
4. Credential-store contexts (`CredentialStoreContext` vs `CpsCredentialStoreContext`)
5. JSON tokenizer theme (`CpsRawJsonModal` vs `PostmanJsonViewer`)
6. Clipboard-copy logic (6 independent implementations)
7. CPS URL-cleaning + fallback-request boilerplate (5×)
8. Error-message extraction one-liner (30+ call sites)
9. CSV/XLSX export logic (3 parallel implementations)
10. BG/env filter state pattern (6 pages, window-event + localStorage + dummy counter)

### Top 10 Tailwind Improvements
1. Retire the 1600-line generated dark-mode override CSS (`index.css`)
2. Extract shared `<Card>` for the repeated 190-char card wrapper string (15+ sites)
3. Consolidate 5-6 duplicate accent-color lookup tables into `utils/accentColors.js`
4. Standardize modal backdrop opacity/radius (`black/60` vs `black/70`, `rounded-2xl` vs `rounded-3xl`)
5. Unify 4 inconsistent table-header stylings into `<TableHeader>`
6. Replace raw hex in JSON viewers (`#ff6c37`, `#1e1e1e`) with theme tokens/CSS variables
7. Replace `bg-[#0B0F17]` arbitrary color (2 files) with a Tailwind theme token
8. Add `@layer components` definitions for `.card`/`.btn-*`/`.modal-*` (currently unused)
9. Standardize button padding scale (`px-4 py-2` vs `px-5 py-2.5` vs `px-3 py-1.5`)
10. Extract shared `<CheckboxTile>` className string (currently duplicated 6×)

### Components That Should Be Shared
`Modal`, `Button`, `Card`, `ConfirmActionModal`, `CheckboxTile`, `FileDropZone`, `PageHeader`, `SkeletonTable`, `ClientIdList`, `TableHeader` (full rationale in §2).

### Hooks That Should Be Created
`useLocalStorageState`, `useAsyncAction`, `useCredentialMapStore`, `useCachedQuery`, `usePendingPropertyChanges`, `useCopyToClipboard`, `useBgEnvFilter`, `useCsvAppMatcher`, `useDebounce` (sketches in §3).

### API Layer Improvements
Per-entity `services/*Service.js` modules, `getErrorMessage()` helper, resource-map-driven mock handler, wrap `apiCache.js` in a `useCachedQuery` hook, fix the swallowed-network-error session fallback.

### Performance Improvements
Code-split all pages, memoize `ApplicationDetailPage`'s dependency-scan/`allProps`, memoize `GlobalSearchPage`'s grouped Maps/sort, `React.memo` all list-item components, audit `eslint-disable` exhaustive-deps suppressions, normalize `CpsComparisonPage`'s side-state.

### Architecture Improvements
Introduce `hooks/`, split god-components into feature folders, retire the generated CSS override file, split the dual-concern `CpsCredentialStoreContext`.

### Scores (1-10)
| Metric | Score |
|---|---|
| **Technical Debt Score** | 7/10 (high — concentrated in a few very large files + the CSS override hack) |
| **Maintainability Score** | 4/10 |
| **Reusability Score** | 3/10 |
| **Scalability Score** | 4/10 |

### Refactoring Roadmap

**Phase 1 — Quick Wins**
Fix latency-color/flatten-props drift, wire existing `ErrorBanner`/`CopyBtn`, fix empty mock JSON, fix axiosClient swallowed error, memoize context values, add `aria-label`/keyboard handlers to checkbox divs.

**Phase 2 — Remove Duplicates**
Centralize CPS config extraction, merge credential contexts via shared hook, dedupe JSON tokenizer, dedupe CPS normalizers, extract `usePendingPropertyChanges`.

**Phase 3 — Component Consolidation**
Build `Modal`/`Button`/`Card`/`ConfirmActionModal`/`CheckboxTile`/`PageHeader`, migrate all consumers.

**Phase 4 — Architecture Improvements**
Introduce `hooks/`, split `ApplicationDetailPage`/`CpsManagerPage`, add `BgEnvFilterContext`, add `React.lazy()` route splitting.

**Phase 5 — Design System Adoption**
Retire the 1600-line CSS override file, add `@layer components`, centralize accent-color system, standardize CSV/XLSX export through one service.
</content>
