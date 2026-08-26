import React, { useState } from 'react';
import { ChevronDown, ChevronUp, X, Clock, Copy, Check } from 'lucide-react';

// ── Method badge ──────────────────────────────────────────────────────────────
function MethodBadge({ method }) {
  const colors = {
    GET:    'bg-green-500/20 text-green-400 border-green-600/40',
    POST:   'bg-blue-500/20 text-blue-400 border-blue-600/40',
    PUT:    'bg-yellow-500/20 text-yellow-400 border-yellow-600/40',
    DELETE: 'bg-red-500/20 text-red-400 border-red-600/40',
    PATCH:  'bg-purple-500/20 text-purple-400 border-purple-600/40',
  };
  const cls = colors[(method || '').toUpperCase()] || 'bg-gray-500/20 text-gray-400 border-gray-600/40';
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider flex-shrink-0 ${cls}`}>
      {method}
    </span>
  );
}

// ── Status badge ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const isSuccess = status >= 200 && status < 300;
  const isClientErr = status >= 400 && status < 500;
  const isServerErr = status >= 500;
  const cls = isSuccess
    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-600/40'
    : isClientErr
    ? 'bg-red-500/20 text-red-400 border-red-600/40'
    : isServerErr
    ? 'bg-orange-500/20 text-orange-400 border-orange-600/40'
    : 'bg-gray-500/20 text-gray-400 border-gray-600/40';
  const label = isSuccess ? 'OK' : isClientErr ? 'Client Error' : isServerErr ? 'Server Error' : '';
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current inline-block" />
      {status} {label}
    </span>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyCodeBtn({ text }) {
  const [done, setDone] = useState(false);
  const handle = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button
      onClick={handle}
      title="Copy to clipboard"
      className="flex items-center gap-1 text-[9px] text-gray-500 hover:text-gray-300 transition-colors px-1.5 py-0.5 rounded border border-gray-700/50 hover:border-gray-600/60 bg-gray-800/60"
    >
      {done ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}

// ── Format JSON (or plain string) for display ─────────────────────────────────
function formatJson(val) {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  try {
    return JSON.stringify(val, null, 2);
  } catch {
    return String(val);
  }
}

// ── Code block ────────────────────────────────────────────────────────────────
function CodeBlock({ value, isError = false }) {
  const text = formatJson(value);
  if (!text) return <p className="text-[10px] text-gray-600 italic">empty</p>;
  return (
    <div className="relative group/code">
      <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover/code:opacity-100 transition-opacity">
        <CopyCodeBtn text={text} />
      </div>
      <pre className={`rounded-lg p-3 text-[10px] font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-words max-h-52 overflow-y-auto border ${
        isError
          ? 'bg-red-950/30 border-red-800/40 text-red-300/85'
          : 'bg-gray-950/60 border-gray-800/50 text-cyan-300/85'
      }`}>
        {text}
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CpsRequestResponsePanel
//
// Props:
//   operation  {object}   Last operation info:
//     label          {string}   e.g. 'Save Properties'
//     timestamp      {string}   ISO timestamp
//     requestDetails {object}   { method, url, body?, params?, headers? }
//     responseDetails{object}   { status, body }
//     success        {boolean}
//   onDismiss  {function}  Called when user clicks ✕
// ─────────────────────────────────────────────────────────────────────────────
export default function CpsRequestResponsePanel({ operation, onDismiss }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!operation) return null;

  const { label, timestamp, requestDetails = {}, responseDetails = {}, success } = operation;
  const { method, url, body, params, headers } = requestDetails;
  const { status, body: resBody } = responseDetails;
  const isError = !success || (status !== undefined && status >= 400);

  return (
    <div className={`rounded-xl border overflow-hidden transition-all ${
      isError ? 'border-red-800/50 bg-red-950/10' : 'border-gray-700/50 bg-gray-900/80'
    }`}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-4 py-2.5 cursor-pointer select-none hover:bg-white/5 transition-colors"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 flex-shrink-0">
            Last Operation
          </span>
          {label && (
            <span className="text-[10px] text-gray-300 font-medium truncate">{label}</span>
          )}
          {success !== undefined && (
            success
              ? <span className="text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-700/40 px-1.5 py-0.5 rounded-full flex-shrink-0">✓ Success</span>
              : <span className="text-[9px] text-red-400 bg-red-500/10 border border-red-700/40 px-1.5 py-0.5 rounded-full flex-shrink-0">✗ Failed</span>
          )}
          {status !== undefined && <StatusBadge status={status} />}
          {timestamp && (
            <span className="text-[9px] text-gray-600 flex items-center gap-1 flex-shrink-0">
              <Clock size={8} />
              {new Date(timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
          {collapsed
            ? <ChevronDown size={13} className="text-gray-500" />
            : <ChevronUp size={13} className="text-gray-500" />
          }
          <button
            onClick={e => { e.stopPropagation(); onDismiss?.(); }}
            title="Dismiss"
            className="text-gray-600 hover:text-gray-300 p-0.5 rounded transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* ── Body ────────────────────────────────────────────────────────── */}
      {!collapsed && (
        <div className="grid grid-cols-1 md:grid-cols-2 border-t border-gray-800/60 divide-y md:divide-y-0 md:divide-x divide-gray-800/60">
          {/* Request pane */}
          <div className="p-4 space-y-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Request</p>

            {/* Method + URL */}
            {(method || url) && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  {method && <MethodBadge method={method} />}
                  {url && (
                    <span className="font-mono text-[10px] text-gray-300 break-all leading-snug">{url}</span>
                  )}
                </div>
              </div>
            )}

            {/* Query params */}
            {params && Object.keys(params).length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider font-medium">Query Params</p>
                <CodeBlock value={params} />
              </div>
            )}

            {/* Headers (sanitized — no credentials) */}
            {headers && Object.keys(headers).length > 0 && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider font-medium">Headers</p>
                <CodeBlock value={headers} />
              </div>
            )}

            {/* Request body */}
            {body !== undefined && body !== null && (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider font-medium">Body</p>
                <CodeBlock value={body} />
              </div>
            )}

            {!method && !url && !body && !params && (
              <p className="text-[10px] text-gray-600 italic">No request details available</p>
            )}
          </div>

          {/* Response pane */}
          <div className="p-4 space-y-3">
            <p className="text-[9px] font-bold uppercase tracking-widest text-gray-500">Response</p>

            {status !== undefined && (
              <div>
                <StatusBadge status={status} />
              </div>
            )}

            {resBody !== undefined && resBody !== null ? (
              <div className="space-y-1">
                <p className="text-[9px] text-gray-600 uppercase tracking-wider font-medium">Body</p>
                <CodeBlock value={resBody} isError={isError} />
              </div>
            ) : status !== undefined ? (
              <p className="text-[10px] text-gray-600 italic">Empty response body</p>
            ) : (
              <p className="text-[10px] text-gray-600 italic">No response details available</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}