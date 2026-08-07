const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');

// Search Exchange assets
router.get('/search', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const {
      search = '',
      type,
      organizationId,
      offset = 0,
      limit = 20,
      sortBy = 'updatedAt',
      ascending = false
    } = req.query;

    const params = { offset, limit, sortBy, ascending };
    if (search) params.search = search;
    if (type) params.type = type;
    if (organizationId) params.organizationId = organizationId;

    const response = await client.get('/exchange/api/v2/assets', { params });
    res.json(response.data);
  } catch (error) {
    console.error('Error searching Exchange:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to search Exchange'
    });
  }
});

// Organization assets summary
router.get('/org/:orgId/summary', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const types = ['rest-api', 'soap-api', 'http-api', 'mule-application', 'mule-plugin', 'template', 'example'];
    const counts = {};

    await Promise.all(
      types.map(async (type) => {
        try {
          const response = await client.get('/exchange/api/v2/assets', {
            params: { organizationId: req.params.orgId, type, limit: 1 }
          });
          counts[type] = response.data.total || 0;
        } catch {
          counts[type] = 0;
        }
      })
    );

    res.json({ organizationId: req.params.orgId, assetCounts: counts });
  } catch (error) {
    console.error('Error fetching Exchange summary:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch Exchange summary'
    });
  }
});

// Get asset versions list — MUST be before /:groupId/:assetId/:version to avoid collision
router.get('/:groupId/:assetId/versions', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching asset versions:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch asset versions'
    });
  }
});

// Get a specific Exchange asset by version — keep AFTER /versions route
router.get('/:groupId/:assetId/:version', authMiddleware, async (req, res) => {
  try {
    const client = createClient(req.anypointToken);
    const response = await client.get(
      `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}/${req.params.version}`
    );
    res.json(response.data);
  } catch (error) {
    console.error('Error fetching Exchange asset:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch Exchange asset'
    });
  }
});

// ─── GET /api/exchange/ping-spec ─────────────────────────────────────────────
/**
 * Fetch and parse an API spec from Exchange to discover ping/health endpoints
 * along with their query parameters and required headers.
 *
 * The Exchange asset files list is inspected for:
 *   1. OAS (OpenAPI) JSON/YAML  — parse paths for /ping, /health, /status
 *   2. fat-raml ZIP            — download the main RAML file and parse resources
 *   3. raml                    — same as above
 *
 * Returns:
 *   {
 *     specType: 'oas' | 'raml' | 'unknown',
 *     pingEndpoints: [{
 *       path, method, description,
 *       queryParams: [{ name, required, type, description, example }],
 *       headers: [{ name, required, type, description, example }]
 *     }],
 *     allEndpoints: [...]  // all endpoints (not just ping), for the API Spec tab
 *   }
 */
