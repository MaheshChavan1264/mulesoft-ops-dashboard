import { useState } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Clock, ChevronDown, ChevronRight, RefreshCw, Globe } from 'lucide-react';

const ENV_BADGE = { production: 'bg-green-400', sandbox: 'bg-yellow-400', design: 'bg-blue-400' };

const STATUS_CONFIG = {
  SUCCESS: {
    icon: <CheckCircle2 size={14} className="text-emerald-400" />,
    label: 'Healthy',
    cls: 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300',
    dot: 'bg-emerald-400',
    ping: true,
  },
  PARTIAL: {
    icon: <AlertCircle size={14} className="text-yellow-400" />,
    label: 'Partial',
    cls: 'bg-yellow-950/50 border-yellow-700/50 text-yellow-300',
    dot: 'bg-yellow-400',
    ping: false,
  },
  FAILED: {
    icon: <XCircle size={14} className="text-red-400" />,
    label: 'Unreachable',
    cls: 'bg-red-950/50 border-red-700/50 text-red-300',
    dot: 'bg-red-500',
    ping: false,
  },
};

function latencyColor(ms) {
  if (!ms) return 'text-gray-400';
  if (ms < 300) return 'text-emerald-400';
  if (ms < 1000) return 'text-yellow-400';
  return 'text-red-400';
}

/**
 * PingResultCard — shows full ping details for a single app result.
 *
 * Props:
 *   app      { name, deploymentType, environment } — app metadata
 *   result   { status, activeEndpoint, responseTimeMs, httpStatus, payload, error, attempts }
 *   loading  {boolean} — true while this app is being pinged
 *   selected {boolean} — whether this card is selected for ping
 *   onToggle {function} — callback to toggle selection
 */
