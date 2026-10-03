import React, { createContext, useContext, useMemo } from 'react';
import { useCredentialMapStore } from '../hooks/useCredentialMapStore';

const CpsCredentialStoreContext = createContext(null);

/**
 * CpsCredentialStoreProvider
 *
 * Holds the per-app CPS CSV client-id/secret map (RAM only, cleared on
 * refresh/logout — never persisted). For the Global CPS BG/env/version
 * credential matrix (persisted to localStorage), see
 * GlobalCpsCredentialStoreContext instead.
 */
export function CpsCredentialStoreProvider({ children }) {
  const store = useCredentialMapStore();

  const value = useMemo(() => ({
    loadedCount: store.loadedCount,
    hasCredentials: store.hasCredentials,
    loadFromCsv: store.loadFromCsv,
    clearCredentials: store.clearCredentials,
    getSecret: store.getSecret,
    hasCredential: store.hasCredential,
    resolveFromCandidates: store.resolveFromCandidates,
    getAllCredentials: store.getAllCredentials,
  }), [
    store.loadedCount,
    store.hasCredentials,
    store.loadFromCsv,
    store.clearCredentials,
    store.getSecret,
    store.hasCredential,
    store.resolveFromCandidates,
    store.getAllCredentials,
  ]);

  return (
    <CpsCredentialStoreContext.Provider value={value}>
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
