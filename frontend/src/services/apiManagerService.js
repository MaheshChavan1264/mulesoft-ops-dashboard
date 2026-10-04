import api from './api';
export { getBusinessGroups, getEnvironments } from './applicationsService';

/**
 * apiManagerService.js
 *
 * Thin per-entity wrappers around the raw `api.get/patch/delete` calls
 * scattered inline across ApiManagerPage.jsx (and the companion contract
 * endpoints reused by ApplicationDetailPage's Contracts tab, see
 * applicationsService.js) — see FRONTEND_ARCHITECTURE_REVIEW.md §7 and
 * §10's recommended folder structure.
 *
 * `getBusinessGroups`/`getEnvironments` are re-exported from
 * applicationsService.js (the canonical definition) rather than duplicated,
 * since they're generic org/environment lookups, not API-Manager-specific.
 */

/** List API Manager instances for one Business Group + Environment pair. */
export function getApiInstances(bgId, envId) {
  return api.get(`/apis/${bgId}/${envId}`);
}

export function getApiPolicies(bgId, envId, apiInstanceId) {
  return api.get(`/apis/${bgId}/${envId}/${apiInstanceId}/policies`);
}

export function getApiContracts(bgId, envId, apiInstanceId) {
  return api.get(`/apis/${bgId}/${envId}/${apiInstanceId}/contracts`);
}

/** @param {'APPROVED'|'REVOKED'} status */
export function updateContractStatus(bgId, envId, apiInstanceId, contractId, status) {
  return api.patch(`/apis/${bgId}/${envId}/${apiInstanceId}/contracts/${contractId}`, { status });
}

export function deleteContract(bgId, envId, apiInstanceId, contractId) {
  return api.delete(`/apis/${bgId}/${envId}/${apiInstanceId}/contracts/${contractId}`);
}
