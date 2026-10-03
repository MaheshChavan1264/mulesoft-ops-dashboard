import React, { createContext, useContext, useCallback, useMemo } from 'react';
import { useLocalStorageState } from '../hooks/useLocalStorageState';
import { parseGlobalCpsCsv } from '../utils/globalCpsCsvParser';

const GLOBAL_CREDS_KEY = 'mule_dashboard_global_cps_creds';

const GlobalCpsCredentialStoreContext = createContext(null);

/**
 * GlobalCpsCredentialStoreProvider
 *
 * Holds the Global CPS BG/env/version credential matrix used by the
 * Global CPS Manager. Persisted to localStorage (via useLocalStorageState)
 * so the manager survives page refreshes.
 *
 * SECURITY NOTE: these credentials are stored in plaintext in
 * localStorage. See FRONTEND_ARCHITECTURE_REVIEW.md §1. Kept separate
 * from CpsCredentialStoreContext (per-app CSV creds, RAM only) so the two
 * very different trust/persistence models aren't conflated in one
 * provider.
 */
export function GlobalCpsCredentialStoreProvider({ children }) {
  const [globalCredentials, setGlobalCredentials] = useLocalStorageState(GLOBAL_CREDS_KEY, []);

  const loadGlobalFromCsv = useCallback((text) => {
    const parsed = parseGlobalCpsCsv(text);
    setGlobalCredentials(parsed);
    return parsed.length;
  }, [setGlobalCredentials]);

  const clearCredentials = useCallback(() => {
    setGlobalCredentials([]);
  }, [setGlobalCredentials]);

  const getGlobalCredential = useCallback((bg, env, chVersion) => {
    const bgEntry = globalCredentials.find(g => g.businessGroup === bg);
    if (!bgEntry) return null;
    const versionEntry = bgEntry[chVersion.toLowerCase()];
    if (!versionEntry) return null;
    return versionEntry[env.toLowerCase()] || null;
  }, [globalCredentials]);

  const value = useMemo(() => ({
    globalCredentials,
    hasGlobalCredentials: globalCredentials.length > 0,
    loadGlobalFromCsv,
    getGlobalCredential,
    clearCredentials,
  }), [
    globalCredentials,
    loadGlobalFromCsv,
    getGlobalCredential,
    clearCredentials,
  ]);

  return (
    <GlobalCpsCredentialStoreContext.Provider value={value}>
      {children}
    </GlobalCpsCredentialStoreContext.Provider>
  );
}

export function useGlobalCpsCredentialStore() {
  const ctx = useContext(GlobalCpsCredentialStoreContext);
  if (!ctx) {
    throw new Error('useGlobalCpsCredentialStore must be used within a GlobalCpsCredentialStoreProvider');
  }
  return ctx;
}
