const dependencyGraphService = require('../services/dependencyGraphService');
const { getCredentials, detectEnvType, detectChType, normaliseUrl } = require('../routes/cps');

exports.getTopology = async (req, res) => {
  try {
    const { orgId, envId, cpsBaseUrl, cpsEnvironment, bgOrgId, direction = 'full', appKey } = req.query;

    if (!orgId || !envId || !cpsBaseUrl || !cpsEnvironment) {
      return res.status(400).json({ error: 'orgId, envId, cpsBaseUrl, and cpsEnvironment are required' });
    }

    // Resolve credentials
    // Note: detectEnvType and detectChType require some arguments. We'll default to CH2/Sandbox if not provided.
    const envType = detectEnvType(cpsBaseUrl, cpsEnvironment, cpsEnvironment);
    // deploymentType is not easily available here, we'll try 'CH2' as it's the default for most new deployments
    const chType = 'CH2'; 
    const creds = getCredentials(req, cpsBaseUrl, bgOrgId, envType, chType);

    if (!creds) {
      return res.status(422).json({ error: 'CPS credentials not configured for this server / BG combination' });
    }

    // Build the full graph
    const fullGraph = await dependencyGraphService.buildFullTopology(
      orgId, 
      envId, 
      cpsBaseUrl, 
      cpsEnvironment, 
      req.anypointToken, 
      creds
    );

    // Apply filtering based on direction and appKey
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
