import React, { useMemo } from 'react';
import { Share2, ShieldCheck, Globe, Search } from 'lucide-react';
import TableHeader from '../../../components/ui/TableHeader';
import CopyBtn from '../../../components/shared/CopyBtn';
import { GlassCard, StatTile } from '../shared';

/**
 * DependenciesTab — ApplicationDetailPage's "Dependencies" tab.
 *
 * Extracted from pages/ApplicationDetailPage.jsx — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §4 "god component" finding.
 */
export default function DependenciesTab({
  app, allProps, cpsData, cpsBaseUrl, depSearch, setDepSearch, setTab, loadCpsData,
}) {
  // The regex-scan over every ARM/CPS property (host/url detection + URL
  // parsing + internal/external classification) only depends on
  // app/allProps/cpsData — not on depSearch — so it's memoized separately
  // from the (cheap) search filter below. Without this it re-ran on every
  // keystroke in the search box — see FRONTEND_ARCHITECTURE_REVIEW.md §8
  // Performance Review, finding #1.
  const seen = useMemo(() => {
    // ── Dependency-detection helpers ──────────────────────────────────────
    // Matches property keys that typically point to upstream hosts / URLs.
    const DEP_KEY_RE = /(host|url|uri|endpoint|address|base[-_.]?url|server|upstream|callback|redirect|webhook)/i;

    const isLikelyUrl = (v) => {
      if (typeof v !== 'string' || !v.trim()) return false;
      const s = v.trim();
      if (s.startsWith('${')) return false; // unresolved placeholder
      if (/^(true|false|\d+)$/i.test(s)) return false; // booleans / plain numbers
      return (
        s.startsWith('http://') || s.startsWith('https://') ||
        /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)
      );
    };

    const classifyHost = (h) => {
      if (h.endsWith('.cloudhub.io'))
        return { type: 'CH1', label: 'CloudHub 1.0', color: 'purple', internal: true };
      if (h.endsWith('.sfdcbt.net') || h.endsWith('.msap.io') || /\.[a-z]+-[a-z0-9]+\.msap\.io$/.test(h))
        return { type: 'CH2', label: 'CloudHub 2.0', color: 'blue', internal: true };
      if (h.endsWith('.mulesoft.com') || h.includes('anypoint.mulesoft'))
        return { type: 'ANYPOINT', label: 'Anypoint Platform', color: 'cyan', internal: true };
      return { type: 'EXTERNAL', label: 'External', color: 'gray', internal: false };
    };

    const map = new Map();
    const addEntry = (key, rawVal, source) => {
      if (!DEP_KEY_RE.test(key)) return;
      const v = String(rawVal ?? '').trim();
      if (!isLikelyUrl(v)) return;
      let host;
      try {
        host = new URL(v.startsWith('http') ? v : `https://${v}`).hostname.toLowerCase();
      } catch { host = v.toLowerCase(); }
      if (!host || host === 'localhost' || host.startsWith('127.') || host.startsWith('0.0.0.')) return;
      const appNameLo = (app.name || '').toLowerCase().replace(/-/g, '');
      if (appNameLo && host.replace(/-/g, '').startsWith(appNameLo)) return;

      if (!map.has(host)) map.set(host, { host, ...classifyHost(host), refs: [], _dup: new Set() });
      const entry = map.get(host);
      const triplet = `${key}::${v}::${source}`;
      if (entry._dup.has(triplet)) return;
      entry._dup.add(triplet);
      entry.refs.push({ key, value: v, source });
    };

    // Scan all three sources
    Object.entries(allProps).forEach(([k, v]) => addEntry(k, v, 'ARM'));
    if (cpsData?.nonSecure)
      Object.entries(cpsData.nonSecure).forEach(([k, v]) => addEntry(k, v, 'CPS (non-secure)'));
    if (cpsData?.secureGroups)
      cpsData.secureGroups.forEach(g => {
        if (g.properties && typeof g.properties === 'object')
          Object.entries(g.properties).forEach(([k, v]) => addEntry(k, v, 'CPS (secure)'));
      });

    return map;
  }, [app, allProps, cpsData]);

  const { deps, searchLo } = useMemo(() => {
    let d = [...seen.values()];
    const sLo = depSearch.toLowerCase();
    if (sLo)
      d = d.filter(dep =>
        dep.host.includes(sLo) ||
        dep.refs.some(r => r.key.toLowerCase().includes(sLo) || r.value.toLowerCase().includes(sLo))
      );
    return { deps: d, searchLo: sLo };
  }, [seen, depSearch]);

  const internal = deps.filter(d => d.internal);
  const external = deps.filter(d => !d.internal);
  const total = seen.size; // unfiltered count

  const srcBadge = (source) => {
    const s = {
      'ARM': 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20',
      'CPS (non-secure)': 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60',
      'CPS (secure)': 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20',
    }[source] || 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60';
    return <span className={`text-[9px] px-1.5 py-0.5 rounded border font-mono ${s}`}>{source}</span>;
  };

  const typeBadge = (dep) => {
    const cls = {
      CH1:      'bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20',
      CH2:      'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20',
      ANYPOINT: 'bg-sfteal-50 dark:bg-sfteal-500/10 text-sfteal-700 dark:text-sfteal-300 border-sfteal-200/60 dark:border-sfteal-400/20',
      EXTERNAL: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60',
    }[dep.type] || 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60';
    return <span className={`text-[10px] px-2 py-0.5 rounded-full border font-semibold ${cls}`}>{dep.label}</span>;
  };

  const DepTable = ({ rows, title, accent }) => (
    <GlassCard icon={Share2} title={title} count={rows.length} accent={accent} noPad>
      <table className="w-full text-sm border-collapse">
        <TableHeader>
          <tr className="border-b border-gray-200/60 dark:border-gray-700/60">
            {['Host / URL', 'Type', 'Discovered via (property key → value)'].map(h => (
              <th key={h} className="px-5 py-3 text-left text-[10px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
            ))}
          </tr>
        </TableHeader>
        <tbody>
          {rows.map((dep) => (
            <tr key={dep.host} className="border-b border-gray-100 dark:border-gray-800 hover:bg-sf-50/40 dark:hover:bg-sf-500/5 transition-colors align-top">
              <td className="px-5 py-3">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-xs text-gray-700 dark:text-gray-200 break-all">{dep.host}</span>
                  <CopyBtn text={dep.host} />
                </div>
              </td>
              <td className="px-5 py-3 whitespace-nowrap">{typeBadge(dep)}</td>
              <td className="px-5 py-3">
                <div className="space-y-1.5">
                  {dep.refs.map((r, i) => (
                    <div key={i} className="flex flex-wrap items-start gap-1.5">
                      {srcBadge(r.source)}
                      <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400 break-all">{r.key}</span>
                      <span className="text-gray-400 dark:text-gray-600 text-[10px]">→</span>
                      <span className="font-mono text-[10px] text-gray-600 dark:text-gray-300 break-all">{r.value}</span>
                      <CopyBtn text={r.value} />
                    </div>
                  ))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </GlassCard>
  );

  return (
    <div className="space-y-5">
      {/* Stat tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon={Share2} label="Total Hosts" accent="teal" value={total} />
        <StatTile icon={ShieldCheck} label="Internal Apps" accent="blue" value={internal.length} sub="CH1 / CH2 / Anypoint" />
        <StatTile icon={Globe} label="External Hosts" accent="amber" value={external.length} />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm flex items-center gap-2">
            <Share2 size={14} className="text-sfteal-600 dark:text-sfteal-400" /> App Dependencies
          </h2>
          <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
            Upstream hosts and external services detected from ARM properties
            {cpsData ? ' and CPS properties' : ''}.
            {!cpsData && cpsBaseUrl && (
              <button onClick={() => { setTab('cps'); loadCpsData(); }}
                className="ml-1.5 text-sf-600 dark:text-sf-400 hover:text-sf-700 dark:hover:text-sf-300 underline underline-offset-2 font-medium">
                Load CPS to discover more
              </button>
            )}
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={13} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none" />
        <input
          value={depSearch}
          onChange={e => setDepSearch(e.target.value)}
          placeholder="Filter by host, property key, or value…"
          className="w-full bg-white/70 dark:bg-gray-900/50 border border-gray-200/70 dark:border-gray-700/60 rounded-xl pl-10 pr-4 py-2.5 text-sm text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:border-sf-400 dark:focus:border-sf-500 focus:ring-2 focus:ring-sf-500/10 shadow-sm transition-all"
        />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
        <span className="font-semibold text-gray-500 dark:text-gray-400">Sources:</span>
        <span className="px-1.5 py-0.5 rounded border bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20 font-mono">ARM</span>
        <span className="text-gray-400 dark:text-gray-500">= CloudHub deployment properties</span>
        <span className="px-1.5 py-0.5 rounded border bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60 font-mono">CPS (non-secure)</span>
        <span className="px-1.5 py-0.5 rounded border bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20 font-mono">CPS (secure)</span>
      </div>

      {deps.length === 0 && !searchLo && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sfteal-100 dark:bg-sfteal-500/10">
            <Share2 size={24} className="text-sfteal-500 dark:text-sfteal-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">No upstream dependencies detected</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs text-center max-w-sm">
            No properties containing <code className="text-gray-500 dark:text-gray-400">host</code>, <code className="text-gray-500 dark:text-gray-400">url</code>,
            <code className="text-gray-500 dark:text-gray-400"> endpoint</code>, or <code className="text-gray-500 dark:text-gray-400">uri</code> patterns were found
            with URL-like values.
            {!cpsData && cpsBaseUrl && ' Load CPS properties above to scan more sources.'}
          </p>
        </div>
      )}

      {deps.length === 0 && searchLo && (
        <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400 text-sm">
          No dependencies match <span className="ml-1 font-mono text-gray-700 dark:text-gray-300">"{depSearch}"</span>
        </div>
      )}

      {internal.length > 0 && <DepTable rows={internal} title="Internal MuleSoft Apps" accent="blue" />}
      {external.length > 0 && <DepTable rows={external} title="External Hosts" accent="amber" />}
    </div>
  );
}
