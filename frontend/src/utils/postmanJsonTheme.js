/**
 * Shared Postman-style JSON viewer/editor theme and tokenizer.
 *
 * Previously this exact palette + regex-based tokenizer was duplicated
 * byte-for-byte between components/CpsRawJsonModal.jsx (editable) and
 * components/PostmanJsonViewer.jsx (read-only) — see
 * FRONTEND_ARCHITECTURE_REVIEW.md §1 finding #2. A single canonical
 * implementation now backs both.
 */

/* ═══════════════════════════════════════════════════
   Postman Light Palette
═══════════════════════════════════════════════════ */
export const LIGHT_PM = {
  bg:          '#ffffff',
  panelBg:     '#f5f5f5',
  toolbarBg:   '#efefef',
  editorBg:    '#ffffff',
  border:      '#e0e0e0',
  borderFocus: '#ff6c37',
  orange:      '#ff6c37',
  orangeDim:   'rgba(255,108,55,0.12)',
  orangeHover: '#e05a28',
  text:        '#2d2d2d',
  textMuted:   '#666666',
  textDim:     '#bbbbbb',
  inputBg:     '#ffffff',
  // JSON syntax
  jsonKey:     '#c41a16',
  jsonString:  '#0451a5',
  jsonNumber:  '#098658',
  jsonKeyword: '#0000cc',
  jsonPunct:   '#555555',
  lineNum:     '#c0c0c0',
  lineNumBg:   '#f8f8f8',
  // Error
  errBg:       'rgba(220,38,38,0.05)',
  errBorder:   'rgba(220,38,38,0.25)',
  errText:     '#dc2626',
  overlay:     'rgba(0,0,0,0.55)',
};

/* ═══════════════════════════════════════════════════
   Postman Dark Palette (VS Code Dark+ inspired)
═══════════════════════════════════════════════════ */
export const DARK_PM = {
  bg:          '#1e1e1e',
  panelBg:     '#252526',
  toolbarBg:   '#2d2d30',
  editorBg:    '#1e1e1e',
  border:      '#3c3c3c',
  borderFocus: '#ff6c37',
  orange:      '#ff8a5c',
  orangeDim:   'rgba(255,138,92,0.18)',
  orangeHover: '#ff6c37',
  text:        '#d4d4d4',
  textMuted:   '#9a9a9a',
  textDim:     '#5f5f5f',
  inputBg:     '#2d2d30',
  // JSON syntax
  jsonKey:     '#9cdcfe',
  jsonString:  '#ce9178',
  jsonNumber:  '#b5cea8',
  jsonKeyword: '#569cd6',
  jsonPunct:   '#d4d4d4',
  lineNum:     '#6a6a6a',
  lineNumBg:   '#1e1e1e',
  // Error
  errBg:       'rgba(248,81,73,0.1)',
  errBorder:   'rgba(248,81,73,0.35)',
  errText:     '#f85149',
  overlay:     'rgba(0,0,0,0.75)',
};

/* ═══════════════════════════════════════════════════
   JSON Tokenizer  (returns [{text, type, start?, end?}])
═══════════════════════════════════════════════════ */

/**
 * Tokenize a JSON string for syntax highlighting.
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {boolean} [opts.withOffsets=false]  include `start`/`end` character
 *   offsets per token (needed by editable editors for cursor/selection
 *   tracking; read-only viewers can omit this for a lighter token shape).
 * @returns {Array<{text:string, type:string, start?:number, end?:number}>}
 */
export function tokenizeJSON(text, opts = {}) {
  const { withOffsets = false } = opts;
  if (!text) return [];
  /* Groups:
     1 key-string   2 colon-suffix
     3 string-value
     4 number
     5 keyword (true/false/null)
     6 punctuation  {}[],:
     7 whitespace / plain
  */
  const RE = /("(?:[^"\\]|\\.)*")(\s*:)|("(?:[^"\\]|\\.)*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],:])|([^"{\}\[\],:\d\-\ntruefals]+|\s+|.)/g;
  const tokens = [];
  let last = 0;
  let m;
  const push = (t, type, start, end) =>
    tokens.push(withOffsets ? { text: t, type, start, end } : { text: t, type });

  while ((m = RE.exec(text)) !== null) {
    if (m.index > last) {
      push(text.slice(last, m.index), 'plain', last, m.index);
    }
    const s = m.index;
    if (m[1] !== undefined) {
      push(m[1], 'key', s, s + m[1].length);
      push(m[2], 'colon', s + m[1].length, s + m[0].length);
    } else if (m[3] !== undefined) {
      push(m[3], 'string', s, s + m[3].length);
    } else if (m[4] !== undefined) {
      push(m[4], 'number', s, s + m[4].length);
    } else if (m[5] !== undefined) {
      push(m[5], 'keyword', s, s + m[5].length);
    } else if (m[6] !== undefined) {
      push(m[6], 'punctuation', s, s + m[6].length);
    } else {
      const t = m[7] ?? m[0];
      push(t, 'plain', s, s + t.length);
    }
    last = RE.lastIndex;
  }
  if (last < text.length) {
    push(text.slice(last), 'plain', last, text.length);
  }
  return tokens;
}

/**
 * Resolve the display colour for a given token type under a palette.
 *
 * @param {string} type  Token type returned by tokenizeJSON
 * @param {object} pm    LIGHT_PM or DARK_PM
 * @returns {string}
 */
export function tokenColor(type, pm) {
  switch (type) {
    case 'key':         return pm.jsonKey;
    case 'string':      return pm.jsonString;
    case 'number':      return pm.jsonNumber;
    case 'keyword':     return pm.jsonKeyword;
    case 'punctuation':
    case 'colon':       return pm.jsonPunct;
    default:            return pm.text;
  }
}
