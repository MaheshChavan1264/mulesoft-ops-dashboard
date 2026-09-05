import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import api from '../services/api.js';
import { applyBgFilter } from '../components/BgFilterModal.jsx';
import { applyEnvFilter } from '../components/EnvFilterModal.jsx';
import CpsCredentialImportButton from '../components/CpsCredentialImportButton.jsx';
import Skeleton from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext.jsx';

const NODE_W = 170, NODE_H = 38, ROW_GAP = 54, COL_APP = 40, COL_API = 700, CANVAS_PADDING = 60;

function appColors(status) {
  const s = (status || '').toUpperCase();
  if (s === 'RUNNING' || s === 'STARTED')       return { fill: '#064e3b', stroke: '#10b981', text: '#6ee7b7' };
  if (s === 'FAILED'  || s === 'DEPLOY_FAILED') return { fill: '#7f1d1d', stroke: '#ef4444', text: '#fca5a5' };
  if (s === 'DEPLOYING'|| s === 'STARTING')     return { fill: '#1e3a5f', stroke: '#3b82f6', text: '#93c5fd' };
  if (s === 'STOPPED' || s === 'UNDEPLOYED')    return { fill: '#1f2937', stroke: '#6b7280', text: '#9ca3af' };
  return { fill: '#1f2937', stroke: '#4b5563', text: '#9ca3af' };
}

function computeLayout(nodes, edges) {
  // Source apps (have outgoing edges) go left; target apps + external go right
  const sourceIds = new Set(edges.map(e => e.source));
  const targetIds = new Set(edges.map(e => e.target));
  // Nodes that are ONLY targets go right; source nodes go left
  // Nodes that are both source and target go left
  const left  = nodes.filter(n => sourceIds.has(n.id));
  const right = nodes.filter(n => !sourceIds.has(n.id) && targetIds.has(n.id));
  // Sort right by incoming edge count (most connected first)
  const cnt = {};
  edges.forEach(e => { cnt[e.target] = (cnt[e.target] || 0) + 1; });
  right.sort((a, b) => (cnt[b.id] || 0) - (cnt[a.id] || 0));
  const posMap = {};
  left.forEach((n, i)  => { posMap[n.id] = { x: COL_APP, y: CANVAS_PADDING + i * ROW_GAP }; });
  right.forEach((n, i) => { posMap[n.id] = { x: COL_API, y: CANVAS_PADDING + i * ROW_GAP }; });
  return { posMap, canvasH: Math.max(left.length, right.length) * ROW_GAP + CANVAS_PADDING * 2 };
}

