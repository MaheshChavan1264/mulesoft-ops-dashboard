const express = require('express');
const router = express.Router();
const axios = require('axios');
const authMiddleware = require('../middleware/authMiddleware');
const { createClient } = require('../utils/anypointClient');
const { stripDeploymentSuffix } = require('../utils/appHelpers');
const { extractAnypointErrorMessage } = require('../utils/responseHelpers');
const { proxyHandler } = require('../utils/asyncHandler');
const { mapWithConcurrency } = require('../utils/concurrencyPool');
const {
  isPingPath,
  parsePortalModel,
  parseOasSpecFile,
  parseRamlText,
  extractSpecFileFromZip,
} = require('../utils/specParser');
const { getCachedSpec, setCachedSpec } = require('../utils/specCache');
const logger = require('../utils/logger');

/**
 * Download and parse an asset's attached spec file (fat-oas/fat-raml),
 * independent of whether the Portal Model API already succeeded. Shared by
 * two call sites in `/ping-spec`:
 *   - Step 2 fallback, when the Portal Model API has nothing at all.
 *   - The AMF enrichment pass, when the Portal Model API DID return an
 *     endpoint list (via the AMF JSON-LD branch) but that branch only ever
 *     extracted query/header params — no request/response schemas or
 *     `components.schemas` — because confidently mapping AMF's JSON-LD
 *     vocabulary for payloads/security would require guessing at URIs this
 *     codebase has no way to validate against a live sample. Re-parsing the
 *     asset's own OAS/RAML file is a deterministic, well-understood format
 *     and gives the richer detail Exchange's own Reference tab shows.
 *
 * @returns {Promise<{specType: string, assetName: string, allEndpoints: Array, schemas: object, securitySchemes: object, info: object, servers: Array} | null>}
 *   null if no spec file is attached or it couldn't be downloaded/parsed.
 */
async function downloadAndParseSpecFile(client, anypointToken, groupId, assetId, version, assetIdFallback) {
  const assetRes = await client.get(`/exchange/api/v2/assets/${groupId}/${assetId}/${version}`);
  const asset = assetRes.data;
  const assetName = asset.name || assetIdFallback;
  const files = asset.files || [];

  const findFile = (...classifiers) => {
    for (const c of classifiers) {
      const f = files.find(fi => fi.classifier === c);
      if (f) return f;
    }
    return null;
  };
  const oasFile = findFile('fat-oas', 'oas');
  const ramlFile = findFile('fat-raml', 'raml');
  const specFile = oasFile || ramlFile;
  if (!specFile?.externalLink) return null;

  const isS3 = specFile.externalLink.includes('s3.amazonaws.com');
  const dlRes = await axios.get(specFile.externalLink, {
    headers: isS3 ? {} : { Authorization: `Bearer ${anypointToken}` },
    responseType: 'arraybuffer',
    timeout: 20000,
  });
  const buf = Buffer.from(dlRes.data);
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const content = isZip ? extractSpecFileFromZip(buf) : buf.toString('utf8');
  if (isZip) logger.debug(`[ping-spec] ZIP extracted: ${content ? `${content.length} chars` : 'FAILED'}`);
  if (!content) throw new Error('Could not extract spec content from file');

  if (oasFile) {
    let spec = null;
    try { spec = JSON.parse(content); } catch {
      try {
        spec = require('js-yaml').load(content);
        logger.debug('[ping-spec] OAS spec parsed as YAML');
      } catch (yamlErr) {
        logger.warn(`[ping-spec] YAML parse failed: ${yamlErr.message}`);
      }
    }
    if (!spec?.paths) {
      if (spec) logger.warn(`[ping-spec] OAS spec parsed but has no "paths". Top-level keys: ${Object.keys(spec).slice(0, 10).join(', ')}`);
      return null;
    }
    logger.debug(`[ping-spec] OAS ${spec.openapi || spec.swagger || '?'}: ${Object.keys(spec.paths).length} path(s)`);
    const parsed = parseOasSpecFile(spec);
    return { specType: 'oas', assetName, allEndpoints: parsed.endpoints, schemas: parsed.schemas, securitySchemes: parsed.securitySchemes, info: parsed.info, servers: parsed.servers };
  }
  if (ramlFile) {
    const parsed = parseRamlText(content);
    return { specType: 'raml', assetName, allEndpoints: parsed.endpoints, schemas: parsed.schemas || {}, securitySchemes: {}, info: {}, servers: [] };
  }
  return null;
}

/**
 * Merge the AMF-sourced endpoint list's `queryParams`/`headers` (already
 * battle-tested for ping-path detection) with the richer per-operation
 * fields a spec-file re-parse produced (requestBody/responses/tags/
 * deprecated/operationId/security/pathParams), matched by path+method.
 * Endpoints only the file-parse found (e.g. AMF dropped one) are appended
 * as-is; endpoints only AMF found are kept unchanged.
 */
