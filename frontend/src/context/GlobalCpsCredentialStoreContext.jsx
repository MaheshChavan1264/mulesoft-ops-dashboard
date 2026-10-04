import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { parseGlobalCpsCsv } from '../utils/globalCpsCsvParser';

// Previous versions of this store persisted the matrix to localStorage under
// this key. We no longer write to it, but we actively remove any
// previously-written copy on mount so secrets from before this fix don't
// linger on disk indefinitely — see the security note below.
const LEGACY_LOCALSTORAGE_KEY = 'mule_dashboard_global_cps_creds';

const GlobalCpsCredentialStoreContext = createContext(null);

/**
 * GlobalCpsCredentialStoreProvider
 *
 * Holds the Global CPS BG/env/version credential matrix used by the
 * Global CPS Manager, in React state ONLY — never written to localStorage,
 * sessionStorage, or any server.
 *
 * SECURITY NOTE: this store previously persisted the matrix (plaintext
 * client secrets) to localStorage via useLocalStorageState so the Global
 * CPS Manager would survive a page refresh. That contradicted this
 * component's own user-facing copy ("loaded in memory — never stored to
 * disk", see GlobalCpsCsvUpload.jsx) and meant the secrets survived both
 * page refresh AND logout (since this provider is mounted once at the top
 * of the app and never unmounts). It has been changed to match the sibling
 * CpsCredentialStoreContext's RAM-only model: the user re-imports the CSV
 * once per session, exactly like the per-app CPS credential CSV.
 */
export function GlobalCpsCredentialStoreProvider({ children }) {
  const [globalCredentials, setGlobalCredentials] = useState([]);

  // One-time cleanup: remove any plaintext secrets a previous version of
  // this app may have already written to localStorage.
  useEffect(() => {
    try {
      localStorage.removeItem(LEGACY_LOCALSTORAGE_KEY);
    } catch { /* ignore (e.g. storage disabled) */ }
  }, []);

  const loadGlobalFromCsv = useCallback((text) => {
    const parsed = parseGlobalCpsCsv(text);
    setGlobalCredentials(parsed);
    return parsed.length;
  }, []);

  const clearCredentials = useCallback(() => {
    setGlobalCredentials([]);
  }, []);

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