export default function PingResultCard({ app, result, loading, selected, onToggle }) {
  const [showAttempts, setShowAttempts] = useState(false);
  const [showPayload, setShowPayload] = useState(false);

  const isCH1 = app?.deploymentType !== 'CloudHub 2.0';
  const cfg = result ? STATUS_CONFIG[result.status] || STATUS_CONFIG.FAILED : null;

  return (
    <div className={`border rounded-xl overflow-hidden bg-gray-900/60 transition-all ${selected ? 'border-cyan-600/60 ring-1 ring-cyan-600/30' : 'border-gray-800'}`}>
      {/* App header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800/60 bg-gray-800/20">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${ENV_BADGE[app?.environment?.type] || 'bg-gray-400'}`} />
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{app?.name}</p>
            <p className="text-gray-400 text-xs mt-0.5">
              {app?.environment?.name} ·{' '}
              <span className={isCH1 ? 'text-purple-400' : 'text-blue-400'}>{isCH1 ? 'CH1' : 'CH2'}</span>
            </p>
          </div>
        </div>

        {/* Status pill + selection checkbox */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {onToggle && (
            <button
              onClick={onToggle}
              title={selected ? 'Deselect' : 'Select for ping'}
              className={`w-5 h-5 rounded border flex items-center justify-center transition-all flex-shrink-0 ${
                selected ? 'bg-cyan-600 border-cyan-500' : 'border-gray-600 hover:border-cyan-500 bg-gray-800/60'
              }`}
            >
              {selected && <span className="text-white text-[11px] font-bold leading-none">✓</span>}
            </button>
          )}
          {loading && (
            <div className="flex items-center gap-1.5 text-gray-400 text-xs">
              <RefreshCw size={12} className="animate-spin" /> Pinging…
            </div>
          )}
          {!loading && !result && (
            <span className="text-gray-600 text-xs">Pending</span>
          )}
          {!loading && result && cfg && (
            <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-semibold ${cfg.cls}`}>
              <span className="relative flex h-2 w-2 flex-shrink-0">
                {cfg.ping && <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-60 ${cfg.dot}`} />}
                <span className={`relative inline-flex rounded-full h-2 w-2 ${cfg.dot}`} />
              </span>
              {cfg.icon}
              {cfg.label}
              {result.responseTimeMs != null && (
                <span className={`font-mono font-bold ml-0.5 ${latencyColor(result.responseTimeMs)}`}>
                  {result.responseTimeMs}ms
                </span>
              )}
            </span>
          )}
        </div>
      </div>

      {/* Detail rows — only when result exists */}
      {result && (
        <div className="px-4 py-3 space-y-2.5 text-sm">
          {/* Active endpoint */}
          <div className="flex items-start gap-2">
            <Globe size={13} className="text-gray-500 flex-shrink-0 mt-0.5" />
            <span className="text-gray-400 w-28 flex-shrink-0 font-medium">Endpoint</span>
            <span className={`font-mono text-xs break-all leading-relaxed ${result.activeEndpoint ? 'text-cyan-300' : 'text-gray-600'}`}>
              {result.activeEndpoint || '—'}
            </span>
          </div>

          {/* HTTP status + response time */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 w-28 flex-shrink-0 font-medium">HTTP Status</span>
              {result.httpStatus != null ? (
                <span className={`font-mono font-bold text-sm ${
                  result.httpStatus < 300 ? 'text-emerald-400' :
                  result.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'
                }`}>{result.httpStatus}</span>
              ) : <span className="text-gray-600">—</span>}
            </div>
            {result.responseTimeMs != null && (
              <div className="flex items-center gap-1.5">
                <Clock size={13} className="text-gray-500" />
                <span className={`font-mono font-bold text-sm ${latencyColor(result.responseTimeMs)}`}>{result.responseTimeMs}ms</span>
              </div>
            )}
          </div>

          {/* Error message */}
          {result.error && (
            <div className="flex items-start gap-2 text-red-400 text-xs">
              <XCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="break-all">{result.error}</span>
            </div>
          )}

          {/* Response payload — collapsible */}
          {result.payload && (
            <div>
              <button onClick={() => setShowPayload(!showPayload)}
                className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-xs transition-colors font-medium">
                {showPayload ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Response Payload
              </button>
              {showPayload && (
                <pre className="mt-2 bg-[#0B0F17] rounded-lg px-3 py-2.5 text-xs text-emerald-400/90 overflow-auto max-h-36 font-mono border border-gray-800/60 leading-relaxed">
                  {typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Attempt log — collapsible */}
          {result.attempts && result.attempts.length > 0 && (
            <div>
              <button onClick={() => setShowAttempts(!showAttempts)}
                className="flex items-center gap-1 text-gray-400 hover:text-gray-200 text-xs transition-colors font-medium">
                {showAttempts ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                Attempt Log ({result.attempts.length} path{result.attempts.length !== 1 ? 's' : ''} tried)
              </button>
              {showAttempts && (
                <table className="w-full mt-2 text-xs border-collapse">
                  <thead>
                    <tr className="bg-gray-800/50">
                      <th className="px-2 py-1.5 text-left text-gray-400 font-medium">URL</th>
                      <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Status</th>
                      <th className="px-2 py-1.5 text-left text-gray-400 font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.attempts.map((a, i) => (
                      <tr key={i} className="border-t border-gray-800/30">
                        <td className="px-2 py-1.5 font-mono text-gray-300 break-all text-[11px]">{a.url}</td>
                        <td className="px-2 py-1.5">
                          {a.error ? (
                            <span className="text-red-400 text-[11px]">{a.error}</span>
                          ) : (
                            <span className={`font-bold ${a.httpStatus < 300 ? 'text-emerald-400' : a.httpStatus < 500 ? 'text-yellow-400' : 'text-red-400'}`}>
                              {a.httpStatus}
                            </span>
                          )}
                        </td>
                        <td className={`px-2 py-1.5 font-mono ${latencyColor(a.responseTimeMs)}`}>
                          {a.responseTimeMs != null ? `${a.responseTimeMs}ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
