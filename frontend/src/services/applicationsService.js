import api from './api';

/**
 * applicationsService.js
 *
 * Thin per-entity wrappers around the raw `api.get/post/patch/delete` calls
 * that were scattered inline across ApplicationsPage.jsx and
 * ApplicationDetailPage.jsx — see FRONTEND_ARCHITECTURE_REVIEW.md §7
 * ("Direct api.get/post/patch/delete calls scattered in components... no
 * per-entity service modules exist") and §10's recommended folder structure.
 *
 * These wrap the *exact* URL shapes already in use (verified against both
 * pages) without changing any request/response contract — callers still own
 * their own loading/error state, caching, and CH1-vs-CH2 branching, since
 * that orchestration differs per call site and isn't safe to collapse
 * blindly. This module exists so new code (and incrementally, existing
 * call sites) doesn't have to re-derive these URL patterns by hand.
 */

// ── Business groups / environments ────────────────────────────────────────

export function getBusinessGroups() {
  return api.get('/organizations/business-groups');
}

export function getEnvironments(bgId) {
  return api.get(`/environments/${bgId}`);
}

// ── Application list ──────────────────────────────────────────────────────

/**
 * @param {string} bgId
 * @param {boolean} [forceRefresh] appends `?refresh=true`
 */
export function getApplicationsSummary(bgId, forceRefresh = false) {
  return api.get(`/applications/summary/${bgId}`, forceRefresh ? { params: { refresh: 'true' } } : {});
}

// ── Application detail (CH1/CH2) ──────────────────────────────────────────

export function getCloudhub2AppDetail(orgId, envId, appId, forceRefresh = false) {
  return api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}`, forceRefresh ? { params: { refresh: 'true' } } : undefined);
}

export function getCloudhub1AppDetail(envId, appId, orgId, forceRefresh = false) {
  return api.get(`/applications/cloudhub1/${envId}/${appId}`, { params: { orgId, ...(forceRefresh ? { refresh: 'true' } : {}) } });
}

/** GET /applications/cloudhub1/{envId}/{appName}/properties — CH1 app runtime properties by name. */
export function getCloudhub1AppProperties(envId, appName, orgId) {
  return api.get(`/applications/cloudhub1/${envId}/${appName}/properties`, { params: { orgId } });
}

export function getPrivateSpaceDetail(orgId, targetId) {
  return api.get(`/applications/private-spaces/${orgId}/${targetId}`);
}

// ── Application lists (paginated / per-BG scans used by Global Search) ───

/** GET /applications/cloudhub2/{bgId}/{envId} — paginated CH2 app list. */
export function getCloudhub2AppsList(bgId, envId, limit, offset) {
  return api.get(`/applications/cloudhub2/${bgId}/${envId}`, { params: { limit, offset } });
}

/** GET /applications/cloudhub1/{envId} — CH1 app list for one BG/env. */
export function getCloudhub1AppsList(envId, orgId) {
  return api.get(`/applications/cloudhub1/${envId}`, { params: { orgId } });
}

// ── Schedulers ─────────────────────────────────────────────────────────────

export function getCloudhub1Schedules(envId, appId, orgId) {
  return api.get(`/applications/cloudhub1/${envId}/${appId}/schedules`, { params: { orgId } });
}

export function getCloudhub2Schedulers(orgId, envId, appId) {
  return api.get(`/applications/cloudhub2/${orgId}/${envId}/${appId}/schedulers`);
}

export function getCloudhub1StaticIps(envId, appId, orgId) {
  return api.get(`/applications/cloudhub1/${envId}/${appId}/static-ips`, { params: { orgId } });
}

/** POST /applications/cloudhub1/{envId}/{appId}/schedules/{schedulerKey}/run — trigger a CH1 scheduler immediately. */
export function runCloudhub1SchedulerNow(envId, appId, schedulerKey, orgId) {
  return api.post(
    `/applications/cloudhub1/${envId}/${appId}/schedules/${encodeURIComponent(schedulerKey)}/run`,
    {},
    { params: { orgId } }
  );
}

export function runCloudhub2SchedulerNow(orgId, envId, appId, schedulerKey) {
  return api.post(`/applications/cloudhub2/${orgId}/${envId}/${appId}/schedulers/${encodeURIComponent(schedulerKey)}/run`);
}

export function setCloudhub1SchedulerEnabled(envId, appId, schedulerKey, orgId, enabled) {
  return api.put(
    `/applications/cloudhub1/${envId}/${appId}/schedules/${encodeURIComponent(schedulerKey)}`,
    { enabled },
    { params: { orgId } }
  );
}

export function setCloudhub2SchedulerEnabled(orgId, envId, appId, schedulerKey, enabled) {
  return api.put(
    `/applications/cloudhub2/${orgId}/${envId}/${appId}/schedulers/${encodeURIComponent(schedulerKey)}`,
    { enabled }
  );
}

/**
 * GET /applications/schedulers/{orgId} — aggregate scheduler list across
 * every app (CH1 + CH2, all environments) for one business group. Backs the
 * Schedulers dashboard page; see cacheKeys.js's `allSchedulers` key.
 */
export function getAllSchedulers(orgId, forceRefresh = false) {
  return api.get(`/applications/schedulers/${orgId}`, forceRefresh ? { params: { refresh: 'true' } } : {});
}

// ── Application lifecycle actions ─────────────────────────────────────────

/** @param {'start'|'stop'|'restart'} action */
export function runCloudhub2Action(orgId, envId, appId, action) {
  return api.post(`/applications/cloudhub2/${orgId}/${envId}/${appId}/action`, { action });
}

/** @param {'start'|'stop'|'restart'} action */
export function runCloudhub1Action(envId, appId, orgId, action) {
  return api.post(`/applications/cloudhub1/${envId}/${appId}/action?orgId=${orgId}`, { action });
}

// ── Consumer contracts (also used from ApplicationDetailPage's Contracts tab) ──

export function getContracts(orgId, envId, apiInstanceId) {
  return api.get(`/apis/${orgId}/${envId}/${apiInstanceId}/contracts`);
}

/** @param {'APPROVED'|'REVOKED'} status */
export function updateContractStatus(orgId, envId, apiInstanceId, contractId, status) {
  return api.patch(`/apis/${orgId}/${envId}/${apiInstanceId}/contracts/${contractId}`, { status });
}

export function deleteContract(orgId, envId, apiInstanceId, contractId) {
  return api.delete(`/apis/${orgId}/${envId}/${apiInstanceId}/contracts/${contractId}`);
}
