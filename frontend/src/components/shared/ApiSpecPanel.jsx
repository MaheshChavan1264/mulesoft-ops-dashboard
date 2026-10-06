import React, { useMemo, useState } from 'react';
import {
  Globe, Activity, Package, RefreshCw, AlertTriangle, ChevronRight, ChevronDown,
  Lock, Server, Database, Search, FileWarning, Terminal,
} from 'lucide-react';
import TableHeader from '../ui/TableHeader';
import GlassCard from '../ui/Card';
import { StatTile } from '../ui/StatTile';
import SchemaTree from './SchemaTree';
import CopyBtn from './CopyBtn';
import { buildExampleRequest, CODE_SAMPLE_LANGS } from '../../utils/generateCodeSample';

const methodCls = (m) => m === 'GET' ? 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20'
  : m === 'POST' ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20'
  : m === 'PUT' ? 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20'
  : m === 'DELETE' ? 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20'
  : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200/60 dark:border-gray-700/60';

const RESPONSE_STATUS_CLS = (status) => {
  const n = parseInt(status, 10);
  if (n >= 200 && n < 300) return 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-200/60 dark:border-emerald-400/20';
  if (n >= 300 && n < 400) return 'bg-sf-50 dark:bg-sf-500/10 text-sf-700 dark:text-sf-300 border-sf-200/60 dark:border-sf-400/20';
  if (n >= 400 && n < 500) return 'bg-amber-50 dark:bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-200/60 dark:border-amber-400/20';
  if (n >= 500) return 'bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border-red-200/60 dark:border-red-400/20';
  return 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200/60 dark:border-gray-700/60';
};