function Markers({ mid }) {
  return (
    <defs>
      <marker id={`${mid}-n`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#374151" />
      </marker>
      <marker id={`${mid}-h`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#60a5fa" />
      </marker>
      <marker id={`${mid}-ext`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#f59e0b" />
      </marker>
      <marker id={`${mid}-exth`} markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="#fbbf24" />
      </marker>
    </defs>
  );
}

function Edge({ edge, posMap, highlighted, faded, mid }) {
  const s = posMap[edge.source], t = posMap[edge.target];
  if (!s || !t) return null;
  const x1 = s.x + NODE_W, y1 = s.y + NODE_H / 2, x2 = t.x, y2 = t.y + NODE_H / 2, cx = (x1 + x2) / 2;
  const isExt = edge.edgeType === 'external';
  const stroke = isExt
    ? (highlighted ? '#fbbf24' : '#92400e')
    : (highlighted ? '#60a5fa' : '#374151');
  const markerId = isExt
    ? `${mid}-${highlighted ? 'exth' : 'ext'}`
    : `${mid}-${highlighted ? 'h' : 'n'}`;
  return (
    <g opacity={faded ? 0.12 : 1}>
      <path d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
        fill="none" stroke={stroke} strokeWidth={highlighted ? 2 : 1}
        strokeDasharray={isExt ? '4 3' : undefined}
        markerEnd={`url(#${markerId})`} />
      {highlighted && edge.cpsKey && (
        <text x={cx} y={(y1 + y2) / 2 - 5} fontSize="9"
          fill={isExt ? '#fcd34d' : '#93c5fd'} textAnchor="middle">
          {edge.cpsKey.length > 24 ? '…' + edge.cpsKey.slice(-22) : edge.cpsKey}
        </text>
      )}
    </g>
  );
}

function AppNode({ node, pos, selected, faded, onClick }) {
  const c = appColors(node.status);
  const lbl = node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label;
  return (
    <g transform={`translate(${pos.x},${pos.y})`} opacity={faded ? 0.22 : 1} onClick={() => onClick(node)} style={{ cursor: 'pointer' }}>
      <rect width={NODE_W} height={NODE_H} rx={6} fill={c.fill} stroke={selected ? '#60a5fa' : c.stroke} strokeWidth={selected ? 2 : 1} />
      <circle cx={14} cy={NODE_H / 2} r={4} fill={c.stroke} />
      <text x={26} y={NODE_H / 2 + 1} dominantBaseline="middle" fontSize="11" fill={c.text} fontFamily="monospace">{lbl}</text>
      {node.deploymentType && <text x={NODE_W - 4} y={NODE_H - 4} fontSize="8" fill={c.text} textAnchor="end" opacity={0.6}>{node.deploymentType}</text>}
    </g>
  );
}

// External endpoint node — amber dashed, globe icon style
function ExternalNode({ node, pos, selected, faded, onClick }) {
  const lbl = node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label;
  return (
    <g transform={`translate(${pos.x},${pos.y})`} opacity={faded ? 0.22 : 1} onClick={() => onClick(node)} style={{ cursor: 'pointer' }}>
      <rect width={NODE_W} height={NODE_H} rx={6} fill="#1c0f02" stroke={selected ? '#60a5fa' : '#b45309'} strokeWidth={selected ? 2 : 1} strokeDasharray="4 2" />
      <circle cx={14} cy={NODE_H / 2} r={4} fill="#f59e0b" />
      <text x={26} y={NODE_H / 2 + 1} dominantBaseline="middle" fontSize="11" fill="#fcd34d" fontFamily="monospace">{lbl}</text>
      <text x={NODE_W - 4} y={NODE_H - 4} fontSize="8" fill="#f59e0b" textAnchor="end" opacity={0.8}>ext</text>
    </g>
  );
}

function DetailPanel({ node, edges, nodes, onClose }) {
  if (!node) return null;
  const outgoing = edges.filter(e => e.source === node.id).map(e => ({ edge: e, peer: nodes.find(n => n.id === e.target) }));
  const incoming = edges.filter(e => e.target === node.id).map(e => ({ edge: e, peer: nodes.find(n => n.id === e.source) }));
  const badge = node.type === 'external'
    ? 'bg-amber-900/60 text-amber-300'
    : 'bg-green-900/60 text-green-300';
  const typeLabel = node.type === 'external' ? 'External Endpoint' : 'Mule App';
  return (
    <div className="w-72 shrink-0 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto text-sm">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badge}`}>{typeLabel}</span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
      </div>
      <p className="font-mono text-white font-semibold text-sm break-all mb-3">{node.label}</p>
      {node.status && node.type !== 'external' && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
          <p className="text-xs text-gray-300">{node.status}</p>
        </div>
      )}
      {node.type === 'external' && node.meta?.exampleUrl && (
        <div className="mb-3 px-2 py-1.5 bg-amber-900/20 border border-amber-800/40 rounded text-xs text-amber-400 break-all">
          {node.meta.exampleUrl}
        </div>
      )}
      {node.meta && (
        <div className="mb-3 space-y-1">
          {Object.entries(node.meta)
            .filter(([k, v]) => v && k !== 'exampleUrl')
            .map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-xs text-gray-500 shrink-0">{k}</span>
                <span className="text-xs text-gray-300 font-mono break-all text-right">{v}</span>
              </div>
            ))}
        </div>
      )}
      {outgoing.length > 0 && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Calls {outgoing.length} service(s)</p>
          <div className="space-y-1.5">
            {outgoing.map(({ edge, peer }) => (
              <div key={edge.id} className="bg-gray-800 rounded p-2">
                <p className="text-xs text-gray-300 font-mono truncate">{peer?.label || edge.targetName || '—'}</p>
                {edge.cpsKey && (
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate" title={edge.cpsKey}>
                    via <span className={edge.edgeType === 'external' ? 'text-amber-400/80' : 'text-blue-400/80'}>{edge.cpsKey}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
      {incoming.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Called by {incoming.length} app(s)</p>
          <div className="space-y-1.5">
            {incoming.map(({ edge, peer }) => (
              <div key={edge.id} className="bg-gray-800 rounded p-2">
                <p className="text-xs text-gray-300 font-mono truncate">{peer?.label || edge.appName || '—'}</p>
                {edge.cpsKey && (
                  <p className="text-[10px] text-gray-500 font-mono mt-0.5 truncate" title={edge.cpsKey}>
                    via <span className="text-blue-400/80">{edge.cpsKey}</span>
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiGraphPage() {
  const { getAllCredentials, hasCredentials } = useCpsCredentialStore();
  const [orgs, setOrgs]               = useState([]);
  const [envs, setEnvs]               = useState([]);
  const [selectedOrg, setSelectedOrg] = useState('');
  const [selectedEnv, setSelectedEnv] = useState('');
  const [graph, setGraph]             = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [selectedNode, setSelectedNode] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');
  const mid = useMemo(() => `arr-${Math.random().toString(36).slice(2, 8)}`, []);
  const [xf, setXf]    = useState({ scale: 1, x: 0, y: 0 });
  const panning        = useRef(false);
  const panOrigin      = useRef({ x: 0, y: 0 });
  const svgRef         = useRef(null);

  useEffect(() => {
    api.get('/organizations/business-groups').then(res => {
      const list = res.data?.data || res.data || [];
      const all = Array.isArray(list) ? list : [list];
      const f = applyBgFilter(all);
      setOrgs(f.length ? f : all);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedOrg) return;
    setSelectedEnv(''); setEnvs([]);
    api.get(`/environments/${selectedOrg}`).then(res => {
      const list = res.data?.data || res.data || [];
      const all = Array.isArray(list) ? list : [];
      const f = applyEnvFilter(all);
      setEnvs(f.length ? f : all);
    }).catch(() => {});
  }, [selectedOrg]);

  const loadGraph = useCallback(async (forceRefresh = false) => {
    if (!selectedOrg || !selectedEnv) return;
    setLoading(true); setError(null); setGraph(null); setSelectedNode(null); setXf({ scale: 1, x: 0, y: 0 });
    try {
      // Post all loaded CSV credentials to the backend session before scanning.
      // Stored as "graph-scan::{clientId}" so getSessionCpsCred can find them
      // as a last-resort fallback — this covers the case where the user imported
      // a CPS CSV but hasn't visited CPS Manager/Comparison yet (which normally
      // triggers the credential-to-session posting).
      const allCreds = getAllCredentials();
      if (allCreds.length > 0) {
        const credMap = {};
        allCreds.forEach(({ clientId, clientSecret }) => {
          credMap[`graph-scan::${clientId}`] = { clientId, clientSecret };
        });
        await api.post('/cps/credentials', { credentials: credMap }).catch(() => {});
      }

      const params = { orgId: selectedOrg, envId: selectedEnv };
      if (forceRefresh) params.noCache = 'true';
      const res = await api.get('/graph/dependencies', { params });
      console.log('[ApiGraph] debug:', res.data?.debug);
      setGraph(res.data);
    } catch (err) { setError(err); }
    finally { setLoading(false); }
  }, [selectedOrg, selectedEnv, getAllCredentials]);

  const onWheel = useCallback((e) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 0.9 : 1.1;
    setXf(p => ({ ...p, scale: Math.min(3, Math.max(0.2, p.scale * f)) }));
  }, []);
  const onMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    panning.current = true;
    panOrigin.current = { x: e.clientX - xf.x, y: e.clientY - xf.y };
  }, [xf]);
  const onMouseMove = useCallback((e) => {
    if (!panning.current) return;
    setXf(p => ({ ...p, x: e.clientX - panOrigin.current.x, y: e.clientY - panOrigin.current.y }));
  }, []);
  const onMouseUp = useCallback(() => { panning.current = false; }, []);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  const visibleNodes = graph
    ? filterStatus === 'all'
      ? graph.nodes
      : graph.nodes.filter(n => n.type === 'external' || (n.status || '').toUpperCase() === filterStatus)
    : [];
  const visNodeIds = new Set(visibleNodes.map(n => n.id));
  const visEdges   = graph ? graph.edges.filter(e => visNodeIds.has(e.source) && visNodeIds.has(e.target)) : [];
  const { posMap, canvasH } = graph ? computeLayout(visibleNodes, visEdges) : { posMap: {}, canvasH: 300 };

  const connectedIds = new Set(), hiEdges = new Set();
  if (selectedNode?.id) {
    const sid = selectedNode.id;
    connectedIds.add(sid);
    visEdges.forEach(e => {
      if (e.source === sid || e.target === sid) { connectedIds.add(e.source); connectedIds.add(e.target); hiEdges.add(e.id); }
    });
  }

  const orgName = orgs.find(o => o.id === selectedOrg)?.name || '';
  const envName = envs.find(e => e.id === selectedEnv)?.name || '';
  const trueEmpty   = graph && !graph.noCpsCredentials && graph.nodes.length === 0;
  const filterEmpty = graph && !graph.noCpsCredentials && graph.nodes.length > 0 && visibleNodes.length === 0;
  const selId       = selectedNode?.id;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 bg-gray-900 shrink-0 flex-wrap">
        <span className="text-sm font-semibold">🕸️ API Dependency Graph</span>
        <CpsCredentialImportButton compact />
        {hasCredentials && <span className="text-[10px] text-emerald-400 bg-emerald-900/30 border border-emerald-700/40 px-2 py-0.5 rounded-full">🔑 CPS creds loaded</span>}
        {!hasCredentials && <span className="text-[10px] text-yellow-500/80">⚠ Import CPS CSV first</span>}
        <select value={selectedOrg} onChange={e => setSelectedOrg(e.target.value)} className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500">
          <option value="">Business Group…</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
        <select value={selectedEnv} onChange={e => setSelectedEnv(e.target.value)} disabled={!selectedOrg} className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-40">
          <option value="">Environment…</option>
          {envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button onClick={() => loadGraph(false)} disabled={!selectedOrg || !selectedEnv || loading}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded font-medium transition-colors">
          {loading ? 'Scanning CPS…' : 'Build Graph'}
        </button>
        {graph && !graph.noCpsCredentials && (
          <button onClick={() => loadGraph(true)} disabled={loading}
            title="Force refresh (bypass 2-min cache)"
            className="px-2 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-40 text-gray-300 text-xs rounded transition-colors">
            ↺ Refresh
          </button>
        )}
        {graph && !graph.noCpsCredentials && (
          <>
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-gray-400">Filter:</span>
              {['all', 'RUNNING', 'FAILED', 'STOPPED'].map(s => (
                <button key={s} onClick={() => setFilterStatus(s)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}>
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
              <span>🟩 {graph.summary.apps} apps</span>
              {graph.summary.endpoints > 0 && <span className="text-amber-500">🟠 {graph.summary.endpoints} external</span>}
              <span>→ {graph.summary.edges} connections</span>
              {graph.summary.internalEdges > 0 && <span className="text-blue-400">({graph.summary.internalEdges} internal)</span>}
              {graph.summary.externalEdges > 0 && <span className="text-amber-500">({graph.summary.externalEdges} ext)</span>}
              {graph.cached && <span className="text-gray-600 italic">cached</span>}
            </div>
          </>
        )}
      </div>

      {error && <div className="px-5 pt-3 shrink-0"><ErrorBanner error={error} onRetry={() => loadGraph(false)} /></div>}

      <div className="flex flex-1 min-h-0">
        <div className="flex-1 overflow-hidden relative">
          {/* Zoom buttons */}
          {graph && visibleNodes.length > 0 && (
            <div className="absolute top-4 right-4 z-10 flex flex-col gap-1">
              <button onClick={() => setXf(p => ({ ...p, scale: Math.min(3, p.scale * 1.25) }))} className="w-7 h-7 bg-gray-800 border border-gray-700 rounded text-white hover:bg-gray-700 flex items-center justify-center" title="Zoom in">+</button>
              <button onClick={() => setXf(p => ({ ...p, scale: Math.max(0.2, p.scale * 0.8) }))} className="w-7 h-7 bg-gray-800 border border-gray-700 rounded text-white hover:bg-gray-700 flex items-center justify-center" title="Zoom out">−</button>
              <button onClick={() => setXf({ scale: 1, x: 0, y: 0 })} className="w-7 h-7 bg-gray-800 border border-gray-700 rounded text-gray-400 hover:bg-gray-700 flex items-center justify-center text-xs" title="Reset">⊙</button>
              {xf.scale !== 1 && <span className="text-center text-xs text-gray-600">{Math.round(xf.scale * 100)}%</span>}
            </div>
          )}

          {loading && (
            <div className="space-y-2 p-6">
              <p className="text-xs text-gray-500 mb-3">Fetching CPS properties for all deployed apps…</p>
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full max-w-2xl" />
              ))}
            </div>
          )}


          {!loading && !graph && !error && (
            <EmptyState icon="🕸️" title="No graph loaded"
              description="Select a Business Group and Environment, then click Build Graph. CPS credentials must be imported first." />
          )}

          {!loading && filterEmpty && (
            <EmptyState icon="🔍" title={`No "${filterStatus}" apps`}
              description='The status filter removed all app nodes. Click "All" to see the full graph.' />
          )}

          {!loading && trueEmpty && (
            <div className="p-6 max-w-2xl mx-auto space-y-4">
              <div className="flex items-start gap-4 bg-gray-900 border border-gray-700 rounded-xl p-5">
                <div className="text-3xl flex-shrink-0">🔍</div>
                <div>
                  <p className="text-white font-semibold text-sm mb-1">No CPS connections found</p>
                  <p className="text-gray-400 text-xs leading-relaxed">
                    The scan completed but no connections were discovered. Common reasons:
                  </p>
                  <ul className="text-gray-500 text-xs mt-2 space-y-1 list-disc pl-4">
                    <li>Apps don't have <code className="text-gray-400">cps.configServerBaseUrl</code> in their ARM properties</li>
                    <li>CPS credentials don't have access to the apps' project keys</li>
                    <li>CPS non-secure properties don't contain URL values pointing to other apps</li>
                    <li>URLs in CPS properties don't match the deployed app names in this environment</li>
                  </ul>
                </div>
              </div>
              {graph.debug && (
                <div className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs font-mono space-y-2">
                  <p className="text-gray-300 font-semibold mb-1">Scan diagnostics</p>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <span className="text-gray-500">Deployed apps found</span>
                    <span className={graph.debug.ch2Apps + graph.debug.ch1Apps > 0 ? 'text-green-400' : 'text-red-400'}>
                      {(graph.debug.ch2Apps || 0) + (graph.debug.ch1Apps || 0)} ({graph.debug.ch2Apps || 0} CH2, {graph.debug.ch1Apps || 0} CH1)
                    </span>
                    <span className="text-gray-500">Apps with CPS config</span>
                    <span className={graph.debug.cpsConfigFound > 0 ? 'text-green-400' : 'text-red-400'}>
                      {graph.debug.cpsConfigFound || 0}
                      {graph.debug.cpsConfigFound === 0 && ' ← no cps.configServerBaseUrl found'}
                    </span>
                    <span className="text-gray-500">Secure groups scanned</span>
                    <span className={graph.debug.secureGroupsScanned > 0 ? 'text-green-400' : 'text-yellow-400'}>
                      {graph.debug.secureGroupsScanned || 0}
                      {graph.debug.secureGroupsScanned === 0 && graph.debug.cpsConfigFound > 0 && ' ← no cps.secure.properties found'}
                    </span>
                    <span className="text-gray-500">URL/host values found</span>
                    <span className={graph.debug.cpsUrlsFound > 0 ? 'text-green-400' : 'text-yellow-400'}>
                      {graph.debug.cpsUrlsFound || 0}
                    </span>
                    <span className="text-gray-500">Edges discovered</span>
                    <span className="text-gray-400">{graph.debug.edges || 0}</span>
                  </div>
                  {graph.debug.errors?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-800">
                      <p className="text-yellow-400 mb-1">Fetch errors ({graph.debug.errors.length}) — first 5:</p>
                      {graph.debug.errors.slice(0, 5).map((e, i) => (
                        <p key={i} className="text-red-400 pl-2 truncate text-[10px]">{e}</p>
                      ))}
                    </div>
                  )}
                  <p className="text-gray-700 text-[10px] mt-2 pt-2 border-t border-gray-800">
                    Tip: Use ↺ Refresh (noCache) to bypass the 2-min cache after fixing credentials.
                  </p>
                </div>
              )}
            </div>
          )}

          {!loading && graph && !graph.noCpsCredentials && visibleNodes.length > 0 && (
            <div className="w-full h-full overflow-hidden">
              <div className="flex items-center gap-4 px-4 pt-3 pb-1 text-xs text-gray-400 shrink-0 flex-wrap">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-700 border border-green-500" /> Running</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-900 border border-red-500" /> Failed</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-gray-700 border border-gray-500" /> Stopped</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-amber-900 border border-amber-600" style={{ borderStyle: 'dashed' }} /> External</span>
                <span className="flex items-center gap-1"><span className="text-blue-400">→</span> Internal call</span>
                <span className="flex items-center gap-1"><span className="text-amber-500">⤳</span> External call</span>
                {orgName && <span className="ml-auto text-gray-500">{orgName} / {envName}</span>}
                <span className="text-gray-600 text-xs">Scroll to zoom · Drag to pan · Click node for details</span>
              </div>
              <svg
                ref={svgRef}
                width="100%"
                height={canvasH + 28}
                style={{ display: 'block', userSelect: 'none' }}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onMouseLeave={onMouseUp}
              >
                <Markers mid={mid} />
                <g transform={`translate(${xf.x},${xf.y}) scale(${xf.scale})`}>
                  {visEdges.map(edge => (
                    <Edge key={edge.id} edge={edge} posMap={posMap} mid={mid}
                      highlighted={hiEdges.has(edge.id)}
                      faded={selId != null && !hiEdges.has(edge.id)} />
                  ))}
                  {visibleNodes.map(node => {
                    const pos = posMap[node.id];
                    if (!pos) return null;
                    const isFaded = selId != null && !connectedIds.has(node.id);
                    const isSel = node.id === selId;
                    const toggle = n => setSelectedNode(prev => prev?.id === n.id ? null : n);
                    if (node.type === 'external') {
                      return <ExternalNode key={node.id} node={node} pos={pos} selected={isSel} faded={isFaded} onClick={toggle} />;
                    }
                    return <AppNode key={node.id} node={node} pos={pos} selected={isSel} faded={isFaded} onClick={toggle} />;
                  })}
                </g>
              </svg>
            </div>
          )}
        </div>

        {selectedNode && (
          <DetailPanel node={selectedNode} edges={visEdges} nodes={visibleNodes} onClose={() => setSelectedNode(null)} />
        )}
      </div>
    </div>
  );
}
