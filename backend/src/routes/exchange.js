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
    const axios = require('axios');

    // 1. Fetch asset metadata from Exchange
    const assetRes = await client.get(
      `/exchange/api/v2/assets/${groupId}/${assetId}/${version}`
    );
    const asset = assetRes.data;
    const files = asset.files || [];

    // 2. Determine spec type and find the best file to download
    //    Priority: OAS JSON > OAS YAML > fat-raml > raml
    const findFile = (...classifiers) => {
      for (const c of classifiers) {
        const f = files.find(f => f.classifier === c);
        if (f) return f;
      }
      return null;
    };

    const oasFile   = findFile('oas');
    const ramlFile  = findFile('fat-raml', 'raml');
    const specFile  = oasFile || ramlFile;

    if (!specFile || !specFile.externalLink) {
      return res.json({ specType: 'unknown', pingEndpoints: [], allEndpoints: [] });
    }

    // 3. Download the spec file using the bearer token
    let specContent = '';
    try {
      const downloadRes = await axios.get(specFile.externalLink, {
        headers: { Authorization: `Bearer ${req.anypointToken}` },
        responseType: 'text',
        timeout: 15000,
      });
      specContent = typeof downloadRes.data === 'string'
        ? downloadRes.data
        : JSON.stringify(downloadRes.data);
    } catch (dlErr) {
      console.warn('[ping-spec] Could not download spec file:', dlErr.message);
      return res.json({ specType: 'unknown', pingEndpoints: [], allEndpoints: [], error: 'Could not download spec' });
    }

    // 4. Parse the spec
    const PING_KEYWORDS = ['ping', 'health', 'status', 'liveness', 'readiness', 'heartbeat'];

    const isPingPath = (path) =>
      PING_KEYWORDS.some(k => path.toLowerCase().includes(k));

    let specType = 'unknown';
    let allEndpoints = [];

    // ── OAS 2.0 / 3.0 ──────────────────────────────────────────────────────
    if (oasFile) {
      specType = 'oas';
      let spec = null;
      try {
        spec = JSON.parse(specContent);
      } catch {
        // Try YAML-ish parsing (very basic — look for key: value lines)
        // For simplicity, only handle JSON OAS here
        console.warn('[ping-spec] Could not parse OAS as JSON, trying basic extraction');
      }

      if (spec && (spec.paths || spec.swagger || spec.openapi)) {
        const basePath = spec.basePath || '';

        // Helper: extract param descriptors from OAS parameter objects
        const extractParams = (params = [], inFilter) =>
          params
            .filter(p => p.in === inFilter)
            .map(p => ({
              name: p.name,
              required: !!p.required,
              type: p.schema?.type || p.type || 'string',
              description: p.description || '',
              example: p.example != null ? String(p.example)
                : p.schema?.example != null ? String(p.schema.example) : '',
            }));

        for (const [rawPath, pathItem] of Object.entries(spec.paths || {})) {
          const fullPath = basePath + rawPath;
          for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
            const op = pathItem[method];
            if (!op) continue;
            const allParams = [...(pathItem.parameters || []), ...(op.parameters || [])];
            const endpoint = {
              path: fullPath,
              method: method.toUpperCase(),
              description: op.summary || op.description || '',
              queryParams: extractParams(allParams, 'query'),
              headers: extractParams(allParams, 'header'),
            };
            allEndpoints.push(endpoint);
          }
        }
      }
    }

    // ── RAML (basic text parsing) ────────────────────────────────────────────
    if (ramlFile && !oasFile) {
      specType = 'raml';
      // Basic RAML resource + queryParameters extraction via regex
      // Format:  /path:\n  get:\n    queryParameters:\n      key:\n        type: ...
      const lines = specContent.split('\n');
      let currentPath = '';
      let currentMethod = '';
      let inQueryParams = false;
      let inHeaders = false;
      let currentParamName = '';
      let currentEndpoint = null;

      const pathRe   = /^(\/[\w\-\/{}]*):\s*$/;
      const methodRe = /^  (get|post|put|delete|patch|head|options):\s*$/;
      const qpRe     = /^    queryParameters:\s*$/;
      const hdrRe    = /^    headers:\s*$/;
      const paramRe  = /^      ([\w\-]+):\s*$/;
      const propRe   = /^        (type|description|example|required):\s*(.+)$/;

      for (const line of lines) {
        const pathMatch = line.match(pathRe);
        if (pathMatch) {
          currentPath = pathMatch[1];
          currentMethod = '';
          inQueryParams = false;
          inHeaders = false;
          continue;
        }
        const methodMatch = line.match(methodRe);
        if (methodMatch && currentPath) {
          currentMethod = methodMatch[1].toUpperCase();
          inQueryParams = false;
          inHeaders = false;
          currentEndpoint = { path: currentPath, method: currentMethod, description: '', queryParams: [], headers: [] };
          allEndpoints.push(currentEndpoint);
          continue;
        }
        if (currentEndpoint) {
          if (qpRe.test(line))  { inQueryParams = true; inHeaders = false; continue; }
          if (hdrRe.test(line)) { inHeaders = true; inQueryParams = false; continue; }
          const paramMatch = line.match(paramRe);
          if (paramMatch && (inQueryParams || inHeaders)) {
            currentParamName = paramMatch[1];
            const param = { name: currentParamName, required: false, type: 'string', description: '', example: '' };
            if (inQueryParams) currentEndpoint.queryParams.push(param);
            else currentEndpoint.headers.push(param);
            continue;
          }
          const propMatch = line.match(propRe);
          if (propMatch && currentParamName && (inQueryParams || inHeaders)) {
            const arr = inQueryParams ? currentEndpoint.queryParams : currentEndpoint.headers;
            const param = arr.find(p => p.name === currentParamName);
            if (param) {
              const val = propMatch[2].trim().replace(/^["']|["']$/g, '');
              if (propMatch[1] === 'type') param.type = val;
              else if (propMatch[1] === 'description') param.description = val;
              else if (propMatch[1] === 'example') param.example = val;
              else if (propMatch[1] === 'required') param.required = val === 'true';
            }
          }
        }
      }
    }

    // 5. Filter ping endpoints
    const pingEndpoints = allEndpoints.filter(e => isPingPath(e.path));

    console.log(`[ping-spec] ${groupId}/${assetId}/${version}: ${allEndpoints.length} endpoints, ${pingEndpoints.length} ping path(s)`);

    return res.json({
      specType,
      assetName: asset.name || assetId,
      pingEndpoints,
      allEndpoints,
    });

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