function mergeEndpointDetail(amfEndpoints, fileEndpoints) {
  const fileByKey = new Map(fileEndpoints.map((e) => [`${e.method} ${e.path}`, e]));
  const merged = amfEndpoints.map((e) => {
    const rich = fileByKey.get(`${e.method} ${e.path}`);
    if (!rich) return e;
    fileByKey.delete(`${e.method} ${e.path}`);
    return { ...rich, queryParams: e.queryParams, headers: e.headers };
  });
  return [...merged, ...fileByKey.values()];
}


// Search Exchange assets
router.get('/search', authMiddleware, proxyHandler('Failed to search Exchange', async (req, res) => {
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
}));

// Organization assets summary
router.get('/org/:orgId/summary', authMiddleware, proxyHandler('Failed to fetch Exchange summary', async (req, res) => {
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
}));

// Get asset versions list — MUST be before /:groupId/:assetId/:version to avoid collision
router.get('/:groupId/:assetId/versions', authMiddleware, proxyHandler('Failed to fetch asset versions', async (req, res) => {
  const client = createClient(req.anypointToken);
  const response = await client.get(
    `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}`
  );
  res.json(response.data);
}));

// Get a specific Exchange asset by version — keep AFTER /versions route
router.get('/:groupId/:assetId/:version', authMiddleware, proxyHandler('Failed to fetch Exchange asset', async (req, res) => {
  const client = createClient(req.anypointToken);
  const response = await client.get(
    `/exchange/api/v2/assets/${req.params.groupId}/${req.params.assetId}/${req.params.version}`
  );
  res.json(response.data);
}));

// ─── GET /api/exchange/ping-spec ─────────────────────────────────────────────
/**
 * Fetch and parse an API spec from Exchange to discover ping/health endpoints
 * along with their query parameters and required headers.
 *
 * Returns:
 *   {
 *     specType: 'oas' | 'raml' | 'unknown',
 *     pingEndpoints: [{ path, method, description, queryParams, headers }],
 *     allEndpoints: [...]
 *   }
 *
 * Results are cached in SQLite (see utils/specCache.js) keyed by however the
 * caller identified the asset — pass `refresh=true` to force a live
 * Exchange re-fetch and overwrite the cached row (wired to the frontend's
 * manual "Refresh" button).
 */
