import React, { createContext, useContext, useState, useCallback } from 'react';

const CpsCredentialStoreContext = createContext(null);

function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if ((ch === ',' || ch === ';') && !inQuotes) { result.push(current.trim()); current = ''; }
    else { current += ch; }
  }
  result.push(current.trim());
  return result;
}

/**
 * CpsCredentialStoreProvider
 *
 * Separate credential store for CPS (Config Property Server) client credentials.
 * Holds a Map<clientId, clientSecret> in React state ONLY — never persisted.
 *
 * These are CPS server credentials, distinct from the API Manager contract
 * credentials used by the Ping Test feature.
 */
export function CpsCredentialStoreProvider({ children }) {
  const [credentialMap, setCredentialMap] = useState(new Map());
  const [loadedCount, setLoadedCount] = useState(0);

  const loadFromCsv = useCallback((text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return 0;

    let startIndex = 0;
    const firstCell = parseCsvLine(lines[0])[0] || '';
    const cleanFirst = firstCell.replace(/^"|"$/g, '').trim();
    const looksLikeId = /^[0-9a-zA-Z_\-]{16,}$/.test(cleanFirst);
    if (!looksLikeId) startIndex = 1;

    const map = new Map();
    for (let i = startIndex; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]);
      const clientId = (parts[0] || '').replace(/^"|"$/g, '').trim();
      const clientSecret = (parts[1] || '').replace(/^"|"$/g, '').trim();
      if (clientId && clientSecret) map.set(clientId, clientSecret);
    }

    setCredentialMap(map);
    setLoadedCount(map.size);
    return map.size;
  }, []);

  const clearCredentials = useCallback(() => {
    setCredentialMap(new Map());
    setLoadedCount(0);
  }, []);

  const getSecret = useCallback((clientId) => credentialMap.get(clientId) ?? null, [credentialMap]);
  const hasCredential = useCallback((clientId) => credentialMap.has(clientId), [credentialMap]);
  const resolveFromCandidates = useCallback((candidates = []) => {
    for (const id of candidates) {
      const secret = credentialMap.get(id);
      if (secret) return { clientId: id, clientSecret: secret };
    }
    return null;
  }, [credentialMap]);
  /** Return all { clientId, clientSecret } pairs — used for URL-based fallback resolution. */
  const getAllCredentials = useCallback(
    () => Array.from(credentialMap.entries()).map(([id, secret]) => ({ clientId: id, clientSecret: secret })),
    [credentialMap]
  );

  return (
    <CpsCredentialStoreContext.Provider value={{
      loadedCount,
      hasCredentials: loadedCount > 0,
      loadFromCsv,
      clearCredentials,
      getSecret,
      hasCredential,
      resolveFromCandidates,
      getAllCredentials,
    }}>
      {children}
    </CpsCredentialStoreContext.Provider>
  );
}

export function useCpsCredentialStore() {
  const ctx = useContext(CpsCredentialStoreContext);
  if (!ctx) throw new Error('useCpsCredentialStore must be used within a CpsCredentialStoreProvider');
  return ctx;
}