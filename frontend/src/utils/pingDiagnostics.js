/**
 * Shared ping-result diagnostics.
 *
 * Originally implemented only inside PingTestPanel.jsx (single-app ping
 * config/result view) — extracted so PingTestPage.jsx's batch results page
 * can offer the same "detect missing required query param → auto-fill &
 * retry" UX without duplicating/drifting the heuristic.
 */

/**
 * Text-only half of the "missing required query param" heuristic — doesn't
 * need the Exchange spec, so callers that fetch the spec lazily (only once
 * it's actually worth it) can use this cheap check first to decide whether
 * to bother fetching it at all.
 *
 * @param {{ status?: string, httpStatus?: number, payload?: *, error?: string }} result
 * @returns {boolean}
 */
export function looksLikeMissingParamText(result) {
  if (!result || !['PARTIAL', 'FAILED'].includes(result.status)) return false;
  if (result.status === 'PARTIAL' && result.httpStatus != null && result.httpStatus !== 400 && result.httpStatus !== 422) return false;

  const bodyText = (() => {
    try { return typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload || ''); }
    catch { return ''; }
  })();
  const text = `${bodyText} ${result.error || ''}`.toLowerCase();
  const mentionsParam = /(query\s*param|parameter|\bparam\b)/.test(text);
  return mentionsParam && (/required/.test(text) || /missing/.test(text) || /not\s+provided/.test(text));
}

/**
 * Scan a ping result's body/error text for signals that a *required query
 * parameter* was missing, and cross-reference the Exchange spec's declared
 * required query params for the endpoint that was actually hit.
 *
 * Deliberately NOT gated to a specific httpStatus beyond excluding 2xx —
 * apps report this in all sorts of ways (400, 422, or even a 500 with a
 * descriptive body) — the text heuristic is what actually decides.
 *
 * @param {{ status?: string, httpStatus?: number, payload?: *, error?: string, activeEndpoint?: string }} result
 * @param {{ pingEndpoints?: Array<{ path: string, queryParams?: Array<{ name: string, required?: boolean, example?: string, type?: string }> }> }} pingSpec
 * @param {string} currentQueryParams  Raw "key=val&key2=val2" string currently configured for the retry
 * @returns {{ missing: Array<{name:string}>, qpToAdd: string } | null}
 */
export function detectMissingRequiredParams(result, pingSpec, currentQueryParams = '') {
  if (!looksLikeMissingParamText(result)) return null;

  const currentNames = new Set(
    currentQueryParams.split('&').map((kv) => kv.split('=')[0].trim()).filter(Boolean)
  );

  // Match the endpoint that was actually hit against spec-declared ones, so
  // the auto-fill only suggests params relevant to that specific path.
  const hitPath = result.activeEndpoint
    ? (() => { try { return new URL(result.activeEndpoint).pathname; } catch { return result.activeEndpoint; } })()
    : null;
  const specEndpoints = pingSpec?.pingEndpoints || [];
  const matchedEndpoint = (hitPath && specEndpoints.find((ep) => hitPath.endsWith(ep.path))) || specEndpoints[0] || null;

  const requiredQp = (matchedEndpoint?.queryParams || []).filter((p) => p.required);
  const missing = requiredQp.filter((p) => !currentNames.has(p.name));
  const qpToAdd = missing.map((p) => `${p.name}=${p.example || p.type || ''}`).join('&');
  return { missing, qpToAdd };
}
