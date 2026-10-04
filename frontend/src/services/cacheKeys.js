/**
 * Centralised cache key factory — single source of truth for every key
 * pattern used across the application.
 *
 * Using this module instead of inline string literals means:
 *   • Typos are caught at import time (no silent cache misses)
 *   • Key format changes are made in one place
 *   • bustCache() calls are easy to reason about
 *
 * Usage:
 *   import { CK } from '../services/cacheKeys';
 *   getCachedSWR(CK.bgs(orgId))
 *   setCached(CK.apps(bgId, bgIds), data, 3 * 60 * 1000)
 *   bustCache(CK.PREFIX.apps)
 */

export const CK = {
  // ── Business groups ──────────────────────────────────────────────────────
  /** Org-level business group list.  TTL recommendation: 30 min */
  bgs: (orgId) => `bgs:${orgId}`,

  // ── Application summaries ────────────────────────────────────────────────
  /**
   * Merged apps + envs for a specific BG scope.
   * bgId may be '__all__'.
   * bgIds is the array of BG IDs actually fetched.
   * TTL recommendation: 3–5 min (status changes frequently)
   */
  apps: (bgId, bgIds) => `apps:${bgId}:${Array.isArray(bgIds) ? bgIds.join(',') : bgIds}`,

  /**
   * Merged apps for ALL BGs (used by CpsComparisonPage).
   * TTL recommendation: 3–5 min
   */
  appsAll: (bgIds) => `apps:__all__:${Array.isArray(bgIds) ? bgIds.join(',') : bgIds}`,

  // ── Per-app detail (CH1 or CH2) ──────────────────────────────────────────
  /** Full app detail (CH2 deployment+Private Space IPs, or CH1 fallback
   *  bundle) for a single app. TTL recommendation: 5 min */
  appDetail: (orgId, envId, appId) => `appdetail:${orgId}:${envId}:${appId}`,

  // ── Breadcrumb lookups (shared with ApplicationsPage's BG/env caches) ───
  /** Environments list for a BG — same shape as getEnvironments(orgId).
   *  TTL recommendation: 30 min (rarely changes) */
  envs: (orgId) => `envs:${orgId}`,

  // ── CPS non-secure properties (auto-loaded on app detail open) ───────────
  /** Flattened non-secure CPS properties for one app's CPS key+env.
   *  TTL recommendation: 5 min */
  cpsNonSecure: (baseUrl, depType, env, key) => `cpsns:${baseUrl}:${depType}:${env}:${key}`,

  // ── Application Detail page's lazy ("tab click") data ────────────────────
  /** CH2 scheduler list for one app (Schedulers tab).  TTL recommendation: 5 min */
  schedulers: (orgId, envId, appId) => `schedulers:${orgId}:${envId}:${appId}`,
  /** Resolved API Manager instance + consumer contracts (Contracts tab).
   *  TTL recommendation: 5 min */
  contracts: (orgId, envId, appId) => `contracts:${orgId}:${envId}:${appId}`,
  /** Exchange ping/API spec (API Spec + Ping Test tabs) — rarely changes.
   *  TTL recommendation: 10 min */
  pingSpec: (orgId, appName) => `pingspec:${orgId}:${appName}`,

  // ── CloudHub 1.0 application list ────────────────────────────────────────
  /** CH1 app list for a BG+env.  TTL recommendation: 5 min */
  ch1list: (bgId, envId) => `ch1list:${bgId}:${envId}`,

  // ── Schedulers dashboard (aggregate across all apps in a BG scope) ──────
  /**
   * Flattened scheduler list for a BG scope — same (bgId, bgIds) shape as
   * CK.apps above. bgId may be '__all__'; bgIds is the array actually fetched.
   * TTL recommendation: 3 min (enabled/disabled + next-run change often)
   */
  allSchedulers: (bgId, bgIds) => `allschedulers:${bgId}:${Array.isArray(bgIds) ? bgIds.join(',') : bgIds}`,
};

/**
 * Key prefixes for bustCache() — bust an entire category at once.
 *
 * Example:
 *   bustCache(CK.PREFIX.apps)   // invalidate all application caches
 *   bustCache(CK.PREFIX.bgs)    // invalidate all business-group caches
 */
CK.PREFIX = {
  bgs:          'bgs:',
  apps:         'apps:',
  appDetail:    'appdetail:',
  envs:         'envs:',
  cpsNonSecure: 'cpsns:',
  schedulers:   'schedulers:',
  contracts:    'contracts:',
  pingSpec:     'pingspec:',
  ch1list:      'ch1list:',
  allSchedulers: 'allschedulers:',
};