import { useState, useCallback } from 'react';
import { parseCsvToCredentialMap } from '../utils/csvCredentialStore';

/**
 * useCredentialMapStore
 *
 * Shared in-memory Map<clientId, clientSecret> store + CSV loader + lookup
 * helpers. Extracted so CredentialStoreContext and CpsCredentialStoreContext
 * no longer maintain two independent (but previously byte-identical) copies
 * of this state machine — see FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #5.
 *
 * Security model (unchanged from the original CredentialStoreContext):
 *   - The CSV is parsed client-side; file bytes never leave the browser.
 *   - clientSecrets are not sent to the backend; only the single matched
 *     clientId+secret pair travels over HTTPS at the moment a ping fires.
 *   - This hook never touches localStorage/sessionStorage — callers that
 *     need persistence (e.g. Global CPS credentials) must layer it on top.
 */
export function useCredentialMapStore() {
  const [credentialMap, setCredentialMap] = useState(new Map());
  const [loadedCount, setLoadedCount] = useState(0);

  /** Parse a CSV text string and populate the credential map. Returns the count loaded. */
  const loadFromCsv = useCallback((text) => {
    const map = parseCsvToCredentialMap(text);
    setCredentialMap(map);
    setLoadedCount(map.size);
    return map.size;
  }, []);

  /** Wipe all credentials from memory immediately. */
  const clearCredentials = useCallback(() => {
    setCredentialMap(new Map());
    setLoadedCount(0);
  }, []);

  /** Look up the secret for a given clientId. Returns null if not found. */
  const getSecret = useCallback(
    (clientId) => credentialMap.get(clientId) ?? null,
    [credentialMap]
  );

  /** Returns true if we have a secret stored for this clientId. */
  const hasCredential = useCallback(
    (clientId) => credentialMap.has(clientId),
    [credentialMap]
  );

  /**
   * Given an array of candidate clientIds (e.g. returned by the backend's
   * /auto-credentials endpoint), find the first one whose secret we hold.
   * Returns { clientId, clientSecret } or null.
   */
  const resolveFromCandidates = useCallback(
    (candidates = []) => {
      for (const id of candidates) {
        const secret = credentialMap.get(id);
        if (secret) return { clientId: id, clientSecret: secret };
      }
      return null;
    },
    [credentialMap]
  );

  /** Return every loaded credential pair as an array of { clientId, clientSecret }. */
  const getAllCredentials = useCallback(
    () =>
      Array.from(credentialMap.entries()).map(([id, secret]) => ({
        clientId: id,
        clientSecret: secret,
      })),
    [credentialMap]
  );

  return {
    credentialMap,
    loadedCount,
    hasCredentials: loadedCount > 0,
    loadFromCsv,
    clearCredentials,
    getSecret,
    hasCredential,
    resolveFromCandidates,
    getAllCredentials,
  };
}
