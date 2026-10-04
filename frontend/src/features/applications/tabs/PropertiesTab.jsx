import React from 'react';
import { Settings, Key, Boxes, Search, AlertTriangle } from 'lucide-react';
import TableHeader from '../../../components/ui/TableHeader';
import CopyBtn from '../../../components/shared/CopyBtn';
import {
  GlassCard, StatTile, SecretVal, NS_DOT_COLORS,
} from '../shared';

/**
 * PropertiesTab — ApplicationDetailPage's "Properties" tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function PropertiesTab({
  allProps, filteredProps, propSearch, setPropSearch, secureProps,
}) {
  const namespaceOf = (k) => (k.includes('.') ? k.slice(0, k.indexOf('.')) : 'other');
  const NS_PALETTE = ['blue', 'cyan', 'purple', 'green', 'orange', 'red'];
  const namespaceColor = (ns) => {
    let hash = 0;
    for (let i = 0; i < ns.length; i++) hash = (hash * 31 + ns.charCodeAt(i)) >>> 0;
    return NS_PALETTE[hash % NS_PALETTE.length];
  };
  const namespaceCount = new Set(Object.keys(allProps).map(namespaceOf)).size;
  return (
  <div className="space-y-5">
    {/* Stat tiles */}
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatTile icon={Settings} label="Total Properties" accent="blue" value={Object.keys(allProps).length} />
      <StatTile icon={Key} label="Secure Properties" accent="amber" value={Object.keys(secureProps).length} />
      <StatTile icon={Boxes} label="Namespaces" accent="purple" value={namespaceCount} sub="unique key prefixes" />
    </div>

    <div className="relative">
      <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"/>
      <input value={propSearch} onChange={e=>setPropSearch(e.target.value)} placeholder="Filter properties by key…"
        className="w-full bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 focus:bg-white dark:focus:bg-gray-900 transition-all shadow-sm"/>
    </div>

    <GlassCard icon={Settings} title="Properties" count={filteredProps.length} accent="blue" noPad>
      {filteredProps.length>0 ? (
        <table className="w-full text-sm border-collapse">
          <TableHeader>
            <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
              <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase w-[46%]">Property Key</th>
              <th className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">Value</th>
            </tr>
          </TableHeader>
          <tbody>
            {filteredProps.sort(([a],[b])=>a.localeCompare(b)).map(([k,v]) => (
              <tr key={k} className="group border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors">
                <td className="px-5 py-3 align-top">
                  <div className="flex items-center gap-2">
                    <span className={`flex-shrink-0 w-1.5 h-1.5 rounded-full ${NS_DOT_COLORS[namespaceColor(namespaceOf(k))]}`} title={namespaceOf(k)} />
                    <span className="text-gray-500 dark:text-gray-400 text-xs font-mono break-all leading-relaxed">{k}</span>
                    <CopyBtn text={k}/>
                  </div>
                </td>
                <td className="px-5 py-3 align-top">
                  <div className="flex items-start gap-1.5">
                    <SecretVal value={String(v)}/>
                    <CopyBtn text={String(v)}/>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
          <div className="flex items-center justify-center w-11 h-11 rounded-xl bg-gray-100 dark:bg-gray-800">
            <Search size={16} className="text-gray-400 dark:text-gray-500" />
          </div>
          <p className="text-gray-400 dark:text-gray-500 text-sm">{propSearch?`No matches for "${propSearch}"`:'No properties found'}</p>
        </div>
      )}
    </GlassCard>

    {Object.keys(secureProps).length>0 && (
      <GlassCard icon={Key} title="Secure Properties" count={Object.keys(secureProps).length} accent="orange">
        <div className="flex items-center gap-2 mb-3.5 -mt-1">
          <AlertTriangle size={12} className="text-sforange-500 dark:text-sforange-400 flex-shrink-0" />
          <span className="text-xs text-sforange-600 dark:text-sforange-400">Values are redacted by Anypoint Platform</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
          {Object.entries(secureProps).map(([k,v]) => (
            <div key={k} className="group bg-sforange-50/40 dark:bg-sforange-500/5 border border-sforange-200/50 dark:border-sforange-400/15 rounded-xl px-3.5 py-2.5">
              <p className="text-gray-500 dark:text-gray-400 text-[10px] font-mono break-all leading-relaxed mb-1">{k}</p>
              <div className="flex items-center justify-between gap-1.5">
                <SecretVal value={String(v)}/>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    )}
  </div>
  );
}
