import React from 'react';
import ApiSpecPanel from '../../../components/shared/ApiSpecPanel';

/**
 * ApiSpecTab — ApplicationDetailPage's "API Spec" tab.
 *
 * Thin wrapper around the shared `ApiSpecPanel` (components/shared/) —
 * see that file's header comment for why this was extracted out of here.
 * Kept as its own file (rather than inlining ApiSpecPanel directly in
 * ApplicationDetailPage) so the tab's prop contract — `fetchPingSpec`'s
 * `(groupId, forceRefresh)` signature, used by ApplicationDetailPage's own
 * Exchange-search-by-appName flow — stays decoupled from the generic panel.
 */
export default function ApiSpecTab({ pingSpec, pingSpecLoading, fetchPingSpec }) {
  return (
    <ApiSpecPanel
      pingSpec={pingSpec}
      pingSpecLoading={pingSpecLoading}
      onRefresh={() => fetchPingSpec(null, true)}
      emptyTitle="No Exchange spec found for this application"
      emptyHint={<>The app needs an Exchange asset linked via <code className="text-gray-500 dark:text-gray-400">application.ref</code> in its ARM descriptor</>}
    />
  );
}
