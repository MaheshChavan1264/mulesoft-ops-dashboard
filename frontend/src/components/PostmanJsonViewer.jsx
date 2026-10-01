import React, { useState, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * PostmanJsonViewer
 *
 * Read-only, syntax-highlighted JSON viewer styled after Postman's light
 * JSON editor — white background, orange accents, line-number gutter,
 * colour-coded keys/strings/numbers/keywords.
 *
 * This is intentionally scoped to wherever it's explicitly used (e.g. the
 * "Raw JSON" tab on ApplicationDetailPage) rather than being a global theme
 * change. The palette + tokenizer mirror components/CpsRawJsonModal.jsx.
 */
const PM = {
  bg:         '#ffffff',
  toolbarBg:  '#efefef',
  border:     '#e0e0e0',
  orange:     '#ff6c37',
  orangeDim:  'rgba(255,108,55,0.12)',
  text:       '#2d2d2d',
  textMuted:  '#666666',
  jsonKey:     '#c41a16',
  jsonString:  '#0451a5',
  jsonNumber:  '#098658',
  jsonKeyword: '#0000cc',
  jsonPunct:   '#555555',
  lineNum:    '#c0c0c0',
  lineNumBg:  '#f8f8f8',
};

function tokenizeJSON(text) {
  if (!text) return [];
  const RE = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],:])|([^"{\}\[\],:\d\-\ntruefals]+|\s+|.)/g;
  const tokens = [];
  let last = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ text: text.slice(last, m.index), type: 'plain' });
    if (m[1] !== undefined) {
      tokens.push({ text: m[1], type: 'key' });
      tokens.push({ text: m[2], type: 'colon' });
    } else if (m[3] !== undefined) {
      tokens.push({ text: m[3], type: 'string' });
    } else if (m[4] !== undefined) {
      tokens.push({ text: m[4], type: 'number' });
    } else if (m[5] !== undefined) {
      tokens.push({ text: m[5], type: 'keyword' });
    } else if (m[6] !== undefined) {
      tokens.push({ text: m[6], type: 'punctuation' });
    } else {
      tokens.push({ text: m[7] ?? m[0], type: 'plain' });
    }
    last = RE.lastIndex;
  }
  if (last < text.length) tokens.push({ text: text.slice(last), type: 'plain' });
  return tokens;
}

function tokenColor(type) {
  switch (type) {
    case 'key':         return PM.jsonKey;
    case 'string':      return PM.jsonString;
    case 'number':      return PM.jsonNumber;
    case 'keyword':     return PM.jsonKeyword;
    case 'punctuation':
    case 'colon':       return PM.jsonPunct;
    default:            return PM.text;
  }
}

export default function PostmanJsonViewer({ data, maxHeight = '600px' }) {
  const jsonText = useMemo(() => {
    if (typeof data === 'string') return data;
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
  }, [data]);
  const tokens = useMemo(() => tokenizeJSON(jsonText), [jsonText]);
  const lineCount = useMemo(() => jsonText.split('\n').length || 1, [jsonText]);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div style={{
      border: `1px solid ${PM.border}`,
      borderRadius: '8px',
      overflow: 'hidden',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: '36px',
        background: PM.toolbarBg,
        borderBottom: `1px solid ${PM.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', fontWeight: 600, color: PM.text }}>
          <span style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: 700, color: PM.orange }}>{'{}'}</span>
          JSON
          <span style={{
            fontSize: '9px', padding: '1px 5px', borderRadius: '2px',
            background: PM.orangeDim, color: PM.orange,
            border: '1px solid rgba(255,108,55,0.3)', fontWeight: 700, letterSpacing: '0.04em',
          }}>READ ONLY</span>
        </div>
        <button
          onClick={handleCopy}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'transparent', border: `1px solid ${PM.border}`, borderRadius: '4px',
            padding: '4px 10px', fontSize: '11px', fontWeight: 500,
            color: copied ? PM.jsonNumber : PM.textMuted, cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
        </button>
      </div>

      {/* Editor */}
      <div style={{ display: 'flex', background: PM.bg, maxHeight, overflow: 'auto' }}>
        {/* Line numbers gutter */}
        <div style={{
          flexShrink: 0, width: '44px',
          background: PM.lineNumBg,
          borderRight: `1px solid ${PM.border}`,
          padding: '12px 0',
          userSelect: 'none',
        }}>
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i} style={{
              height: '21.45px',
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              paddingRight: '10px',
              fontSize: '11px',
              fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
              color: PM.lineNum,
              lineHeight: '1.65',
            }}>
              {i + 1}
            </div>
          ))}
        </div>

        {/* Syntax-highlighted content */}
        <pre style={{
          flex: 1, margin: 0, padding: '12px 16px',
          fontSize: '13px', lineHeight: '21.45px',
          fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Consolas, monospace',
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          color: PM.text,
        }}>
          {tokens.map((tok, i) => (
            <span key={i} style={{ color: tokenColor(tok.type) }}>{tok.text}</span>
          ))}
        </pre>
      </div>
    </div>
  );
}