router.get('/ping-spec', authMiddleware, async (req, res) => {
  const { groupId, assetId, version, orgId } = req.query;
  if (!groupId || !assetId || !version) {
    return res.status(400).json({ error: 'groupId, assetId, and version are required' });
  }

  try {
    const client = createClient(req.anypointToken);

    const PING_KEYWORDS = ['ping', 'health', 'status', 'liveness', 'readiness', 'heartbeat'];
    const isPingPath = (path) => PING_KEYWORDS.some(k => (path || '').toLowerCase().includes(k));

    // ── Step 1: Try the Exchange Portal Model API ─────────────────────────
    // GET /exchange/api/v2/assets/{groupId}/{assetId}/{version}/portal/model
    // This is the SAME endpoint the Exchange UI / API Console uses.
    // Returns the fully parsed API model tree as JSON — no spec download needed.
    let assetName = assetId;
    let specType = 'unknown';
    let allEndpoints = [];
    let modelParsed = false;

    try {
      const modelRes = await client.get(
        `/exchange/api/v2/assets/${groupId}/${assetId}/${version}/portal/model`
      );
      const model = modelRes.data;
      // Log the top-level keys and type to help debug parsing
      if (Array.isArray(model)) {
        console.log(`[ping-spec] Portal model is Array, length=${model.length}, first item keys:`, Object.keys(model[0] || {}).slice(0, 6));
      } else if (model && typeof model === 'object') {
        console.log(`[ping-spec] Portal model is Object, top-level keys:`, Object.keys(model).slice(0, 10));
      }

      // Helper: safely extract string value from AMF scalar node
      const scalar = (node) => {
        if (!node) return '';
        if (typeof node === 'string') return node;
        if (Array.isArray(node)) return scalar(node[0]);
        if (typeof node === 'object') {
          return node['@value'] || node.value || node.lexicalValue || '';
        }
        return String(node);
      };

      const boolVal = (node) => {
        const v = scalar(node);
        return v === true || v === 'true';
      };

      // Helper: extract param list from AMF parameter nodes
      const extractAmfParams = (params = []) =>
        params.map(p => {
          const name = scalar(p['http://a.ml/vocabularies/apiContract#paramName']
            || p['http://schema.org/name']
            || p['@id'] || '');
          const required = boolVal(p['http://a.ml/vocabularies/shapes#required']
            || p['http://www.w3.org/ns/hydra/core#required']);
          const schema = (p['http://a.ml/vocabularies/shapes#range'] || [])[0] || {};
          const type = scalar(schema['http://www.w3.org/1999/02/22-rdf-syntax-ns#type']
            || schema['xsd:type'] || schema['@type'] || 'string')
            .replace(/.*#/, '').toLowerCase();
          const description = scalar(p['http://schema.org/description']
            || p['http://a.ml/vocabularies/core#description'] || '');
          const example = scalar(p['http://a.ml/vocabularies/document#examples']
            || p['http://a.ml/vocabularies/apiContract#examples'] || '');
          return { name, required, type: type || 'string', description, example };
        }).filter(p => p.name);

      // The portal/model response can be in multiple shapes depending on the
      // API type (RAML 0.8, RAML 1.0, OAS 2, OAS 3). Handle the three main shapes:

      // Shape A: AMF JSON-LD graph (array of @id nodes)
      if (Array.isArray(model) && model[0]?.['@type']) {
        specType = 'amf-jsonld';
        const docNode = model.find(n =>
          (n['@type'] || []).some(t => t.includes('Document') || t.includes('ParsedUnit'))
        ) || model[0];

        const encodes = docNode?.['http://a.ml/vocabularies/document#encodes'] || [];
        const apiNode = encodes[0] || {};
        assetName = scalar(apiNode['http://schema.org/name'] || apiNode['http://a.ml/vocabularies/core#name']) || assetId;

        // Walk the full graph to find endpoint nodes regardless of nesting
        // (AMF may inline endpoints in the graph rather than on the encodes node)
        const allNodes = model;

        // Build a map of id → node for dereferencing $ref-style links
        const nodeMap = {};
        for (const n of allNodes) {
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

        // Find all endpoint nodes (any node with apiContract#path)
        const PATH_KEY = 'http://a.ml/vocabularies/apiContract#path';
        const OP_KEY   = 'http://a.ml/vocabularies/apiContract#supportedOperation';
        const METHOD_KEY = 'http://a.ml/vocabularies/apiContract#method';
        const EXPECTS_KEY = 'http://a.ml/vocabularies/apiContract#expects';
        const PARAM_KEY = 'http://a.ml/vocabularies/apiContract#parameter';
        const HEADER_KEY = 'http://a.ml/vocabularies/apiContract#header';

        for (const node of allNodes) {
          if (!node[PATH_KEY]) continue;
          const path = scalar(node[PATH_KEY]);
          if (!path) continue;

          const operations = (node[OP_KEY] || []).map(deref).flat().filter(Boolean);
          for (const op of operations) {
            const realOp = deref(op);
            if (!realOp) continue;
            const method = scalar(realOp[METHOD_KEY] || (Array.isArray(realOp) ? realOp[0]?.[METHOD_KEY] : null)).toUpperCase() || 'GET';
            const description = scalar(realOp['http://schema.org/description'] || realOp['http://a.ml/vocabularies/core#name'] || '');
            const expects = ((realOp[EXPECTS_KEY] || []).map(deref).flat().filter(Boolean))[0] || {};
            const qpNodes = (expects[PARAM_KEY] || []).map(deref).flat().filter(Boolean);
            const hdrNodes = (expects[HEADER_KEY] || []).map(deref).flat().filter(Boolean);
            allEndpoints.push({
              path, method, description,
              queryParams: extractAmfParams(qpNodes),
              headers: extractAmfParams(hdrNodes),
            });
          }
        }
        if (allEndpoints.length > 0) {
          console.log(`[ping-spec] AMF JSON-LD: extracted ${allEndpoints.length} endpoint(s)`);
        }
        modelParsed = allEndpoints.length > 0;
      }

      // Shape B: RAML-style plain object with `resources` array (RAML 0.8 / console model)
      if (!modelParsed && model && typeof model === 'object' && !Array.isArray(model)) {
        specType = model.specType || (model.resources ? 'raml' : 'oas');
        assetName = model.title || model.name || assetId;
        const basePath = model.basePath || model.baseUri || '';

        // RAML: model.resources[]
        const walkResources = (resources = [], parentPath = '') => {
          for (const r of resources) {
            const path = parentPath + (r.relativeUri || r.path || '');
            for (const m of (r.methods || [])) {
              const method = (m.method || 'GET').toUpperCase();
              const qpRaw = m.queryParameters || {};
              const hdrRaw = m.headers || {};
              const toArr = (obj) => Object.entries(obj).map(([name, v]) => ({
                name,
                required: v.required === true || v.required === 'true',
                type: v.type || 'string',
                description: v.description || '',
                example: v.example != null ? String(v.example) : '',
              }));
              allEndpoints.push({
                path,
                method,
                description: m.description || m.displayName || '',
                queryParams: toArr(qpRaw),
                headers: toArr(hdrRaw),
              });
            }
            if (r.resources?.length) walkResources(r.resources, path);
          }
        };

        if (model.resources) {
          walkResources(model.resources);
          modelParsed = allEndpoints.length > 0;
        }

        // OAS: model.paths{}
        if (!modelParsed && model.paths) {
          specType = 'oas';
          const bp = model.basePath || '';
          const extractOasParams = (params = [], inFilter) =>
            params.filter(p => p.in === inFilter).map(p => ({
              name: p.name,
              required: !!p.required,
              type: p.schema?.type || p.type || 'string',
              description: p.description || '',
              example: p.example != null ? String(p.example) : (p.schema?.example != null ? String(p.schema.example) : ''),
            }));
          for (const [rawPath, pathItem] of Object.entries(model.paths)) {
            const fullPath = bp + rawPath;
            for (const meth of ['get','post','put','patch','delete','head','options']) {
              const op = pathItem[meth];
              if (!op) continue;
              const params = [...(pathItem.parameters || []), ...(op.parameters || [])];
              allEndpoints.push({
                path: fullPath,
                method: meth.toUpperCase(),
                description: op.summary || op.description || '',
                queryParams: extractOasParams(params, 'query'),
                headers: extractOasParams(params, 'header'),
              });
            }
          }
          modelParsed = allEndpoints.length > 0;
        }
      }

      // Shape C: Array of resources (some older console formats)
      if (!modelParsed && Array.isArray(model) && model[0]?.relativeUri) {
        specType = 'raml';
        const walkResources = (resources = [], parentPath = '') => {
          for (const r of resources) {
            const path = parentPath + (r.relativeUri || '');
            for (const m of (r.methods || [])) {
              const qpRaw = m.queryParameters || {};
              const hdrRaw = m.headers || {};
              const toArr = (obj) => Object.entries(obj).map(([name, v]) => ({
                name, required: v.required === true, type: v.type || 'string',
                description: v.description || '', example: v.example != null ? String(v.example) : '',
              }));
              allEndpoints.push({
                path, method: (m.method || 'GET').toUpperCase(),
                description: m.description || '',
                queryParams: toArr(qpRaw), headers: toArr(hdrRaw),
              });
            }
            if (r.resources?.length) walkResources(r.resources, path);
          }
        };
        walkResources(model);
        modelParsed = allEndpoints.length > 0;
      }

    } catch (modelErr) {
      console.warn(`[ping-spec] Portal model API failed (${modelErr.response?.status || modelErr.message}), falling back to asset file download`);
    }

    // ── Step 2: Fallback — download and parse the spec file ───────────────
    // Only runs if the portal/model endpoint failed or returned no endpoints.
    // Key fixes:
    //   1. Files are stored as ZIPs in S3 — download as arraybuffer (not text)
    //   2. S3 pre-signed URLs must NOT have an Authorization header
    //   3. Parse the ZIP central directory and inflate the spec file (api.json / *.yaml)
    if (!modelParsed) {
      const axios = require('axios');
      const zlib  = require('zlib');

      /**
       * Extract the main spec file from a ZIP buffer.
       * Uses the ZIP central directory (reliable compressed sizes) and
       * zlib.inflateRawSync for deflate-compressed entries.
       * Returns the spec text string or null on failure.
       */
      const extractFromZip = (buf) => {
        try {
          // Parse central directory to get correct sizes + local offsets
          const cdEntries = [];
          let pos = 0;
          while (pos < buf.length - 4) {
            if (buf[pos]===0x50 && buf[pos+1]===0x4b && buf[pos+2]===0x01 && buf[pos+3]===0x02) {
              const compMethod = buf.readUInt16LE(pos + 10);
              const compSize   = buf.readUInt32LE(pos + 20);
              const uncompSize = buf.readUInt32LE(pos + 24);
              const fnLen      = buf.readUInt16LE(pos + 28);
              const extraLen   = buf.readUInt16LE(pos + 30);
              const commentLen = buf.readUInt16LE(pos + 32);
              const localOffset= buf.readUInt32LE(pos + 42);
              const fn = buf.slice(pos + 46, pos + 46 + fnLen).toString('utf8');
              cdEntries.push({ fn, compMethod, compSize, uncompSize, localOffset });
              pos += 46 + fnLen + extraLen + commentLen;
            } else { pos++; }
          }
          // Priority: api.json > *.json (not exchange.json) > *.yaml > *.raml
          const specEntry = cdEntries.find(e => e.fn === 'api.json')
            || cdEntries.find(e => e.fn.endsWith('.json') && e.fn !== 'exchange.json')
            || cdEntries.find(e => e.fn.endsWith('.yaml') || e.fn.endsWith('.yml'))
            || cdEntries.find(e => e.fn.endsWith('.raml') && e.fn !== 'exchange.json');
          if (!specEntry) return null;
          const lh = specEntry.localOffset;
          const lfnLen   = buf.readUInt16LE(lh + 26);
          const lextraLen= buf.readUInt16LE(lh + 28);
          const dataStart = lh + 30 + lfnLen + lextraLen;
          const compressed = buf.slice(dataStart, dataStart + specEntry.compSize);
          const raw = specEntry.compMethod === 8
            ? zlib.inflateRawSync(compressed)
            : compressed;
          return raw.toString('utf8');
        } catch (e) {
          console.warn('[ping-spec] ZIP extraction error:', e.message);
          return null;
        }
      };

      try {
        const assetRes = await client.get(`/exchange/api/v2/assets/${groupId}/${assetId}/${version}`);
        const asset = assetRes.data;
        assetName = asset.name || assetId;
        const files = asset.files || [];

        const findFile = (...classifiers) => {
          for (const c of classifiers) {
            const f = files.find(fi => fi.classifier === c);
            if (f) return f;
          }
          return null;
        };
        // Prefer fat-oas (resolved/flattened) for most complete spec
        const oasFile  = findFile('fat-oas', 'oas');
        const ramlFile = findFile('fat-raml', 'raml');
        const specFile = oasFile || ramlFile;

        if (specFile?.externalLink) {
          // S3 pre-signed URLs already carry auth in query params — sending
          // an Authorization header causes S3 to return 400 InvalidArgument.
          const isS3 = specFile.externalLink.includes('s3.amazonaws.com');
          const dlRes = await axios.get(specFile.externalLink, {
            headers: isS3 ? {} : { Authorization: `Bearer ${req.anypointToken}` },
            responseType: 'arraybuffer',  // always binary — zip or not
            timeout: 20000,
          });
          const buf = Buffer.from(dlRes.data);
          const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
          let content;
          if (isZip) {
            content = extractFromZip(buf);
            console.log('[ping-spec] ZIP extracted:', content ? `${content.length} chars` : 'FAILED');
          } else {
            content = buf.toString('utf8');
          }
          if (!content) throw new Error('Could not extract spec content from file');

          if (oasFile) {
            specType = 'oas';
            let spec = null;
            try { spec = JSON.parse(content); } catch {}
            if (spec?.paths) {
              const bp = spec.basePath || '';
              for (const [rawPath, pathItem] of Object.entries(spec.paths)) {
                for (const meth of ['get','post','put','patch','delete','head','options']) {
                  const op = pathItem[meth];
                  if (!op) continue;
                  const params = [...(pathItem.parameters || []), ...(op.parameters || [])];
                  allEndpoints.push({
                    path: bp + rawPath, method: meth.toUpperCase(),
                    description: op.summary || op.description || '',
                    queryParams: params.filter(p => p.in === 'query').map(p => ({
                      name: p.name, required: !!p.required,
                      type: p.schema?.type || p.type || 'string',
                      description: p.description || '',
                      example: p.example != null ? String(p.example) : '',
                    })),
                    headers: params.filter(p => p.in === 'header').map(p => ({
                      name: p.name, required: !!p.required, type: p.type || 'string',
                      description: p.description || '', example: '',
                    })),
                  });
                }
              }
            }
          } else if (ramlFile) {
            specType = 'raml';
            // Basic regex fallback (same as before)
            const lines = content.split('\n');
            let curPath = '', curEp = null, inQp = false, inHdr = false, curParam = '';
            for (const line of lines) {
              const pm = line.match(/^(\/[\w\-\/{}]*):\s*$/);
              if (pm) { curPath = pm[1]; curEp = null; inQp = false; inHdr = false; continue; }
              const mm = line.match(/^  (get|post|put|delete|patch):\s*$/);
              if (mm && curPath) {
                curEp = { path: curPath, method: mm[1].toUpperCase(), description: '', queryParams: [], headers: [] };
                allEndpoints.push(curEp); inQp = false; inHdr = false; continue;
              }
              if (curEp) {
                if (/^    queryParameters:\s*$/.test(line)) { inQp = true; inHdr = false; continue; }
                if (/^    headers:\s*$/.test(line)) { inHdr = true; inQp = false; continue; }
                const paramM = line.match(/^      ([\w\-]+):\s*$/);
                if (paramM && (inQp || inHdr)) {
                  curParam = paramM[1];
                  const p = { name: curParam, required: false, type: 'string', description: '', example: '' };
                  if (inQp) curEp.queryParams.push(p); else curEp.headers.push(p);
                  continue;
                }
                const propM = line.match(/^        (type|description|example|required):\s*(.+)$/);
                if (propM && curParam) {
                  const arr = inQp ? curEp.queryParams : curEp.headers;
                  const p = arr.find(x => x.name === curParam);
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
          }
        }
      } catch (fbErr) {
        console.warn('[ping-spec] Fallback file download also failed:', fbErr.message);
      }
    }

    const pingEndpoints = allEndpoints.filter(e => isPingPath(e.path));
    console.log(`[ping-spec] ${groupId}/${assetId}/${version} (${specType}): ${allEndpoints.length} endpoints, ${pingEndpoints.length} ping path(s)`);

    return res.json({ specType, assetName, pingEndpoints, allEndpoints });

  } catch (error) {
    console.error('[ping-spec] Error:', error.response?.data || error.message);
    res.status(error.response?.status || 500).json({
      error: error.response?.data?.message || 'Failed to fetch ping spec',
      specType: 'unknown',
      pingEndpoints: [],
      allEndpoints: [],
    });
  }
});

module.exports = router;
