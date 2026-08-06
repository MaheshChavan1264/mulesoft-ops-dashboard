import React, { createContext, useContext, useState, useCallback } from 'react';

const CredentialStoreContext = createContext(null);

/**
 * Parse a single CSV line, handling quoted fields and comma/semicolon delimiters.
 */
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if ((ch === ',' || ch === ';') && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

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
 */
export function CredentialStoreProvider({ children }) {
  // Map<string clientId, string clientSecret> — in-memory only
  const [credentialMap, setCredentialMap] = useState(new Map());
  const [loadedCount, setLoadedCount] = useState(0);

  /**
   * Parse a CSV text string and populate the credential map.
   * Auto-detects header row (skips if first cell is not a hex/UUID value).
   * Supports comma or semicolon delimiters and optionally quoted fields.
   * Returns the number of credential pairs loaded.
   */
  const loadFromCsv = useCallback((text) => {
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length === 0) return 0;

    // Auto-detect header: if the first cell looks like a label (not a UUID/hex),
    // skip it.
    let startIndex = 0;
    const firstCell = parseCsvLine(lines[0])[0] || '';
    const cleanFirst = firstCell.replace(/^"|"$/g, '').trim();
    // A real clientId is typically a long hex/alphanumeric string (≥16 chars, no spaces)
    const looksLikeId = /^[0-9a-zA-Z_\-]{16,}$/.test(cleanFirst);
    if (!looksLikeId) {
      startIndex = 1; // treat as header row
    }

    const map = new Map();
    for (let i = startIndex; i < lines.length; i++) {
      const parts = parseCsvLine(lines[i]);
      const clientId = (parts[0] || '').replace(/^"|"$/g, '').trim();
      const clientSecret = (parts[1] || '').replace(/^"|"$/g, '').trim();
      if (clientId && clientSecret) {
        map.set(clientId, clientSecret);
      }
    }

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
   * Given an array of candidate clientIds (returned by the backend's
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

  return (
    <CredentialStoreContext.Provider
      value={{
        loadedCount,
        hasCredentials: loadedCount > 0,
        loadFromCsv,
        clearCredentials,
        getSecret,
        hasCredential,
        resolveFromCandidates,
      }}
    >
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