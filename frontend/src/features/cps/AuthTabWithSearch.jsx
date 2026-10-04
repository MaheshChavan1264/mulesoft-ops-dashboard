import React, { useState } from 'react';
import { Search, X, ShieldCheck } from 'lucide-react';
import CpsAuthPanel from './CpsAuthPanel';

// ─────────────────────────────────────────────────────────────────────────────
// AuthTabWithSearch — Access Control tab with project-key search at the top
//
// Extracted from pages/CpsManagerPage.jsx — see
// FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding. Used by both
// CpsManagerPage and GlobalCpsManagerPage.
// ─────────────────────────────────────────────────────────────────────────────
export function AuthTabWithSearch({ cpsBaseUrl, cpsEnv, cpsKey, secureGroups, resolvedBgId, setLastOperation }) {
  const [keySearch, setKeySearch] = useState('');

  const q = keySearch.trim().toLowerCase();

  // Build list of all auth sections: non-secure + secure groups
  const allSections = [
    { type: 'non-secure', key: cpsKey, label: 'Non-Secure' },
    ...secureGroups.map(g => ({ type: 'secure', key: g.key, label: 'Secure' })),
  ];

  const visibleSections = q
    ? allSections.filter(s => s.key.toLowerCase().includes(q))
    : allSections;

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          value={keySearch}
          onChange={e => setKeySearch(e.target.value)}
          placeholder="Search project key…"
          className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl pl-9 pr-10 py-2.5 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 shadow-sm focus:outline-none focus:border-sf-500 dark:focus:border-sf-400 focus:ring-2 focus:ring-sf-500/15 transition-all"
        />
        {keySearch && (
          <button
            onClick={() => setKeySearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {/* Count hint */}
      {q && (
        <p className="text-[10px] text-gray-400 dark:text-gray-500">
          {visibleSections.length === 0
            ? `No sections match "${keySearch}"`
            : `${visibleSections.length} of ${allSections.length} section${allSections.length !== 1 ? 's' : ''} shown`}
        </p>
      )}

      {/* Auth sections */}
      {visibleSections.map(section => (
        <div
          key={`${section.type}::${section.key}`}
          className={`bg-white dark:bg-gradient-to-b dark:from-gray-800 dark:to-gray-800/90 rounded-2xl shadow-sm dark:shadow-[0_8px_30px_-6px_rgba(0,0,0,0.5)] overflow-hidden ${
            section.type === 'secure'
              ? 'border border-sforange-200/60 dark:border-sforange-400/20'
              : 'border border-gray-200 dark:border-white/[0.07]'
          }`}
        >
          <div className={`px-4 py-2.5 border-b flex items-center gap-2 ${
            section.type === 'secure'
              ? 'bg-sforange-50/60 dark:bg-sforange-500/[0.06] border-sforange-200/50 dark:border-sforange-400/20'
              : 'bg-gray-50 dark:bg-gray-900/40 border-gray-200 dark:border-white/10'
          }`}>
            <span className={`flex items-center justify-center w-6 h-6 rounded-lg flex-shrink-0 ${
              section.type === 'secure'
                ? 'bg-sforange-100 dark:bg-sforange-500/15 text-sforange-600 dark:text-sforange-400'
                : 'bg-sf-100 dark:bg-sf-500/15 text-sf-600 dark:text-sf-400'
            }`}>
              <ShieldCheck size={12} />
            </span>
            <span className={`text-xs font-semibold ${section.type === 'secure' ? 'text-sforange-700 dark:text-sforange-300' : 'text-sf-700 dark:text-sf-300'}`}>
              {section.label}
            </span>
            <code className="text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700/60 px-1.5 py-0.5 rounded-md ml-1 font-mono">{section.key}</code>
          </div>
          <div className="p-5">
            <CpsAuthPanel
              baseUrl={cpsBaseUrl}
              type={section.type}
              environment={cpsEnv}
              projectKey={section.key}
              bgOrgId={resolvedBgId}
              onResult={setLastOperation}
            />
          </div>
        </div>
      ))}

      {visibleSections.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 gap-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/[0.07] rounded-2xl shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700/50 flex items-center justify-center">
            <Search size={20} className="text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">No project keys match "{keySearch}"</p>
        </div>
      )}
    </div>
  );
}

export default AuthTabWithSearch;