router.get('/ping-spec', authMiddleware, async (req, res) => {
  let { groupId, assetId, version, orgId, appName } = req.query;

  const forceRefresh = req.query.refresh === 'true' || req.query.refresh === '1';
  const requestedByCoords = !!(req.query.groupId && req.query.assetId && req.query.version);
  const cacheKey = requestedByCoords
    ? `coords:${req.query.groupId}:${req.query.assetId}:${req.query.version}`
    : (orgId && appName ? `app:${orgId}:${appName}` : null);

  if (cacheKey && !forceRefresh) {
    const cached = await getCachedSpec(cacheKey);
    if (cached) {
      logger.info(`[ping-spec] Cache hit for ${cacheKey} (age=${Math.round(cached.ageMs / 1000)}s)`);
      return res.json(cached.data);
    }
  }

  // If groupId/assetId/version not provided but appName is, search Exchange.
  // Use stripDeploymentSuffix (shared with health.js) to normalise the name.
  if ((!groupId || !assetId || !version) && appName && orgId) {
    try {
      const client = createClient(req.anypointToken);

      const normalizedName = stripDeploymentSuffix(appName);

      const parts = normalizedName.split('-').filter(Boolean);
      const prefix3 = parts.length >= 3 ? parts.slice(0, 3).join('-') : null;
      const prefix4 = parts.length >= 4 ? parts.slice(0, 4).join('-') : null;

      const searchTerms = [
        appName,
        normalizedName,
        prefix4,
        prefix3,
        `${normalizedName}-api`,
      ].filter((t, i, a) => t && a.indexOf(t) === i);
      logger.info(`[ping-spec] Searching Exchange by: "${searchTerms.slice(0, 3).join('", "')}" (+variants) in org ${orgId}`);

      const searchStrategies = [
        { orgParam: orgId },
        { orgParam: undefined },
      ];

      const scoreAsset = (a) => {
        const aid = (a.assetId || '').toLowerCase();
        const nm = normalizedName;
        const pts = nm.split('-').filter(Boolean);
        let score = 0;
        if (aid === nm) score += 10;
        else if (aid.startsWith(nm)) score += 8;
        else if (pts.length >= 3 && aid.includes(pts.slice(0, 3).join('-'))) score += 6;
        else if (pts.length >= 2 && aid.includes(pts.slice(0, 2).join('-'))) score += 4;
        else if (pts.length >= 1 && aid.startsWith(pts[0])) score += 2;
        return score;
      };

      const allFoundAssets = new Map();

      // Try each orgParam strategy in turn; within a strategy, fire every
      // search term in PARALLEL (there was never any early-exit per-term —
      // all terms were always awaited sequentially before deciding whether
      // to try the next strategy, so parallelizing them changes nothing
      // except wall-clock time).
      for (const { orgParam } of searchStrategies) {
        const settled = await Promise.allSettled(searchTerms.map(async (term) => {
          const params = { search: term, limit: 10, type: 'rest-api' };
          if (orgParam) params.organizationId = orgParam;
          const searchRes = await client.get('/exchange/api/v2/assets', { params });
          return Array.isArray(searchRes.data) ? searchRes.data : (searchRes.data?.assets || []);
        }));
        for (const outcome of settled) {
          if (outcome.status !== 'fulfilled') continue; // failed search term — skip
          for (const a of outcome.value) {
            const key = `${a.groupId}/${a.assetId}/${a.version}`;
            if (!allFoundAssets.has(key)) allFoundAssets.set(key, a);
          }
        }
        if (allFoundAssets.size > 0) break;
      }

      // Direct assetId variant probing
      const assetIdVariants = [
        `${normalizedName}-ch2-api`,
        `${normalizedName}-ch1-api`,
        `${normalizedName}-api`,
        `${normalizedName}-ch2`,
        `${normalizedName}-sapi-api`,
        `${normalizedName}-xapi-api`,
        `${normalizedName}-papi-api`,
      ];

      // Probe variants in parallel (bounded concurrency) — each variant still
      // tries its own candidate org IDs sequentially with early-exit on the
      // first hit, but variants no longer wait on each other.
      await mapWithConcurrency(assetIdVariants, 5, async (variantId) => {
        const orgIds = [...new Set(
          [...allFoundAssets.values()].map(a => a.groupId).concat([orgId])
        )];
        for (const gId of orgIds) {
          try {
            const probe = await client.get(`/exchange/api/v2/assets/${gId}/${variantId}`);
            const probeData = probe.data;
            const versions = probeData?.versions || (Array.isArray(probeData) ? probeData : [probeData]);
            const latestVersion = versions[0]?.version || probeData?.version;
            if (latestVersion) {
              const key = `${gId}/${variantId}/${latestVersion}`;
              if (!allFoundAssets.has(key)) {
                allFoundAssets.set(key, {
                  groupId: gId, assetId: variantId, version: latestVersion,
                  name: probeData.name || variantId,
                });
                logger.info(`[ping-spec] Direct probe found: ${gId}/${variantId}/${latestVersion}`);
              }
              break;
            }
          } catch { /* 404 = doesn't exist */ }
        }
      });


      if (allFoundAssets.size > 0) {
        const scored = Array.from(allFoundAssets.values())
          .map(a => ({ a, score: scoreAsset(a) }))
          .sort((x, y) => y.score - x.score);
        const best = scored[0].a;
        groupId = best.groupId;
        assetId = best.assetId;
        version = best.version;
        req._extraCandidates = scored.slice(1).map(s => ({
          groupId: s.a.groupId, assetId: s.a.assetId, version: s.a.version
        }));
        logger.info(`[ping-spec] Best candidate: ${groupId}/${assetId}/${version} (score=${scored[0].score})`);
        if (scored.length > 1) {
          logger.info(`[ping-spec] ${scored.length - 1} runner-up(s): ${scored.slice(1, 5).map(s => `${s.a.assetId}/${s.a.version}(${s.score})`).join(', ')}`);
        }
      } else {
        logger.info('[ping-spec] Name search exhausted all strategies — no asset found');
      }
    } catch (searchErr) {
      logger.warn(`[ping-spec] Name search failed: ${searchErr.message}`);
    }
  }

  let assetCandidates = [];
  if (groupId && assetId && version) {
    assetCandidates = [{ groupId, assetId, version }];
  } else {
    return res.status(404).json({
      error: 'Could not resolve Exchange asset for this app. Ensure the app has an Exchange asset linked.',
      specType: 'unknown', pingEndpoints: [], allEndpoints: []
    });
  }

  if (req._extraCandidates?.length) {
    assetCandidates.push(...req._extraCandidates);
  }

  try {
    const client = createClient(req.anypointToken);

    let assetName = assetId;
    let specType = 'unknown';
    let allEndpoints = [];

    for (const candidate of assetCandidates) {
      groupId = candidate.groupId;
      assetId = candidate.assetId;
      version = candidate.version;
      assetName = assetId;
      specType = 'unknown';
      allEndpoints = [];
      let schemas = {}, securitySchemes = {}, info = {}, servers = [];
      let modelParsed = false;

      // ── Step 1: Try the Exchange Portal Model API ──────────────────────
      try {
        const modelRes = await client.get(
          `/exchange/api/v2/assets/${groupId}/${assetId}/${version}/portal/model`
        );
        const model = modelRes.data;

        if (Array.isArray(model)) {
          logger.debug(`[ping-spec] Portal model is Array, length=${model.length}, first item keys: ${Object.keys(model[0] || {}).slice(0, 6)}`);
        } else if (model && typeof model === 'object') {
          logger.debug(`[ping-spec] Portal model is Object, top-level keys: ${Object.keys(model).slice(0, 10)}`);
        }

        const parsed = parsePortalModel(model, assetId);
        specType = parsed.specType;
        assetName = parsed.assetName;
        allEndpoints = parsed.endpoints;
        schemas = parsed.schemas || {};
        securitySchemes = parsed.securitySchemes || {};
        info = parsed.info || {};
        servers = parsed.servers || [];
        modelParsed = allEndpoints.length > 0;
      } catch (modelErr) {
        logger.warn(`[ping-spec] Portal model API failed (${modelErr.response?.status || modelErr.message}), falling back to asset file download`);
      }

      // ── Step 2: Fallback — download and parse the spec file (when the
      // Portal Model API had nothing at all) ──────────────────────────────
      if (!modelParsed) {
        try {
          const fileResult = await downloadAndParseSpecFile(client, req.anypointToken, groupId, assetId, version, assetId);
          if (fileResult) {
            specType = fileResult.specType;
            assetName = fileResult.assetName;
            allEndpoints = fileResult.allEndpoints;
            schemas = fileResult.schemas;
            securitySchemes = fileResult.securitySchemes;
            info = fileResult.info;
            servers = fileResult.servers;
          }
        } catch (fbErr) {
          logger.warn(`[ping-spec] Fallback file download also failed: ${fbErr.message}`);
        }
      } else if (specType === 'amf-jsonld') {
        // ── Step 1b: AMF enrichment pass — the Portal Model's AMF JSON-LD
        // branch only extracts query/header params, no schemas/request/
        // response bodies (see downloadAndParseSpecFile's header comment).
        // Re-parse the asset's own spec file (if attached) to fill those in,
        // without discarding the already-working AMF param extraction.
        try {
          const fileResult = await downloadAndParseSpecFile(client, req.anypointToken, groupId, assetId, version, assetId);
          if (fileResult?.allEndpoints?.length) {
            allEndpoints = mergeEndpointDetail(allEndpoints, fileResult.allEndpoints);
            schemas = fileResult.schemas;
            securitySchemes = fileResult.securitySchemes;
            info = fileResult.info;
            servers = fileResult.servers;
            logger.debug(`[ping-spec] AMF enrichment: merged schema/body detail from ${fileResult.specType} file for ${groupId}/${assetId}/${version}`);
          }
        } catch (enrichErr) {
          logger.debug(`[ping-spec] AMF enrichment skipped (no spec file or parse failed): ${enrichErr.message}`);
        }
      }

      // Done with this candidate — check if we got any endpoints
      const pingEndpoints = allEndpoints.filter(e => isPingPath(e.path));
      logger.info(`[ping-spec] ${groupId}/${assetId}/${version} (${specType}): ${allEndpoints.length} endpoints, ${pingEndpoints.length} ping path(s)`);
      if (allEndpoints.length > 0) {
        const responseBody = { specType, assetName, info, servers, schemas, securitySchemes, pingEndpoints, allEndpoints };
        if (cacheKey) setCachedSpec(cacheKey, responseBody, { orgId, appName, groupId, assetId, version });
        return res.json(responseBody);
      }
      if (assetCandidates.length > 1) {
        logger.info(`[ping-spec] 0 endpoints for ${assetId}/${version}, trying next candidate…`);
      }
    } // end candidate loop

    // All candidates exhausted with 0 endpoints
    logger.info('[ping-spec] All candidates exhausted — returning empty spec');
    const emptyBody = { specType: 'unknown', assetName, info: {}, servers: [], schemas: {}, securitySchemes: {}, pingEndpoints: [], allEndpoints: [] };
    if (cacheKey) setCachedSpec(cacheKey, emptyBody, { orgId, appName, groupId, assetId, version });
    return res.json(emptyBody);

  } catch (error) {
    logger.error({ err: error.response?.data || error.message }, '[ping-spec] Error');
    res.status(error.response?.status || 500).json({
      error: extractAnypointErrorMessage(error, 'Failed to fetch ping spec'),
      specType: 'unknown',
      info: {}, servers: [], schemas: {}, securitySchemes: {},
      pingEndpoints: [],
      allEndpoints: [],
    });
  }
});

module.exports = router;
