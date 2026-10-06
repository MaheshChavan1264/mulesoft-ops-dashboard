/**
 * Pure spec-parsing helpers extracted from routes/exchange.js's `/ping-spec`
 * handler. These have zero Express/axios coupling — given a parsed model /
 * raw file buffer, they return endpoint arrays — which makes them trivially
 * unit-testable without spinning up a server or mocking Exchange.
 *
 * Supported shapes:
 *  - AMF JSON-LD graph (Exchange "portal model" API, modern RAML/OAS specs)
 *  - RAML-style plain object with a `resources` tree (older portal model)
 *  - OAS plain object with a `paths` map (older portal model / raw OAS file)
 *  - Raw OAS file content (JSON or YAML)
 *  - Raw RAML file content (regex-based best-effort text parser)
 *  - A hand-rolled ZIP central-directory reader for Exchange's "fat" asset
 *    archives (api.json / *.raml / *.yaml entries), since Exchange serves
 *    some spec files as ZIPs rather than raw text.
 */
const zlib = require('zlib');

const PING_KEYWORDS = ['ping', 'health', 'status', 'liveness', 'readiness', 'heartbeat'];

/** @param {string} path */
const isPingPath = (path) => PING_KEYWORDS.some((k) => (path || '').toLowerCase().includes(k));

/**
 * Convert a RAML queryParameters / headers object into the canonical
 * param array shape. Used by walkResources for both RAML model shapes.
 */
const toArr = (obj) =>
  Object.entries(obj || {}).map(([name, v]) => ({
    name,
    required: v.required === true || v.required === 'true',
    type: v.type || 'string',
    description: v.description || '',
    example: v.example != null ? String(v.example) : '',
  }));

/**
 * Recursively walk a RAML resources tree and push endpoint objects into
 * the provided `out` array.
 *
 * @param {Array}  resources   RAML resource nodes
 * @param {string} parentPath  Accumulated path prefix
 * @param {Array}  out         Output array to push into
 * @param {boolean} useDisplayName  Whether to prefer displayName over description
 */
function walkResources(resources = [], parentPath = '', out = [], useDisplayName = false) {
  for (const r of resources) {
    const path = parentPath + (r.relativeUri || r.path || '');
    for (const m of (r.methods || [])) {
      const method = (m.method || 'GET').toUpperCase();
      out.push({
        path,
        method,
        description: useDisplayName
          ? (m.description || m.displayName || '')
          : (m.description || ''),
        queryParams: toArr(m.queryParameters),
        headers: toArr(m.headers),
      });
    }
    if (r.resources?.length) walkResources(r.resources, path, out, useDisplayName);
  }
  return out;
}

/**
 * Extract query or header params from an OAS parameters array.
 *
 * @param {Array}  params    OAS parameters array (path-level + operation-level merged)
 * @param {string} inFilter  'query' or 'header'
 */
const extractOasParams = (params = [], inFilter) =>
  params
    .filter((p) => p.in === inFilter)
    .map((p) => ({
      name: p.name,
      required: !!p.required,
      type: p.schema?.type || p.type || 'string',
      description: p.description || '',
      example:
        p.example != null
          ? String(p.example)
          : p.schema?.example != null
          ? String(p.schema.example)
          : '',
    }));

