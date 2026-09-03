import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api.js';
import Skeleton from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';

// ── Layout constants ──────────────────────────────────────────────────────────
const NODE_W = 170;
const NODE_H = 38;
const ROW_GAP = 54;
const COL_APP = 40;
const COL_API = 700;
const CANVAS_PADDING = 60;

// ── Status → fill/text colours ────────────────────────────────────────────────
function appColors(status) {
  const s = (status || '').toUpperCase();
  if (s === 'RUNNING' || s === 'STARTED')         return { fill: '#064e3b', stroke: '#10b981', text: '#6ee7b7' };
  if (s === 'FAILED'  || s === 'DEPLOY_FAILED')   return { fill: '#7f1d1d', stroke: '#ef4444', text: '#fca5a5' };
  if (s === 'DEPLOYING'|| s === 'STARTING')       return { fill: '#1e3a5f', stroke: '#3b82f6', text: '#93c5fd' };
  if (s === 'STOPPED' || s === 'UNDEPLOYED')      return { fill: '#1f2937', stroke: '#6b7280', text: '#9ca3af' };
  return                                               { fill: '#1f2937', stroke: '#4b5563', text: '#9ca3af' };
}

// ── Compute bipartite layout positions ───────────────────────────────────────
function computeLayout(nodes, edges) {
  const appNodes = nodes.filter(n => n.type === 'app');
  const apiNodes = nodes.filter(n => n.type === 'api');

  // Sort APIs by number of incoming edges (most-connected first)
  const apiEdgeCount = {};
  edges.forEach(e => { apiEdgeCount[e.target] = (apiEdgeCount[e.target] || 0) + 1; });
  apiNodes.sort((a, b) => (apiEdgeCount[b.id] || 0) - (apiEdgeCount[a.id] || 0));

  const posMap = {};
  appNodes.forEach((n, i) => {
    posMap[n.id] = { x: COL_APP, y: CANVAS_PADDING + i * ROW_GAP };
  });
  apiNodes.forEach((n, i) => {
    posMap[n.id] = { x: COL_API, y: CANVAS_PADDING + i * ROW_GAP };
  });

  const canvasH = Math.max(appNodes.length, apiNodes.length) * ROW_GAP + CANVAS_PADDING * 2;
  return { posMap, canvasH };
}

// ── SVG edge (cubic bezier) ───────────────────────────────────────────────────
function Edge({ edge, posMap, highlighted, faded }) {
  const src = posMap[edge.source];
  const tgt = posMap[edge.target];
  if (!src || !tgt) return null;

  const x1 = src.x + NODE_W;
  const y1 = src.y + NODE_H / 2;
  const x2 = tgt.x;
  const y2 = tgt.y + NODE_H / 2;
  const cx = (x1 + x2) / 2;

  const color = highlighted ? '#60a5fa' : faded ? '#1f2937' : '#374151';
  const opacity = faded ? 0.2 : 1;

  return (
    <g opacity={opacity}>
      <path
        d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
        fill="none"
        stroke={color}
        strokeWidth={highlighted ? 2 : 1}
        markerEnd="url(#arrowhead)"
      />
      {edge.slaTier && highlighted && (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 4}
          fontSize="9"
          fill="#93c5fd"
          textAnchor="middle"
        >
          {edge.slaTier}
        </text>
      )}
    </g>
  );
}

// ── SVG app node (rectangle) ──────────────────────────────────────────────────
function AppNode({ node, pos, selected, faded, onClick }) {
  const c = appColors(node.status);
  const opacity = faded ? 0.25 : 1;
  const strokeW = selected ? 2 : 1;
  const label = node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      opacity={opacity}
      onClick={() => onClick(node)}
      style={{ cursor: 'pointer' }}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={6}
        fill={c.fill}
        stroke={selected ? '#60a5fa' : c.stroke}
        strokeWidth={strokeW}
      />
      <circle cx={14} cy={NODE_H / 2} r={4} fill={c.stroke} />
      <text x={26} y={NODE_H / 2 + 1} dominantBaseline="middle" fontSize="11" fill={c.text} fontFamily="monospace">
        {label}
      </text>
      {node.deploymentType && (
        <text x={NODE_W - 4} y={NODE_H - 4} fontSize="8" fill={c.text} textAnchor="end" opacity={0.7}>
          {node.deploymentType}
        </text>
      )}
    </g>
  );
}

// ── SVG API node (rounded pill) ───────────────────────────────────────────────
function ApiNode({ node, pos, selected, faded, edgeCount, onClick }) {
  const opacity = faded ? 0.25 : 1;
  const label = node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label;

  return (
    <g
      transform={`translate(${pos.x}, ${pos.y})`}
      opacity={opacity}
      onClick={() => onClick(node)}
      style={{ cursor: 'pointer' }}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={NODE_H / 2}
        fill={selected ? '#1e3a5f' : '#172554'}
        stroke={selected ? '#60a5fa' : '#3b82f6'}
        strokeWidth={selected ? 2 : 1}
      />
      <text x={NODE_W / 2} y={NODE_H / 2 + 1} dominantBaseline="middle" textAnchor="middle" fontSize="11" fill="#93c5fd" fontFamily="monospace">
        {label}
      </text>
      {edgeCount > 1 && (
        <text x={NODE_W - 8} y={12} fontSize="8" fill="#60a5fa" textAnchor="end">
          {edgeCount}
        </text>
      )}
    </g>
  );
}

