/**
 * Generic "try strategy A, if it fails try strategy B, ... give up" runner.
 *
 * Extracted from the near-identical try/catch chains in routes/applications.js
 * for CH1 and CH2 scheduler-toggle / start-stop-restart actions — each of
 * those used to nest a nearly identical two-level try/catch by hand. This
 * collapses that into one call plus one catch, and makes the "list of
 * fallback strategies" shape explicit and reusable.
 *
 * @template T
 * @param {Array<() => Promise<T>>} strategies  tried in order; first to resolve wins
 * @returns {Promise<T>}
 * @throws the LAST strategy's error if every strategy rejects
 */
async function tryStrategies(strategies) {
  let lastErr;
  for (const strategy of strategies) {
    try {
      return await strategy();
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

/**
 * Wrap a single-action strategy function so that action === 'restart' is
 * handled as "try a native restart, and if that fails, stop → wait → start"
 * — the same restart-fallback shape used by both CH1 (`strategy1`/`strategy2`)
 * and conceptually by CH2.
 *
 * @param {(action: string) => Promise<any>} actionFn  performs one action ('start'|'stop'|'restart')
 * @param {string} action
 * @param {number} [waitMs=4000]  delay between stop and start when falling back
 * @returns {Promise<any>}
 */
async function runWithRestartFallback(actionFn, action, waitMs = 4000) {
  if (action !== 'restart') return actionFn(action);
  try {
    return await actionFn('restart');
  } catch {
    await actionFn('stop');
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return actionFn('start');
  }
}

module.exports = { tryStrategies, runWithRestartFallback };
