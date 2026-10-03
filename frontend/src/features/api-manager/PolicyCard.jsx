import React from 'react';

/**
 * PolicyCard — a single API Manager policy summary card.
 *
 * Extracted from features/api-manager/ApiManagerPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §10 folder-structure recommendation.
 */
export default function PolicyCard({ p, i }) {
  const policyName =
    p.template?.name || p.template?.assetId || p.assetId ||
    (typeof p.policyTemplateId === 'string' && isNaN(p.policyTemplateId) ? p.policyTemplateId : null) ||
    `Policy ${p.id}`;
  const rawVer = p.template?.assetVersion || p.assetVersion;
  const policyVersion = rawVer && String(rawVer).length <= 10 ? rawVer : null;
  return (
    <div key={p.id || i} className="px-5 py-3 hover:bg-gray-50/60 dark:hover:bg-white/[0.02] transition-colors">
      <div className="flex items-center justify-between gap-2">
        <p className="text-gray-900 dark:text-gray-100 text-sm font-medium capitalize truncate">{policyName.replace(/-/g, ' ')}</p>
        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold flex-shrink-0 ${p.disabled ? 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-500/10 border-red-200/80 dark:border-red-400/30' : 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200/80 dark:border-emerald-400/30'}`}>
          {p.disabled ? 'Disabled' : 'Active'}
        </span>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <p className="text-gray-400 dark:text-gray-500 text-xs font-mono truncate">{policyName}</p>
        {policyVersion && <span className="text-gray-400 dark:text-gray-500 text-[10px] bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md flex-shrink-0">v{policyVersion}</span>}
      </div>
    </div>
  );
}