// ── Detail panel ──────────────────────────────────────────────────────────────
function DetailPanel({ node, edges, nodes, onClose }) {
  if (!node) return null;

  const connected = node.type === 'app'
    ? edges.filter(e => e.source === node.id).map(e => ({
        edge: e,
        peer: nodes.find(n => n.id === e.target),
      }))
    : edges.filter(e => e.target === node.id).map(e => ({
        edge: e,
        peer: nodes.find(n => n.id === e.source),
      }));

  return (
    <div className="w-72 shrink-0 bg-gray-900 border-l border-gray-800 p-4 overflow-y-auto text-sm">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${node.type === 'api' ? 'bg-blue-900/60 text-blue-300' : 'bg-green-900/60 text-green-300'}`}>
          {node.type === 'api' ? 'API Instance' : 'Mule App'}
        </span>
        <button onClick={onClose} className="text-gray-500 hover:text-white text-lg leading-none">✕</button>
      </div>
      <p className="font-mono text-white font-semibold text-sm break-all mb-3">{node.label}</p>

      {node.status && (
        <div className="mb-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Status</p>
          <p className="text-xs text-gray-300">{node.status}</p>
        </div>
      )}

      {node.meta && (
        <div className="mb-3 space-y-1">
          {Object.entries(node.meta).filter(([, v]) => v).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <span className="text-xs text-gray-500 shrink-0">{k}</span>
              <span className="text-xs text-gray-300 font-mono break-all text-right">{v}</span>
            </div>
          ))}
        </div>
      )}

      {connected.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
            {node.type === 'app' ? `Consumes ${connected.length} API(s)` : `${connected.length} Consumer(s)`}
          </p>
          <div className="space-y-1.5">
            {connected.map(({ edge, peer }) => (
              <div key={edge.id} className="bg-gray-800 rounded p-2">
                <p className="text-xs text-gray-300 font-mono truncate">{peer?.label || '—'}</p>
                <div className="flex gap-2 mt-1">
                  {edge.contractStatus && (
                    <span className="text-xs text-green-400">{edge.contractStatus}</span>
                  )}
                  {edge.slaTier && (
                    <span className="text-xs text-blue-400">{edge.slaTier}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ApiGraphPage() {
  const [orgs, setOrgs]         = useState([]);
  const [envs, setEnvs]         = useState([]);
  const [orgId, setOrgId]       = useState('');
  const [envId, setEnvId]       = useState('');
  const [graph, setGraph]       = useState(null);   // { nodes, edges, summary }
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [selected, setSelected] = useState(null);   // selected node id
  const [filterStatus, setFilterStatus] = useState('all');

  // Load orgs on mount
  useEffect(() => {
    api.get('/organizations/business-groups').then(res => {
      const list = res.data?.data || res.data || [];
      setOrgs(Array.isArray(list) ? list : [list]);
    }).catch(() => {});
  }, []);

  // Load envs when org changes
  useEffect(() => {
    if (!orgId) return;
    setEnvId('');
    setEnvs([]);
    api.get('/environments', { params: { orgId } }).then(res => {
      const list = res.data?.data || res.data || [];
      setEnvs(Array.isArray(list) ? list : []);
    }).catch(() => {});
  }, [orgId]);

  const loadGraph = useCallback(async () => {
    if (!orgId || !envId) return;
    setLoading(true);
    setError(null);
    setGraph(null);
    setSelected(null);
    try {
      const res = await api.get('/graph/dependencies', { params: { orgId, envId } });
      setGraph(res.data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [orgId, envId]);

  // Filtered graph nodes
  const visibleNodes = graph ? (
    filterStatus === 'all'
      ? graph.nodes
      : graph.nodes.filter(n => n.type === 'api' || (n.status || '').toUpperCase() === filterStatus)
  ) : [];

  const visibleNodeIds = new Set(visibleNodes.map(n => n.id));
  const visibleEdges = graph ? graph.edges.filter(
    e => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
  ) : [];

  const { posMap, canvasH } = graph
    ? computeLayout(visibleNodes, visibleEdges)
    : { posMap: {}, canvasH: 300 };

  const canvasW = COL_API + NODE_W + COL_APP;

  // Compute which nodes/edges are highlighted when a node is selected
  const connectedIds = new Set();
  const highlightedEdgeIds = new Set();
  if (selected) {
    connectedIds.add(selected);
    visibleEdges.forEach(e => {
      if (e.source === selected || e.target === selected) {
        connectedIds.add(e.source);
        connectedIds.add(e.target);
        highlightedEdgeIds.add(e.id);
      }
    });
  }

  const apiEdgeCount = {};
  visibleEdges.forEach(e => { apiEdgeCount[e.target] = (apiEdgeCount[e.target] || 0) + 1; });

  const selectedNode = selected ? (graph?.nodes || []).find(n => n.id === selected) : null;

  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* ── Header / controls ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-gray-800 bg-gray-900 shrink-0 flex-wrap">
        <span className="text-sm font-semibold text-white">🕸️ API Dependency Graph</span>

        <select
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          value={orgId}
          onChange={e => setOrgId(e.target.value)}
        >
          <option value="">Business Group…</option>
          {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>

        <select
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500"
          value={envId}
          onChange={e => setEnvId(e.target.value)}
          disabled={!orgId}
        >
          <option value="">Environment…</option>
          {envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>

        <button
          onClick={loadGraph}
          disabled={!orgId || !envId || loading}
          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs rounded font-medium transition-colors"
        >
          {loading ? 'Loading…' : 'Build Graph'}
        </button>

        {graph && (
          <>
            <div className="flex items-center gap-2 ml-2">
              <span className="text-xs text-gray-400">Filter:</span>
              {['all', 'RUNNING', 'FAILED', 'STOPPED'].map(s => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${filterStatus === s ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
                >
                  {s === 'all' ? 'All' : s}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-3 text-xs text-gray-400">
              <span>🟦 {graph.summary.apps} apps</span>
              <span>🔵 {graph.summary.apis} APIs</span>
              <span>→ {graph.summary.edges} contracts</span>
            </div>
          </>
        )}
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="px-5 pt-3">
          <ErrorBanner error={error} onRetry={loadGraph} />
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0">
        {/* Canvas */}
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="space-y-2 p-2">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-9 w-full max-w-2xl" />
              ))}
            </div>
          )}

          {!loading && !graph && !error && (
            <EmptyState
              icon="🕸️"
              title="No graph loaded"
              description="Select a Business Group and Environment, then click Build Graph."
            />
          )}

          {!loading && graph && visibleNodes.length === 0 && (
            <EmptyState
              icon="🔍"
              title="No dependency data found"
              description="No API consumer contracts were found for this environment, or no client IDs could be matched to deployed applications."
            />
          )}

          {!loading && graph && visibleNodes.length > 0 && (
            <div
              className="relative"
              onClick={e => { if (e.target.tagName === 'svg' || e.target.tagName === 'rect' && e.target.getAttribute('data-bg')) setSelected(null); }}
            >
              {/* Legend */}
              <div className="flex items-center gap-4 mb-3 text-xs text-gray-400">
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-700 border border-green-500"></span> Running app</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-900 border border-red-500"></span> Failed app</span>
                <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full bg-blue-900 border border-blue-500"></span> API instance</span>
                <span className="flex items-center gap-1"><span className="text-blue-400">→</span> Contract / consumes</span>
              </div>

              {/* Column headers */}
              <div className="absolute top-8" style={{ left: COL_APP + 4 + 16 }}>
                <span className="text-xs text-gray-500 uppercase tracking-wider">Mule Apps</span>
              </div>
              <div className="absolute top-8" style={{ left: COL_API + 4 + 40 }}>
                <span className="text-xs text-gray-500 uppercase tracking-wider">API Instances</span>
              </div>

              <svg
                width={canvasW}
                height={canvasH + 40}
                style={{ display: 'block', marginTop: 28 }}
              >
                <defs>
                  <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#374151" />
                  </marker>
                  <marker id="arrowhead-hi" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
                    <polygon points="0 0, 8 3, 0 6" fill="#60a5fa" />
                  </marker>
                </defs>

                {/* Edges — draw faded ones first, highlighted on top */}
                {visibleEdges.map(edge => (
                  <Edge
                    key={edge.id}
                    edge={edge}
                    posMap={posMap}
                    highlighted={highlightedEdgeIds.has(edge.id)}
                    faded={selected !== null && !highlightedEdgeIds.has(edge.id)}
                  />
                ))}

                {/* Nodes */}
                {visibleNodes.map(node => {
                  const pos = posMap[node.id];
                  if (!pos) return null;
                  const isFaded = selected !== null && !connectedIds.has(node.id);
                  const isSelected = node.id === selected;

                  if (node.type === 'app') {
                    return (
                      <AppNode
                        key={node.id}
                        node={node}
                        pos={pos}
                        selected={isSelected}
                        faded={isFaded}
                        onClick={n => setSelected(prev => prev === n.id ? null : n.id)}
                      />
                    );
                  }
                  return (
                    <ApiNode
                      key={node.id}
                      node={node}
                      pos={pos}
                      selected={isSelected}
                      faded={isFaded}
                      edgeCount={apiEdgeCount[node.id] || 0}
                      onClick={n => setSelected(prev => prev === n.id ? null : n.id)}
                    />
                  );
                })}
              </svg>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedNode && (
          <DetailPanel
            node={selectedNode}
            edges={visibleEdges}
            nodes={visibleNodes}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}