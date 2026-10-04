/**
 * Cache warming — fires parallel background GETs immediately after login
 * so the first page navigation is instant (warm cache hit, no spinner).
 *
 * All fetches are fire-and-forget:
 *   • Errors are silently swallowed — warming is best-effort
 *   • The caller does NOT await this function
 *   • Nothing breaks if the prefetch finishes after the user has already
 *     navigated to the page (the page just uses the fresher data)
 *
 * TTLs used here are intentionally longer than the page-level defaults
 * because this data is fetched at login time and must remain usable until
 * the user navigates to the relevant page for the first time.
 */

import api from './api';
import { setCached } from './apiCache';
import { CK } from './cacheKeys';
import { applyBgFilter } from '../components/shared/BgFilterModal';

const BG_STALE_MS  = 30 * 60 * 1000;   // BGs: 30 min (rarely change)
const APP_STALE_MS = 20 * 60 * 1000;   // Apps: 20 min eviction (mirrors ApplicationsPage APP_STALE_MS)

/**
 * Warm the in-memory cache after a successful login.
 *
 * Phase 1 — fetch business groups and store under CK.bgs(orgId)
 * Phase 2 — fan-out to fetch application summaries + environments for
 *            every BG in parallel. Each BG's own result is cached under
 *            its OWN single-BG key (CK.apps(bgId, [bgId])) — this is what
 *            makes picking any individual BG from ApplicationsPage's
 *            dropdown an instant cache hit instead of a cold re-fetch of
 *            data this function already just downloaded. The merged
 *            superset is ALSO cached under CK.apps('__all__', bgIds) for
 *            ApplicationsPage's default "All Organizations" view and
 *            CpsComparisonPage.
 *
 * (Previously only the merged '__all__' entry was cached, so every first
 * switch to a specific BG from the dropdown re-fetched from scratch even
 * though warmCache had already fetched that exact BG's data at login.)
 *
 * @param {string} orgId  Root org ID from the login response
 */
export function warmCache(orgId) {
  if (!orgId) return;

  api
    .get('/organizations/business-groups')
    .then((r) => {
      const groups = r.data?.data || [];
      if (!groups.length) return;

      // Phase 1: cache BG list
      setCached(CK.bgs(orgId), groups, BG_STALE_MS);

      // Phase 2: fan-out only to BGs the user has chosen to see.
      // applyBgFilter reads the BG filter selection from localStorage —
      // if no filter is set it returns all groups unchanged, so first-login
      // behaviour is unaffected.  With a filter active, only the selected
      // BGs are warmed instead of all 80+ root orgs.
      const visibleGroups = applyBgFilter(groups);
      const bgIds = visibleGroups.map((g) => g.id);

      if (!bgIds.length) return;

      Promise.allSettled(
        bgIds.map((id) =>
          Promise.all([api.get(`/applications/summary/${id}`), api.get(`/environments/${id}`)])
        )
      ).then((results) => {
        const merged = [];
        const mergedEnvs = [];
        const seen = new Set();
        const seenEnvs = new Set();

        results.forEach((res, i) => {
          if (res.status !== 'fulfilled') return;
          const [appsRes, envsRes] = res.value;
          const bgApps = (appsRes.data?.data || []).map((a) => ({ ...a, _bgId: bgIds[i] }));
          const bgEnvs = envsRes.data?.data || [];

          // Cache this BG individually — instant hit the moment the user
          // picks it from the dropdown.
          setCached(CK.apps(bgIds[i], [bgIds[i]]), { apps: bgApps, envs: bgEnvs }, APP_STALE_MS);

          bgApps.forEach((a) => {
            const key = `${a.id}|${a.environment?.id || ''}`;
            if (!seen.has(key)) { seen.add(key); merged.push(a); }
          });
          bgEnvs.forEach((e) => {
            if (!seenEnvs.has(e.id)) { seenEnvs.add(e.id); mergedEnvs.push(e); }
          });
        });

        if (merged.length) {
          // Cache under the "__all__" key so both ApplicationsPage and
          // CpsComparisonPage benefit from the same warm entry.
          setCached(CK.apps('__all__', bgIds), { apps: merged, envs: mergedEnvs }, APP_STALE_MS);
        }
      }).catch(() => {}); // swallow — warming is best-effort
    })
    .catch(() => {}); // swallow — warming is best-effort
}