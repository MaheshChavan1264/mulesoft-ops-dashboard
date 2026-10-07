import { useState } from 'react';
import { Lock, ChevronDown, ChevronRight, Copy, Check, Clock, ShieldAlert, ShieldCheck } from 'lucide-react';
import { decodeJwtWithExpiry } from '../../utils/jwtUtils';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';
import PostmanJsonViewer from './PostmanJsonViewer';

/**
 * JwtDetails
 *
 * Decodes (no signature verification) and displays a JWT found inside a
 * ping response body — header, claims, and expiry status. Shared between
 * PingTestPanel (single-app config/result view) and PingTestPage
 * (batch results page) so both surfaces present a found JWT identically.
 *
 * @param {string} token      Raw JWT string (header.payload.signature)
 * @param {string} path       Dotted key path where the token was found in the response, e.g. "pingResponse.token"
 * @param {string} [className] Override the outer wrapper's spacing/border to match the host layout
 */
export default function JwtDetails({ token, path, className }) {
  const decoded = decodeJwtWithExpiry(token);
  const [expanded, setExpanded] = useState(false);
  const [copied, copy] = useCopyToClipboard(2000);
  if (!decoded) return null;

  const { header, payload, expiresAt, issuedAt, notBefore, isExpired } = decoded;

  return (
    <div className={className || 'border-t border-gray-100 dark:border-gray-800 px-5 py-4 space-y-2'}>
      <button onClick={() => setExpanded((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <p className="text-[10px] font-bold tracking-wider text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-1.5">
          <Lock size={9} /> JWT detected in response{path ? <span className="font-mono text-gray-400 dark:text-gray-500 normal-case">· {path}</span> : null}
        </p>
        <div className="flex items-center gap-2">
          {isExpired === true && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-300 border border-red-200/60 dark:border-red-400/20">
              <ShieldAlert size={9} /> Expired
            </span>
          )}
          {isExpired === false && (
            <span className="flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-400/20">
              <ShieldCheck size={9} /> Valid
            </span>
          )}
          {expanded ? <ChevronDown size={13} className="text-gray-400 dark:text-gray-500" /> : <ChevronRight size={13} className="text-gray-400 dark:text-gray-500" />}
        </div>
      </button>

      {expanded && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500 break-all">{token.slice(0, 24)}…{token.slice(-12)}</span>
            <button onClick={() => copy(token)} className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 flex-shrink-0">
              {copied ? <><Check size={10} className="text-emerald-600 dark:text-emerald-400" /> Copied</> : <><Copy size={10} /> Copy token</>}
            </button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {[
              ['Algorithm', header.alg || '—'],
              ['Issued At', issuedAt ? issuedAt.toLocaleString() : '—'],
              ['Not Before', notBefore ? notBefore.toLocaleString() : '—'],
              ['Expires At', expiresAt ? expiresAt.toLocaleString() : '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-gray-50/80 dark:bg-gray-800/60 border border-gray-200/60 dark:border-gray-700/60 rounded-lg px-2.5 py-2">
                <p className="text-[9px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase flex items-center gap-1">
                  {label === 'Expires At' && <Clock size={8} />} {label}
                </p>
                <p className="text-[11px] font-mono text-gray-700 dark:text-gray-200 mt-0.5 break-all">{value}</p>
              </div>
            ))}
          </div>

          {(payload.sub || payload.iss || payload.aud || payload.client_id || payload.scope) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                ['Subject', payload.sub],
                ['Issuer', payload.iss],
                ['Audience', Array.isArray(payload.aud) ? payload.aud.join(', ') : payload.aud],
                ['Client ID', payload.client_id],
                ['Scope', payload.scope],
              ].filter(([, v]) => v != null).map(([label, value]) => (
                <div key={label} className="flex items-start gap-1.5 text-[11px]">
                  <span className="text-gray-400 dark:text-gray-500 font-semibold flex-shrink-0 w-20">{label}</span>
                  <span className="font-mono text-gray-700 dark:text-gray-200 break-all">{value}</span>
                </div>
              ))}
            </div>
          )}

          <div>
            <p className="text-[10px] font-bold tracking-wider text-gray-400 dark:text-gray-500 uppercase mb-1.5">Full Claims</p>
            <PostmanJsonViewer data={{ header, payload }} maxHeight="260px" />
          </div>
        </div>
      )}
    </div>
  );
}
