import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, Maximize2, Minimize2 } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';
import { LIGHT_PM, DARK_PM, tokenizeJSON, tokenColor } from '../../utils/postmanJsonTheme';
import { useCopyToClipboard } from '../../hooks/useCopyToClipboard';

/**
 * PostmanJsonViewer
 *
 * Read-only, syntax-highlighted JSON viewer styled after Postman's JSON
 * editor — white/dark background, orange accents, line-number gutter,
 * colour-coded keys/strings/numbers/keywords. Follows the app's light/dark
 * theme toggle via useTheme(). Palette + tokenizer are shared with
 * components/CpsRawJsonModal.jsx via utils/postmanJsonTheme.js.
 */

export default function PostmanJsonViewer({ data, maxHeight = '600px' }) {
  const { isDark } = useTheme();
  const PM = isDark ? DARK_PM : LIGHT_PM;
  const jsonText = useMemo(() => {
    if (typeof data === 'string') return data;
    try { return JSON.stringify(data, null, 2); } catch { return String(data); }
  }, [data]);
  const tokens = useMemo(() => tokenizeJSON(jsonText), [jsonText]);
  const lineCount = useMemo(() => jsonText.split('\n').length || 1, [jsonText]);
  const [copied, copy] = useCopyToClipboard();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleCopy = () => copy(jsonText);

  const editorMaxHeight = isFullscreen ? 'calc(100vh - 36px)' : maxHeight;

  const content = (
    <div style={{
      border: isFullscreen ? 'none' : `1px solid ${PM.border}`,
      borderRadius: isFullscreen ? 0 : '8px',
      overflow: 'hidden',
      height: isFullscreen ? '100vh' : undefined,
      display: isFullscreen ? 'flex' : undefined,
      flexDirection: isFullscreen ? 'column' : undefined,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 14px', height: '36px', flexShrink: 0,
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
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
          <button
            onClick={() => setIsFullscreen(v => !v)}
            title={isFullscreen ? 'Exit full page' : 'Expand to full page'}
            style={{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'transparent', border: `1px solid ${PM.border}`, borderRadius: '4px',
              padding: '4px 8px', fontSize: '11px', fontWeight: 500,
              color: PM.textMuted, cursor: 'pointer', transition: 'all 0.15s',
            }}
          >
            {isFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        </div>
      </div>

      {/* Editor */}
      <div style={{ display: 'flex', background: PM.bg, maxHeight: editorMaxHeight, flex: isFullscreen ? 1 : undefined, overflow: 'auto' }}>
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
            <span key={i} style={{ color: tokenColor(tok.type, PM) }}>{tok.text}</span>
          ))}
        </pre>
      </div>
    </div>
  );

  if (!isFullscreen) return content;

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: PM.bg,
    }}>
      {content}
    </div>,
    document.body
  );
}