function ParamTable({ title, params }) {
  if (!params?.length) return null;
  return (
    <div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">{title}</p>
      <div className="rounded-lg border border-gray-200/70 dark:border-white/[0.06] overflow-hidden">
        <table className="w-full text-xs border-collapse">
          <TableHeader>
            <tr>
              {['Name', 'Type', 'Required', 'Description', 'Example'].map(h => (
                <th key={h} className="px-3 py-2 text-left text-[9px] font-bold tracking-wider text-gray-500 dark:text-gray-400 uppercase">{h}</th>
              ))}
            </tr>
          </TableHeader>
          <tbody>
            {params.map((p) => (
              <tr key={p.name} className="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
                <td className="px-3 py-2 font-mono text-gray-800 dark:text-gray-100">{p.name}</td>
                <td className="px-3 py-2 font-mono text-sfteal-700 dark:text-sfteal-300">{p.type}{p.enum ? ` (${p.enum.join('|')})` : ''}</td>
                <td className="px-3 py-2">{p.required ? <span className="text-sforange-600 dark:text-sforange-400 font-semibold">yes</span> : <span className="text-gray-400">no</span>}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{p.description || '—'}</td>
                <td className="px-3 py-2 font-mono text-gray-400 dark:text-gray-500">{p.example || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BodySection({ title, body, schemas }) {
  if (!body?.content || Object.keys(body.content).length === 0) return null;
  const [activeType, setActiveType] = useState(Object.keys(body.content)[0]);
  const types = Object.keys(body.content);
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold">{title}</p>
        {body.required != null && (
          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-bold border ${body.required ? 'bg-sforange-50 dark:bg-sforange-500/10 text-sforange-700 dark:text-sforange-300 border-sforange-200/60 dark:border-sforange-400/20' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200/60 dark:border-gray-700/60'}`}>
            {body.required ? 'required' : 'optional'}
          </span>
        )}
        {types.length > 1 && (
          <div className="flex gap-1 ml-auto">
            {types.map((t) => (
              <button key={t} onClick={() => setActiveType(t)}
                className={`text-[9px] px-2 py-0.5 rounded-md font-mono border ${activeType === t ? 'bg-sf-600 text-white border-sf-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'}`}>
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="rounded-lg border border-gray-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-gray-900/20 p-3">
        <SchemaTree schema={body.content[activeType]?.schema} schemas={schemas} />
      </div>
    </div>
  );
}

function ResponsesSection({ responses, schemas }) {
  const statuses = Object.keys(responses || {});
  const [activeStatus, setActiveStatus] = useState(statuses[0]);
  if (!statuses.length) return null;
  const resp = responses[activeStatus];
  return (
    <div>
      <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold mb-1.5">Responses</p>
      <div className="flex gap-1.5 mb-2 flex-wrap">
        {statuses.map((s) => (
          <button key={s} onClick={() => setActiveStatus(s)}
            className={`text-[10px] px-2 py-1 rounded-lg border font-bold font-mono transition-colors ${
              activeStatus === s ? `${RESPONSE_STATUS_CLS(s)} ring-1 ring-current` : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
            }`}>
            {s}
          </button>
        ))}
      </div>
      {resp && (
        <div className="rounded-lg border border-gray-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-gray-900/20 p-3 space-y-2">
          {resp.description && <p className="text-xs text-gray-500 dark:text-gray-400">{resp.description}</p>}
          {resp.headers?.length > 0 && <ParamTable title="Response Headers" params={resp.headers} />}
          {Object.keys(resp.content || {}).length > 0 ? (
            <BodySection title="Response Body" body={{ content: resp.content }} schemas={schemas} />
          ) : (
            <p className="text-xs text-gray-400 dark:text-gray-500">No response body</p>
          )}
        </div>
      )}
    </div>
  );
}

function SecurityBadges({ security }) {
  if (!security?.length) return null;
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Lock size={11} className="text-gray-400 dark:text-gray-500" />
      {security.map((s, i) => (
        <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md font-mono font-semibold bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border border-sfpurple-200/60 dark:border-sfpurple-400/20">
          {s.name}{s.scopes?.length ? `: ${s.scopes.join(', ')}` : ''}
        </span>
      ))}
    </div>
  );
}

/**
 * CodeSample — "Code Example" section shown per endpoint, mirroring
 * Exchange's API Console. Generates a representative request (built from
 * the endpoint's params/body/security + the asset's servers/schemas via
 * `utils/generateCodeSample.js`) and renders it in the chosen language,
 * with a language switcher and copy button. Computed lazily (only once the
 * row is actually expanded) since it's non-trivial work (schema→example
 * walking) that most endpoints in a long list will never need.
 */
function CodeSample({ ep, pingSpec }) {
  const [lang, setLang] = useState('curl');
  const request = useMemo(() => buildExampleRequest(ep, pingSpec), [ep, pingSpec]);
  const activeLang = CODE_SAMPLE_LANGS.find((l) => l.id === lang) || CODE_SAMPLE_LANGS[0];
  const code = useMemo(() => activeLang.generate(request), [activeLang, request]);

  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider font-bold flex items-center gap-1">
          <Terminal size={10} /> Code Example
        </p>
        <div className="flex gap-1 ml-auto">
          {CODE_SAMPLE_LANGS.map((l) => (
            <button key={l.id} onClick={() => setLang(l.id)}
              className={`text-[9px] px-2 py-0.5 rounded-md font-semibold border transition-colors ${
                lang === l.id ? 'bg-sf-600 text-white border-sf-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
              }`}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <div className="relative group rounded-lg border border-gray-700/40 bg-terminal overflow-hidden">
        <CopyBtn text={code} fade={false} hoverColor="sf" className="absolute top-2 right-2 bg-gray-800/80 backdrop-blur-sm" />
        <pre className="px-3.5 py-3 text-[11px] font-mono text-emerald-400/90 overflow-x-auto leading-relaxed whitespace-pre">{code}</pre>
      </div>
      {!pingSpec?.servers?.length && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-1">No server URL found in spec — using a relative path; replace with your actual base URL.</p>
      )}
    </div>
  );
}

function EndpointRow({ ep, schemas, pingSpec, isPing }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`rounded-xl border ${isPing ? 'border-emerald-200/60 dark:border-emerald-400/20 bg-emerald-50/30 dark:bg-emerald-500/5' : 'border-gray-200/70 dark:border-white/[0.06]'} overflow-hidden`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left flex-wrap cursor-pointer hover:bg-gray-50/60 dark:hover:bg-white/[0.02]">
        {open ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />}
        <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${methodCls(ep.method)}`}>{ep.method}</span>
        <span className={`font-mono text-xs ${isPing ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-300'}`}>{ep.path}</span>
        {ep.deprecated && <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200/60 dark:border-red-400/20">deprecated</span>}
        {isPing && <span className="text-[9px] text-emerald-500 dark:text-emerald-400 font-semibold">● ping</span>}
        {(ep.summary || ep.description) && <span className="text-gray-400 dark:text-gray-500 text-[11px] ml-1 truncate max-w-sm">{ep.summary || ep.description}</span>}
        {ep.security?.length > 0 && <Lock size={11} className="text-gray-400 dark:text-gray-500 ml-auto" />}
      </button>
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100 dark:border-gray-800">
          {ep.description && ep.description !== ep.summary && (
            <p className="text-xs text-gray-500 dark:text-gray-400">{ep.description}</p>
          )}
          <SecurityBadges security={ep.security} />
          <ParamTable title="Path Parameters" params={ep.pathParams} />
          <ParamTable title="Query Parameters" params={ep.queryParams} />
          <ParamTable title="Headers" params={ep.headers} />
          {ep.requestBody && <BodySection title="Request Body" body={ep.requestBody} schemas={schemas} />}
          <ResponsesSection responses={ep.responses} schemas={schemas} />
          <CodeSample ep={ep} pingSpec={pingSpec} />
        </div>
      )}
    </div>
  );
}

function ReferenceGroups({ endpoints, pingEndpoints, schemas, pingSpec }) {
  const groups = useMemo(() => {
    const map = new Map();
    for (const ep of endpoints) {
      const tag = ep.tags?.[0] || 'General';
      if (!map.has(tag)) map.set(tag, []);
      map.get(tag).push(ep);
    }
    return [...map.entries()];
  }, [endpoints]);

  const isPing = (ep) => pingEndpoints?.some(p => p.path === ep.path && p.method === ep.method);

  return (
    <div className="space-y-4">
      {groups.map(([tag, eps]) => (
        <GlassCard key={tag} icon={Globe} title={tag} count={eps.length} accent="cyan" noPad>
          <div className="p-3 space-y-2">
            {eps.map((ep, i) => (
              <EndpointRow key={`${ep.method}-${ep.path}-${i}`} ep={ep} schemas={schemas} pingSpec={pingSpec} isPing={isPing(ep)} />
            ))}
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function DataTypesTab({ schemas }) {
  const [search, setSearch] = useState('');
  const names = Object.keys(schemas || {}).filter(n => n.toLowerCase().includes(search.toLowerCase()));
  if (Object.keys(schemas || {}).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
        <Database size={24} className="text-gray-400 dark:text-gray-500" />
        <p className="text-gray-500 dark:text-gray-400 text-sm">No reusable schemas found</p>
        <p className="text-gray-400 dark:text-gray-500 text-xs">This spec has no `components.schemas` / RAML `types:` to show.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="relative max-w-xs">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Filter schemas…"
          className="w-full pl-8 pr-3 py-2 text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-sf-500/20" />
      </div>
      {names.map((name) => (
        <GlassCard key={name} icon={Database} title={name} accent="purple" noPad>
          <div className="p-3">
            <SchemaTree schema={schemas[name]} schemas={schemas} name={name} visited={new Set([name])} />
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

function OverviewStrip({ pingSpec }) {
  const { info, servers, securitySchemes } = pingSpec;
  const hasInfo = info?.title || info?.description;
  const hasServers = servers?.length > 0;
  const hasSchemes = securitySchemes && Object.keys(securitySchemes).length > 0;
  if (!hasInfo && !hasServers && !hasSchemes) return null;
  return (
    <div className="rounded-2xl border border-gray-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-gray-900/30 px-4 py-3.5 space-y-2.5">
      {hasInfo && (
        <div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{info.title}{info.version ? ` · v${info.version}` : ''}</p>
          {info.description && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{info.description}</p>}
        </div>
      )}
      {hasServers && (
        <div>
          <p className="text-[9px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Server size={10} /> Servers</p>
          <div className="flex flex-wrap gap-1.5">
            {servers.map((s, i) => (
              <span key={i} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border font-mono bg-gray-50 dark:bg-gray-800/60 text-gray-600 dark:text-gray-300 border-gray-200/70 dark:border-gray-700/60">
                {s.url}
                <CopyBtn text={s.url} fade={false} />
              </span>
            ))}
          </div>
        </div>
      )}
      {hasSchemes && (
        <div>
          <p className="text-[9px] text-gray-400 dark:text-gray-500 uppercase font-bold mb-1 flex items-center gap-1"><Lock size={10} /> Security Schemes</p>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(securitySchemes).map(([name, s]) => (
              <span key={name} title={s.description} className="text-[10px] px-2 py-1 rounded-lg border font-mono bg-sfpurple-50 dark:bg-sfpurple-500/10 text-sfpurple-700 dark:text-sfpurple-300 border-sfpurple-200/60 dark:border-sfpurple-400/20">
                {name} ({s.type}{s.scheme ? `/${s.scheme}` : ''})
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * ApiSpecPanel
 *
 * Shared Exchange "API Spec" view — renders a `pingSpec` result (now
 * carrying the full detail `backend/src/utils/specParser.js` extracts:
 * `info`, `servers`, `schemas`, `securitySchemes`, and per-endpoint
 * `summary/tags/deprecated/pathParams/requestBody/responses/security`) as
 * a tag-grouped, expandable Reference view plus a "Data Types" tab for
 * reusable schemas — modeled on Anypoint Exchange's own API Console.
 *
 * Extracted out of `features/applications/tabs/ApiSpecTab.jsx` (the richer
 * of the two previously-duplicated implementations — ApiSpecTab.jsx and an
 * independent inline block in `features/exchange/ExchangePage.jsx`, which
 * silently drifted out of sync and had its own bug — see the "missing
 * getExchangePingSpec import" fix) so both pages render the exact same
 * endpoint tables, instead of two hand-maintained copies.
 *
 * Props:
 *   pingSpec         {object|null}  { specType, assetName, info, servers, schemas, securitySchemes, allEndpoints, pingEndpoints } or null
 *   pingSpecLoading  {boolean}      true while the spec is being fetched/parsed
 *   pingSpecError    {string|null}  set when the fetch itself failed (network/HTTP error) —
 *                                   rendered as a red banner, distinct from "spec has no endpoints"
 *   onRefresh        {function}     optional — if provided, shows a refresh button in the header
 *   emptyTitle       {string}       headline shown when there's no spec at all (no error, no pingSpec)
 *   emptyHint        {ReactNode}    secondary hint line under emptyTitle
 *   showStatTiles    {boolean}      show the 3 stat tiles above the header row (default true)
 *   showHeader       {boolean}      show the title/description/refresh header row (default true)
 */
export default function ApiSpecPanel({
  pingSpec, pingSpecLoading, pingSpecError, onRefresh,
  emptyTitle = 'No Exchange spec found',
  emptyHint = 'This asset may not have an OAS/RAML spec file linked in Exchange.',
  showStatTiles = true,
  showHeader = true,
}) {
  const [subTab, setSubTab] = useState('reference');
  const schemaCount = Object.keys(pingSpec?.schemas || {}).length;

  return (
    <div className="space-y-5">
      {showStatTiles && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatTile icon={Globe} label="Total Endpoints" accent="blue" value={pingSpec?.allEndpoints?.length ?? '—'} sub={pingSpec?.specType ? pingSpec.specType.toUpperCase() : undefined} />
          <StatTile icon={Activity} label="Ping / Health Paths" accent="emerald" value={pingSpec?.pingEndpoints?.length ?? '—'} />
          <StatTile icon={Package} label="Exchange Asset" accent="purple" value={pingSpec?.assetName || '—'} />
        </div>
      )}

      {showHeader && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-gray-900 dark:text-gray-100 font-semibold text-sm flex items-center gap-2">
              <Globe size={14} className="text-sf-600 dark:text-sf-400" /> API Specification — Exchange
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">
              {pingSpecLoading ? 'Searching Exchange and parsing spec…' :
                pingSpec ? <>
                  <span className="text-gray-500 dark:text-gray-400">{pingSpec.assetName}</span>
                  {' · '}{pingSpec.specType?.toUpperCase()} · {pingSpec.allEndpoints?.length ?? 0} endpoints
                  {pingSpec.pingEndpoints?.length > 0 && (
                    <span className="ml-2 text-emerald-600 dark:text-emerald-400 font-medium">
                      · {pingSpec.pingEndpoints.length} ping path{pingSpec.pingEndpoints.length !== 1 ? 's' : ''} found
                    </span>
                  )}
                </> : (pingSpecError || 'No spec available — app may not have an Exchange asset linked')}
            </p>
          </div>
          {onRefresh && (
            <button onClick={onRefresh} disabled={pingSpecLoading}
              title="Re-fetch API spec from Exchange"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 bg-gray-50/80 dark:bg-gray-800/60 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200/70 dark:border-gray-700/60 rounded-lg transition-all disabled:opacity-50">
              <RefreshCw size={11} className={pingSpecLoading ? 'animate-spin' : ''} />
              {pingSpec ? 'Refresh' : 'Fetch Spec'}
            </button>
          )}
        </div>
      )}

      {pingSpecLoading && (
        <div className="flex items-center justify-center py-16 gap-3 text-gray-500 dark:text-gray-400">
          <RefreshCw size={18} className="animate-spin" />
          <span className="text-sm">Searching Exchange and parsing API spec…</span>
        </div>
      )}

      {!pingSpecLoading && pingSpecError && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-500/10 border border-red-200/80 dark:border-red-400/30 rounded-2xl px-5 py-4">
          <AlertTriangle size={14} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-red-700 dark:text-red-300 text-sm">{pingSpecError}</p>
        </div>
      )}

      {!pingSpecLoading && !pingSpecError && !pingSpec && (
        <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white/50 dark:bg-gray-900/30 border border-gray-200/60 dark:border-gray-700/50 rounded-2xl">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-sf-100 dark:bg-sf-500/10">
            <Globe size={24} className="text-sf-500 dark:text-sf-400" />
          </div>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{emptyTitle}</p>
          <p className="text-gray-400 dark:text-gray-500 text-xs">{emptyHint}</p>
        </div>
      )}

      {pingSpec && !pingSpecLoading && !pingSpecError && (
        <>
          <OverviewStrip pingSpec={pingSpec} />

          {schemaCount > 0 && (
            <div className="flex gap-1 bg-gray-100 dark:bg-gray-900/50 rounded-xl p-1 w-fit">
              {[
                { id: 'reference', label: 'Reference', icon: Globe },
                { id: 'types', label: 'Data Types', icon: Database, badge: schemaCount },
              ].map(t => (
                <button key={t.id} onClick={() => setSubTab(t.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    subTab === t.id ? 'bg-white dark:bg-gray-700 text-sf-700 dark:text-sf-300 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100'
                  }`}>
                  <t.icon size={12} /> {t.label}
                  {t.badge > 0 && <span className="bg-sf-100 dark:bg-sf-500/20 text-sf-700 dark:text-sf-300 text-[9px] px-1.5 py-0.5 rounded-full font-bold">{t.badge}</span>}
                </button>
              ))}
            </div>
          )}

          {subTab === 'types' && schemaCount > 0 ? (
            <DataTypesTab schemas={pingSpec.schemas} />
          ) : (
            <>
              {pingSpec.allEndpoints?.length > 0 ? (
                <ReferenceGroups endpoints={pingSpec.allEndpoints} pingEndpoints={pingSpec.pingEndpoints} schemas={pingSpec.schemas || {}} pingSpec={pingSpec} />
              ) : (
                <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
                  <FileWarning size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <p className="text-amber-700 dark:text-amber-300 text-sm">No endpoints found in this spec.</p>
                </div>
              )}

              {pingSpec.pingEndpoints?.length === 0 && pingSpec.allEndpoints?.length > 0 && (
                <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-500/5 border border-amber-200/60 dark:border-amber-400/15 rounded-2xl px-5 py-4">
                  <AlertTriangle size={14} className="text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-amber-700 dark:text-amber-300 text-sm font-medium">No ping/health endpoints detected</p>
                    <p className="text-amber-600/80 dark:text-amber-400/80 text-xs mt-1">
                      The spec doesn't contain paths matching: ping, health, status, liveness, readiness, or heartbeat.
                      The dashboard will still try the standard paths: <code className="text-amber-700 dark:text-amber-300">/api/v1/ping → /api/v2/ping → /api/ping → /ping</code>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