/** Parse an OAS `paths` object (with optional basePath/servers) into endpoints. */
function parseOasPaths(spec) {
  const endpoints = [];
  let bp = (spec.basePath || '').replace(/\/+$/, '');
  if (!bp && spec.servers?.[0]?.url) {
    try {
      bp = new URL(spec.servers[0].url).pathname.replace(/\/+$/, '');
    } catch {
      const su = spec.servers[0].url || '';
      bp = su.startsWith('/') ? su.replace(/\/+$/, '') : '';
    }
  }
  for (const [rawPath, pathItem] of Object.entries(spec.paths || {})) {
    const normalizedPath = ('/' + rawPath.replace(/^\/+/, '')).replace(/\/\//g, '/');
    for (const meth of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const op = pathItem[meth];
      if (!op) continue;
      const params = [...(pathItem.parameters || []), ...(op.parameters || [])];
      endpoints.push({
        path: (bp + normalizedPath).replace(/\/\//g, '/'),
        method: meth.toUpperCase(),
        description: op.summary || op.description || '',
        queryParams: extractOasParams(params, 'query'),
        headers: extractOasParams(params, 'header'),
      });
    }
  }
  return { endpoints, basePath: bp };
}

// ── AMF JSON-LD graph parsing ─────────────────────────────────────────────────

/** Safely extract a string value from an AMF scalar node. */
function scalar(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return scalar(node[0]);
  if (typeof node === 'object') {
    return node['@value'] || node.value || node.lexicalValue || '';
  }
  return String(node);
}

function boolVal(node) {
  const v = scalar(node);
  return v === true || v === 'true';
}

/** Extract param list from AMF parameter nodes. */
function extractAmfParams(params = []) {
  return params
    .map((p) => {
      const name = scalar(
        p['http://a.ml/vocabularies/apiContract#paramName'] ||
        p['http://schema.org/name'] ||
        p['@id'] || ''
      );
      const required = boolVal(
        p['http://a.ml/vocabularies/shapes#required'] ||
        p['http://www.w3.org/ns/hydra/core#required']
      );
      const schema = (p['http://a.ml/vocabularies/shapes#range'] || [])[0] || {};
      const type = scalar(
        schema['http://www.w3.org/1999/02/22-rdf-syntax-ns#type'] ||
        schema['xsd:type'] || schema['@type'] || 'string'
      ).replace(/.*#/, '').toLowerCase();
      const description = scalar(
        p['http://schema.org/description'] ||
        p['http://a.ml/vocabularies/core#description'] || ''
      );
      const example = scalar(
        p['http://a.ml/vocabularies/document#examples'] ||
        p['http://a.ml/vocabularies/apiContract#examples'] || ''
      );
      return { name, required, type: type || 'string', description, example };
    })
    .filter((p) => p.name);
}

/**
 * Parse an AMF JSON-LD graph (array of @id nodes) — the shape returned by
 * Exchange's portal model API for modern RAML/OAS specs.
 *
 * @param {Array} model
 * @returns {{ assetName: string, endpoints: Array } | null}  null if this isn't an AMF JSON-LD graph
 */
function parseAmfJsonLd(model) {
  if (!Array.isArray(model) || !model[0]?.['@type']) return null;

  const docNode = model.find((n) =>
    (n['@type'] || []).some((t) => t.includes('Document') || t.includes('ParsedUnit'))
  ) || model[0];

  const encodes = docNode?.['http://a.ml/vocabularies/document#encodes'] || [];
  const apiNode = encodes[0] || {};
  const assetName = scalar(
    apiNode['http://schema.org/name'] || apiNode['http://a.ml/vocabularies/core#name']
  ) || null;

  const nodeMap = {};
  for (const n of model) {
    if (n['@id']) nodeMap[n['@id']] = n;
  }

  const deref = (node) => {
    if (!node) return node;
    if (Array.isArray(node)) return node.map(deref);
    if (typeof node === 'object' && node['@id'] && Object.keys(node).length === 1) {
      return nodeMap[node['@id']] || node;
    }
    return node;
  };

  const PATH_KEY = 'http://a.ml/vocabularies/apiContract#path';
  const OP_KEY = 'http://a.ml/vocabularies/apiContract#supportedOperation';
  const METHOD_KEY = 'http://a.ml/vocabularies/apiContract#method';
  const EXPECTS_KEY = 'http://a.ml/vocabularies/apiContract#expects';
  const PARAM_KEY = 'http://a.ml/vocabularies/apiContract#parameter';
  const HEADER_KEY = 'http://a.ml/vocabularies/apiContract#header';

  const endpoints = [];
  for (const node of model) {
    if (!node[PATH_KEY]) continue;
    const path = scalar(node[PATH_KEY]);
    if (!path) continue;
    const operations = (node[OP_KEY] || []).map(deref).flat().filter(Boolean);
    for (const op of operations) {
      const realOp = deref(op);
      if (!realOp) continue;
      const method = scalar(
        realOp[METHOD_KEY] || (Array.isArray(realOp) ? realOp[0]?.[METHOD_KEY] : null)
      ).toUpperCase() || 'GET';
      const description = scalar(
        realOp['http://schema.org/description'] ||
        realOp['http://a.ml/vocabularies/core#name'] || ''
      );
      const expects = ((realOp[EXPECTS_KEY] || []).map(deref).flat().filter(Boolean))[0] || {};
      const qpNodes = (expects[PARAM_KEY] || []).map(deref).flat().filter(Boolean);
      const hdrNodes = (expects[HEADER_KEY] || []).map(deref).flat().filter(Boolean);
      endpoints.push({
        path,
        method,
        description,
        queryParams: extractAmfParams(qpNodes),
        headers: extractAmfParams(hdrNodes),
      });
    }
  }

  return { assetName, endpoints };
}

/**
 * Parse the Exchange portal "model" response (any of the known shapes) into
 * `{ specType, assetName, endpoints }`. Returns `endpoints: []` (not an
 * error) when nothing recognisable was found — callers fall back to the raw
 * asset-file download path in that case.
 *
 * @param {any} model
 * @param {string} assetIdFallback  used as assetName when the model has no name
 */
function parsePortalModel(model, assetIdFallback) {
  // Shape A: AMF JSON-LD graph
  const amf = parseAmfJsonLd(model);
  if (amf && amf.endpoints.length > 0) {
    return { specType: 'amf-jsonld', assetName: amf.assetName || assetIdFallback, endpoints: amf.endpoints };
  }

  // Shape B: RAML-style plain object with `resources` array, or OAS plain object with `paths`
  if (model && typeof model === 'object' && !Array.isArray(model)) {
    const assetName = model.title || model.name || assetIdFallback;

    if (model.resources) {
      const endpoints = walkResources(model.resources, '', [], true);
      if (endpoints.length > 0) {
        return { specType: model.specType || 'raml', assetName, endpoints };
      }
    }
    if (model.paths) {
      const { endpoints } = parseOasPaths(model);
      if (endpoints.length > 0) {
        return { specType: 'oas', assetName, endpoints };
      }
    }
  }

  // Shape C: Array of resources (some older console formats)
  if (Array.isArray(model) && model[0]?.relativeUri) {
    const endpoints = walkResources(model, '', [], false);
    if (endpoints.length > 0) {
      return { specType: 'raml', assetName: assetIdFallback, endpoints };
    }
  }

  return { specType: 'unknown', assetName: assetIdFallback, endpoints: [] };
}

// ── Raw spec-file parsing (fallback when the portal model API has nothing) ───

/** Parse a raw OAS file (already JSON.parse'd or js-yaml-loaded). */
function parseOasSpecFile(spec) {
  if (!spec?.paths) return { endpoints: [] };
  return parseOasPaths(spec);
}

/**
 * Best-effort regex parser for raw RAML text — used only when the asset's
 * RAML file couldn't be parsed any other way. Deliberately simple: it only
 * needs to find ping/health paths and their query/header params, not fully
 * parse RAML.
 */
function parseRamlText(content) {
  const endpoints = [];
  const lines = content.split('\n');
  let curPath = '', curEp = null, inQp = false, inHdr = false, curParam = '';
  for (const line of lines) {
    const pm = line.match(/^(\/[\w\-/{}]*):\s*$/);
    if (pm) { curPath = pm[1]; curEp = null; inQp = false; inHdr = false; continue; }
    const mm = line.match(/^ {2}(get|post|put|delete|patch):\s*$/);
    if (mm && curPath) {
      curEp = { path: curPath, method: mm[1].toUpperCase(), description: '', queryParams: [], headers: [] };
      endpoints.push(curEp); inQp = false; inHdr = false; continue;
    }
    if (curEp) {
      if (/^ {4}queryParameters:\s*$/.test(line)) { inQp = true; inHdr = false; continue; }
      if (/^ {4}headers:\s*$/.test(line)) { inHdr = true; inQp = false; continue; }
      const paramM = line.match(/^ {6}([\w-]+):\s*$/);
      if (paramM && (inQp || inHdr)) {
        curParam = paramM[1];
        const p = { name: curParam, required: false, type: 'string', description: '', example: '' };
        if (inQp) curEp.queryParams.push(p); else curEp.headers.push(p);
        continue;
      }
      const propM = line.match(/^ {8}(type|description|example|required):\s*(.+)$/);
      if (propM && curParam) {
        const arr = inQp ? curEp.queryParams : curEp.headers;
        const p = arr.find((x) => x.name === curParam);
        if (p) {
          const v = propM[2].trim().replace(/^["']|["']$/g, '');
          if (propM[1] === 'type') p.type = v;
          else if (propM[1] === 'description') p.description = v;
          else if (propM[1] === 'example') p.example = v;
          else if (propM[1] === 'required') p.required = v === 'true';
        }
      }
    }
  }
  return { endpoints };
}

// ── ZIP extraction (Exchange "fat" asset archives) ────────────────────────────

/**
 * Minimal ZIP central-directory reader: finds the best-guess spec file
 * entry (api.json / *.yaml / *.raml, excluding exchange.json) and inflates
 * it. Deliberately narrow — this only needs to pull one small text file out
 * of a ZIP, not be a general-purpose archive reader.
 *
 * Exchange's "fat" archives for a MODULARIZED OAS/RAML spec contain the
 * root document PLUS many `$ref`'d fragment files (components/, paths/,
 * examples/...). The old version returned whichever file matched an
 * extension FIRST in ZIP central-directory order — for a modularized spec
 * that's often a tiny fragment (e.g. just an `info`/`components` snippet),
 * which parses fine as valid JSON/YAML but has an empty `paths`/`resources`
 * section, silently producing "0 endpoints" even though the asset has a
 * real spec. Instead, rank all plausible candidates and prefer the one
 * that actually looks like a root document (declares `openapi`/`swagger`/
 * RAML header, or has a non-empty `paths:`/`resources:`), falling back to
 * the old first-match behaviour only if none of them look like a root.
 *
 * @param {Buffer} buf
 * @returns {string|null}  the extracted file's text content, or null on any failure
 */
function extractSpecFileFromZip(buf) {
  try {
    const cdEntries = [];
    let pos = 0;
    while (pos < buf.length - 4) {
      if (buf[pos] === 0x50 && buf[pos + 1] === 0x4b && buf[pos + 2] === 0x01 && buf[pos + 3] === 0x02) {
        const compMethod = buf.readUInt16LE(pos + 10);
        const compSize = buf.readUInt32LE(pos + 20);
        const uncompSize = buf.readUInt32LE(pos + 24);
        const fnLen = buf.readUInt16LE(pos + 28);
        const extraLen = buf.readUInt16LE(pos + 30);
        const commentLen = buf.readUInt16LE(pos + 32);
        const localOffset = buf.readUInt32LE(pos + 42);
        const fn = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
        cdEntries.push({ fn, compMethod, compSize, uncompSize, localOffset });
        pos += 46 + fnLen + extraLen + commentLen;
      } else {
        pos++;
      }
    }

    const inflateEntry = (e) => {
      const lh = e.localOffset;
      const lfnLen = buf.readUInt16LE(lh + 26);
      const lextraLen = buf.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + lfnLen + lextraLen;
      const compressed = buf.slice(dataStart, dataStart + e.compSize);
      const raw = e.compMethod === 8 ? zlib.inflateRawSync(compressed) : compressed;
      return raw.toString('utf8');
    };

    // Root documents are conventionally at the archive's top level;
    // fragments live under subfolders (components/, paths/, types/...).
    const isRootLevel = (fn) => !fn.includes('/') && !fn.includes('\\');
    const jsonCandidates = cdEntries.filter((e) => e.fn.endsWith('.json') && e.fn !== 'exchange.json');
    const yamlCandidates = cdEntries.filter((e) => e.fn.endsWith('.yaml') || e.fn.endsWith('.yml'));
    const ramlCandidates = cdEntries.filter((e) => e.fn.endsWith('.raml') && e.fn !== 'exchange.json');

    // Old priority (json > yaml > raml) preserved, but within each type
    // root-level files are tried before nested fragments.
    const ranked = [
      ...jsonCandidates.filter((e) => e.fn === 'api.json'),
      ...jsonCandidates.filter((e) => isRootLevel(e.fn) && e.fn !== 'api.json'),
      ...yamlCandidates.filter((e) => isRootLevel(e.fn)),
      ...ramlCandidates.filter((e) => isRootLevel(e.fn)),
      ...jsonCandidates.filter((e) => !isRootLevel(e.fn)),
      ...yamlCandidates.filter((e) => !isRootLevel(e.fn)),
      ...ramlCandidates.filter((e) => !isRootLevel(e.fn)),
    ];
    if (ranked.length === 0) return null;

    const looksLikeRootDoc = (text) =>
      /^\s*(openapi|swagger)\s*:/im.test(text) ||
      /"(openapi|swagger)"\s*:/.test(text) ||
      /^#%RAML/m.test(text) ||
      /^\s*paths\s*:/m.test(text) ||
      /"paths"\s*:\s*\{/.test(text) ||
      /^\s*resources\s*:/m.test(text);

    let fallbackContent = null;
    for (const entry of ranked) {
      let text;
      try { text = inflateEntry(entry); } catch { continue; }
      if (fallbackContent === null) fallbackContent = text; // guaranteed non-null fallback
      if (looksLikeRootDoc(text)) return text;
    }
    return fallbackContent;
  } catch {
    return null;
  }
}

module.exports = {
  PING_KEYWORDS,
  isPingPath,
  toArr,
  walkResources,
  extractOasParams,
  parseOasPaths,
  parsePortalModel,
  parseOasSpecFile,
  parseRamlText,
  extractSpecFileFromZip,
};
