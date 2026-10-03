import React, { createContext, useContext, useMemo } from 'react';
import { useCredentialMapStore } from '../hooks/useCredentialMapStore';

const CredentialStoreContext = createContext(null);

/**
 * CredentialStoreProvider
 *
 * Holds a Map<clientId, clientSecret> in React state ONLY.
 * Credentials are NEVER written to localStorage, sessionStorage, or any
 * server — they live purely in browser RAM and are cleared on logout or
 * when the user explicitly clears them.
 *
 * Security model:
 *   - The CSV is parsed client-side; file bytes never leave the browser.
 *   - clientSecrets are not sent to the backend; only the single matched
 *     clientId+secret pair travels over HTTPS at the moment a ping fires.
 *   - On logout, the AuthContext should call clearCredentials() (or the
 *     React tree unmount handles it automatically).
 *
 * The Map/loadedCount state machine and its accessor callbacks live in the
 * shared useCredentialMapStore hook so this context stays in sync with
 * CpsCredentialStoreContext instead of maintaining an independent copy of
 * the same logic.
 */
export function CredentialStoreProvider({ children }) {
  const store = useCredentialMapStore();

  const value = useMemo(() => ({
    loadedCount: store.loadedCount,
    hasCredentials: store.hasCredentials,
    loadFromCsv: store.loadFromCsv,
    clearCredentials: store.clearCredentials,
    getSecret: store.getSecret,
    hasCredential: store.hasCredential,
    resolveFromCandidates: store.resolveFromCandidates,
  }), [
    store.loadedCount,
    store.hasCredentials,
    store.loadFromCsv,
    store.clearCredentials,
    store.getSecret,
    store.hasCredential,
    store.resolveFromCandidates,
  ]);

  return (
    <CredentialStoreContext.Provider value={value}>
      {children}
    </CredentialStoreContext.Provider>
  );
}

export function useCredentialStore() {
  const ctx = useContext(CredentialStoreContext);
  if (!ctx) {
    throw new Error('useCredentialStore must be used within a CredentialStoreProvider');
  }
  return ctx;
}
