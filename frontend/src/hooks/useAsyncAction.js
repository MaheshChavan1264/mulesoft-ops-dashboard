import { useState, useCallback } from 'react';
import { getErrorMessage } from '../services/http';

/**
 * useAsyncAction
 *
 * Collapses the loading/error state + try/catch/finally boilerplate that
 * was previously hand-copied into CpsAuthPanel, CpsBinaryUploadPanel,
 * CpsCreateModal, CpsDeleteProjectModal, CpsImportModal, CpsSettingsModal
 * and most page-level async handlers — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §3.
 *
 * Usage:
 *   const { loading, error, setError, run } = useAsyncAction();
 *   const handleSave = () => run(async () => {
 *     const resp = await api.post('/cps/write', payload);
 *     onSaved?.(resp.data);
 *   });
 *
 * @returns {{
 *   loading: boolean,
 *   error: string,
 *   setError: (msg: string) => void,
 *   run: (fn: () => Promise<any>) => Promise<any|undefined>
 * }}
 */
export function useAsyncAction() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const run = useCallback(async (fn) => {
    setLoading(true);
    setError('');
    try {
      return await fn();
    } catch (e) {
      setError(getErrorMessage(e, 'Something went wrong'));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  return { loading, error, setError, run };
}
