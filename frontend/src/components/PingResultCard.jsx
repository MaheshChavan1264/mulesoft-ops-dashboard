import { useState, useEffect } from 'react';
import { CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw, Globe, Lock } from 'lucide-react';
import { ENV_BADGE, PING_STATUS_CONFIG, latencyColor } from '../utils/appUtils';
import AttemptLog from './AttemptLog';

// PingResultCard uses icon-enhanced status config — build it from the shared base
const STATUS_CONFIG = {
  SUCCESS: {
    ...PING_STATUS_CONFIG.SUCCESS,
    icon: <CheckCircle2 size={14} className="text-emerald-400" />,
    cls: 'bg-emerald-950/50 border-emerald-700/50 text-emerald-300',
  },
  PARTIAL: {
    ...PING_STATUS_CONFIG.PARTIAL,
    icon: <AlertCircle size={14} className="text-yellow-400" />,
    cls: 'bg-yellow-950/50 border-yellow-700/50 text-yellow-300',
  },
  FAILED: {
    ...PING_STATUS_CONFIG.FAILED,
    icon: <XCircle size={14} className="text-red-400" />,
    cls: 'bg-red-950/50 border-red-700/50 text-red-300',
  },
};

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
  // Auto-expand payload for 5xx responses so the error body is immediately visible
  const [showPayload, setShowPayload] = useState(false);

  useEffect(() => {
    if (result?.payload && result?.httpStatus >= 500) setShowPayload(true);
  }, [result?.httpStatus, result?.payload]);

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

          {/* JWT auto-used indicator */}
          {result._jwtUsed && (
            <div className="flex items-center gap-1.5 text-indigo-400 text-xs bg-indigo-950/30 border border-indigo-800/40 rounded-lg px-2.5 py-1.5">
              <Lock size={11} /> JWT Bearer token was auto-fetched from CPS and used for this ping
            </div>
          )}

          {/* JWT may be required hint (PARTIAL + 401/400, no JWT yet) */}
          {result.status === 'PARTIAL' && !result._jwtUsed && (result.httpStatus === 401 || result.httpStatus === 400) && (
            <div className="flex items-center gap-1.5 text-indigo-400/70 text-xs">
              <Lock size={11} /> May require JWT token — open App Detail to auto-fetch
            </div>
          )}

          {/* Error message */}
          {result.error && (
            <div className="flex items-start gap-2 text-red-400 text-xs">
              <XCircle size={13} className="flex-shrink-0 mt-0.5" />
              <span className="break-all">{result.error}</span>
            </div>
          )}

          {/* Response payload — auto-expanded for 5xx errors */}
          {result.payload && (
            <div>
              <button onClick={() => setShowPayload(!showPayload)}
                className={`flex items-center gap-1 text-xs transition-colors font-medium ${
                  result.httpStatus >= 500
                    ? 'text-red-400/80 hover:text-red-300'
                    : 'text-gray-400 hover:text-gray-200'
                }`}>
                {showPayload ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                {result.httpStatus >= 500 ? `API Response (HTTP ${result.httpStatus})` : 'Response Payload'}
              </button>
              {showPayload && (
                <pre className={`mt-2 rounded-lg px-3 py-2.5 text-xs overflow-auto font-mono border leading-relaxed whitespace-pre-wrap break-all max-h-60 ${
                  result.httpStatus >= 500
                    ? 'bg-red-950/20 border-red-800/40 text-red-300/80'
                    : 'bg-[#0B0F17] border-gray-800/60 text-emerald-400/90'
                }`}>
                  {typeof result.payload === 'string' ? result.payload : JSON.stringify(result.payload, null, 2)}
                </pre>
              )}
            </div>
          )}

          {/* Attempt log — collapsible, each row expandable to show response payload */}
          {result.attempts && result.attempts.length > 0 && (
            <AttemptLog attempts={result.attempts} />
          )}
        </div>
      )}
    </div>
  );
}
