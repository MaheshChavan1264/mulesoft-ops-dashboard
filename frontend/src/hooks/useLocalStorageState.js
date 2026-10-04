import { useState, useEffect } from 'react';

/**
 * useLocalStorageState
 *
 * Collapses the "read JSON (or raw string) from localStorage with a
 * try/catch fallback, write back on change" pattern that was previously
 * reimplemented independently in ThemeContext, CpsCredentialStoreContext,
 * utils/demoMode.js and utils/filterUtils.js (x2) — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §3/§7.
 *
 * @param {string} key                       localStorage key
 * @param {*}      defaultValue               value to use when nothing is stored yet
 * @param {object} [opts]
 * @param {(v:any)=>string} [opts.serialize]   defaults to JSON.stringify
 * @param {(s:string)=>any} [opts.deserialize] defaults to JSON.parse
 * @returns {[any, (value:any)=>void]}
 */
export function useLocalStorageState(key, defaultValue, opts = {}) {
  const { serialize = JSON.stringify, deserialize = JSON.parse } = opts;

  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw != null ? deserialize(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, serialize(value));
    } catch {
      /* ignore quota / serialization errors */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value]);

  return [value, setValue];
}
