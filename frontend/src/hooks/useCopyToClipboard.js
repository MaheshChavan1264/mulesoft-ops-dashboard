import { useState, useCallback } from 'react';

/**
 * useCopyToClipboard
 *
 * Collapses the "writeText + timed `copied` flag" idiom that was
 * independently re-implemented in CopyBtn.jsx, CpsRequestResponsePanel.jsx's
 * CopyCodeBtn, and PostmanJsonViewer.jsx (missing `.catch()` in some copies)
 * — see FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #9.
 *
 * Usage:
 *   const [copied, copy] = useCopyToClipboard();
 *   <button onClick={() => copy(text)}>{copied ? 'Copied!' : 'Copy'}</button>
 *
 * @param {number} [duration=1500]  Milliseconds the "copied" flag stays true
 * @returns {[boolean, (text: string) => Promise<void>]}
 */
export function useCopyToClipboard(duration = 1500) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback((text) => {
    return navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), duration);
      },
      () => {
        // Clipboard write can be rejected (e.g. permissions, insecure
        // context) — swallow but don't flip `copied`, matching the most
        // defensive of the previous implementations.
      }
    );
  }, [duration]);

  return [copied, copy];
}
