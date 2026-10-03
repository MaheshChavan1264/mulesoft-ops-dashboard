import { useState, useEffect } from 'react';

/**
 * useDebounce
 *
 * Debounces a fast-changing value (typically a search-box string) so
 * expensive filter/sort operations don't re-run on every keystroke.
 * Several search inputs across the app (GlobalSearchPage, EnvFilterModal,
 * ApplicationsPage, ApiManagerPage, CpsManagerPage) filter potentially
 * large arrays directly off raw input state with no debouncing — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §8.
 *
 * Usage:
 *   const [search, setSearch] = useState('');
 *   const debouncedSearch = useDebounce(search, 200);
 *   const filtered = useMemo(() => items.filter(i => i.name.includes(debouncedSearch)), [items, debouncedSearch]);
 *
 * @param {*} value
 * @param {number} [delayMs=200]
 * @returns {*} the debounced value
 */
export function useDebounce(value, delayMs = 200) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
