const dependencyGraphService = require('../services/dependencyGraphService');
const { getCredentials, detectEnvType, detectChType, normaliseUrl } = require('../routes/cps');
const { createClient } = require('../utils/anypointClient');

/**
 * Try to resolve a CPS credential pair from the uploaded credentials map
 * by reading ARM deployment properties of apps in the environment.
 *
 * Apps commonly store their CPS / Connected App client_id as an ARM property:
 *   - anypoint.platform.client_id  (most common)
 *   - cps.client.id
 *   - cps.clientId
 *
 * We sample the first few CH2 deployments and match their ARM property values
 * against the keys of credentialsMap.  The first match wins.
 *
 * Fallback: if no match is found we return the first entry in the map so
 * the topology call still proceeds (the user may have only one credential).
 *
 * @param {string} orgId
 * @param {string} envId
 * @param {string} anypointToken
 * @param {Object.<string,string>} credentialsMap  clientId → clientSecret
 * @returns {{ clientId: string, clientSecret: string } | null}
 */
async function resolveCredsFromCredentialsMap(orgId, envId, anypointToken, credentialsMap) {
  const entries = Object.entries(credentialsMap);
  if (entries.length === 0) return null;

  // If only one credential is uploaded, no need to probe ARM
  if (entries.length === 1) {
    return { clientId: entries[0][0], clientSecret: entries[0][1] };
  }

  try {
    const client = createClient(anypointToken);

    // Sample up to 5 CH2 deployments to find a matching client_id in ARM properties
    const listRes = await client.get(
      `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`,
      { params: { limit: 5, offset: 0 } }
    );
    const apps = listRes.data?.items || [];

    for (const app of apps) {
      try {
        const detailRes = await client.get(
          `/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments/${app.id}`
        );
        const detail = detailRes.data;

        // Extract ARM properties.
        //
        // CH2 Application Manager API v2 stores application.configuration as a
        // flat object whose keys are service-name strings with literal dots, e.g.:
        //   { "mule.agent.application.properties.service": { properties: {...}, secureProperties: {...} } }
        //
        // Accessing .configuration?.mule?.agent?.... fails because JavaScript
        // looks for a property literally named "mule", which does not exist.
        // We must iterate over the flat key/value pairs instead.
        const armProps = {};
        try {
          const config = detail?.application?.configuration || {};
          for (const [, serviceVal] of Object.entries(config)) {
            if (serviceVal && typeof serviceVal === 'object') {
              if (serviceVal.properties && typeof serviceVal.properties === 'object') {
                Object.assign(armProps, serviceVal.properties);
              }
              if (serviceVal.secureProperties && typeof serviceVal.secureProperties === 'object') {
                Object.assign(armProps, serviceVal.secureProperties);
              }
            }
          }
        } catch { /* ignore */ }
        // RTF deployments may also surface properties here
        try {
          Object.assign(
            armProps,
            detail?.target?.deploymentSettings?.runtimeFabric?.applicationProperties || {}
          );
        } catch { /* ignore */ }

        if (Object.keys(armProps).length === 0) {
          // Diagnostic: show what configuration keys the API actually returned
          const configKeys = Object.keys(detail?.application?.configuration || {});
          console.log(
            `[TopologyController] armProps empty for app "${app.name || app.id}" — ` +
            `configuration keys: [${configKeys.join(', ')}]`
          );
        } else {
          console.log(`[TopologyController] armProps for "${app.name || app.id}":`, armProps);
        }

        // Match any of the standard CPS client_id property names
        const clientId =
          armProps['anypoint.platform.client_id'] ||
          armProps['cps.client.id'] ||
          armProps['cps.clientId'] ||
          null;

        if (clientId && credentialsMap[clientId]) {
          console.log(
            `[TopologyController] Resolved CPS client_id "${clientId}" ` +
            `from ARM properties of app "${app.name || app.id}"`
          );
          return { clientId, clientSecret: credentialsMap[clientId] };
        }
      } catch (appErr) {
        console.warn(
          `[TopologyController] Could not read ARM detail for deployment ${app.id}:`,
          appErr.message
        );
      }
    }
  } catch (err) {
    console.warn('[TopologyController] ARM property resolution failed:', err.message);
  }

  // Fallback: use the first credential in the map
  console.log('[TopologyController] No ARM match found — using first uploaded credential as fallback');
  return { clientId: entries[0][0], clientSecret: entries[0][1] };
}

exports.getTopology = async (req, res) => {
  try {
    const {
      orgId,
      envId,
      cpsBaseUrl,
      cpsEnvironment,
      bgOrgId,
      direction = 'full',
      appKey,
    } = req.query;

    if (!orgId || !envId || !cpsBaseUrl || !cpsEnvironment) {
      return res.status(400).json({
        error: 'orgId, envId, cpsBaseUrl, and cpsEnvironment are required',
      });
    }

    // ── Parse the credentials map sent from "Import CPS Creds" header button ──
    const rawCredMap = req.headers['x-cps-credentials-map'];
    let credentialsMap = null;
    if (rawCredMap) {
      try {
        credentialsMap = JSON.parse(rawCredMap);
      } catch {
        console.warn('[TopologyController] Could not parse x-cps-credentials-map header');
      }
    }

    // ── Credential resolution — priority order ────────────────────────────────
    // 1. Session / env-var credentials (set via CPS Manager page auth flow)
    // 2. Legacy single-pair direct headers (x-cps-client-id / x-cps-client-secret)
    // 3. Credentials map from "Import CPS Creds" button — resolved via ARM props
    const envType = detectEnvType(cpsBaseUrl, cpsEnvironment, cpsEnvironment);
    const chType = 'CH2';
    let creds = getCredentials(req, cpsBaseUrl, bgOrgId, envType, chType);

    if (!creds && req.headers['x-cps-client-id'] && req.headers['x-cps-client-secret']) {
      creds = {
        clientId: req.headers['x-cps-client-id'],
        clientSecret: req.headers['x-cps-client-secret'],
      };
    }

    if (!creds && credentialsMap && Object.keys(credentialsMap).length > 0) {
      creds = await resolveCredsFromCredentialsMap(
        orgId,
        envId,
        req.anypointToken,
        credentialsMap
      );
    }

    if (!creds) {
      return res.status(422).json({
        error: 'CPS credentials not configured for this server / BG combination',
      });
    }

    // ── Build the topology graph ───────────────────────────────────────────────
    const fullGraph = await dependencyGraphService.buildFullTopology(
      orgId,
      envId,
      cpsBaseUrl,
      cpsEnvironment,
      req.anypointToken,
      creds
    );

    // Apply directional filtering
    let resultGraph = fullGraph;
    if (direction === 'backward' && appKey) {
      resultGraph = dependencyGraphService.getBackwardTree(fullGraph, appKey);
    } else if (direction === 'forward' && appKey) {
      resultGraph = dependencyGraphService.getForwardTree(fullGraph, appKey);
    }

    res.json(resultGraph);
  } catch (err) {
    console.error('Topology Generation Error:', err);
    res.status(500).json({ error: err.message || 'Internal server error generating topology' });
  }
};