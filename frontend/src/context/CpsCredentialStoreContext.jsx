import React, { createContext, useContext, useState, useCallback } from 'react';
import { parseCsvToCredentialMap } from '../utils/csvCredentialStore';

const CpsCredentialStoreContext = createContext(null);

/**
 * CpsCredentialStoreProvider
 *
 * Separate credential store for CPS (Config Property Server) client credentials.
 * Holds a Map<clientId, clientSecret> in React state ONLY — never persisted.
 *
 * These are CPS server credentials, distinct from the API Manager contract
 * credentials used by the Ping Test feature (CredentialStoreContext).
 *
 * CSV parsing is handled by the shared parseCsvToCredentialMap utility
 * (utils/csvCredentialStore.js) so the logic stays in sync with
 * CredentialStoreContext.
 *
 * Extra method compared to CredentialStoreContext:
 *   getAllCredentials() — returns every { clientId, clientSecret } pair,
 *   used for URL-based fallback resolution in CPS credential posting.
 */
export function CpsCredentialStoreProvider({ children }) {
  const [credentialMap, setCredentialMap] = useState(new Map());
  const [loadedCount, setLoadedCount] = useState(0);

  /**
   * Parse a CSV text string and populate the credential map.
   * Returns the number of credential pairs loaded.
   */
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
   * Given an array of candidate clientIds, find the first one whose secret
   * we hold.  Returns { clientId, clientSecret } or null.
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

  /**
   * Return all { clientId, clientSecret } pairs — used for URL-based
   * fallback resolution when posting credentials to the backend session.
   */
  const getAllCredentials = useCallback(
    () =>
      Array.from(credentialMap.entries()).map(([id, secret]) => ({
        clientId: id,
        clientSecret: secret,
      })),
    [credentialMap]
  );

  return (
    <CpsCredentialStoreContext.Provider
      value={{
        loadedCount,
        hasCredentials: loadedCount > 0,
        loadFromCsv,
        clearCredentials,
        getSecret,
        hasCredential,
        resolveFromCandidates,
        getAllCredentials,
      }}
    >
      {children}
    </CpsCredentialStoreContext.Provider>
  );
}

export function useCpsCredentialStore() {
  const ctx = useContext(CpsCredentialStoreContext);
  if (!ctx) {
    throw new Error('useCpsCredentialStore must be used within a CpsCredentialStoreProvider');
  }
  return ctx;
}