const axios = require('axios');
const { createClient } = require('../utils/anypointClient');
const { detectEnvType, detectChType } = require('../routes/cps');

// We need a helper to fetch apps from Anypoint (CH1 and CH2)
async function fetchAllAppsForEnv(anypointToken, orgId, envId) {
  const client = createClient(anypointToken);
  let allApps = [];

  // Try to fetch CH2 deployments
  try {
    let offset = 0;
    const limit = 50;
    let hasMore = true;
    while (hasMore) {
      const res = await client.get(`/amc/application-manager/api/v2/organizations/${orgId}/environments/${envId}/deployments`, { params: { limit, offset } });
      const items = res.data?.items || [];
      allApps.push(...items.map(app => ({
        id: app.id,
        name: app.name,
        targetId: app.target?.targetId,
        type: 'CH2'
      })));
      if (items.length < limit) hasMore = false;
      else offset += limit;
    }
  } catch (e) {
    console.error('Failed to fetch CH2 apps for topology:', e.message);
  }

  // Try to fetch CH1 apps
  try {
    const res = await client.get(`/cloudhub/api/v2/applications`, {
      headers: {
        'X-ANYPNT-ORG-ID': orgId,
        'X-ANYPNT-ENV-ID': envId
      }
    });
    const items = res.data || [];
    allApps.push(...items.map(app => ({
      id: app.fullDomain,
      name: app.domain,
      type: 'CH1'
    })));
  } catch (e) {
    console.error('Failed to fetch CH1 apps for topology:', e.message);
  }

  return allApps;
}

// Batch requests to CPS
async function fetchCpsPropertiesBatch(baseUrl, environment, keys, creds, type = 'non-secure') {
  const cleanBaseUrl = baseUrl.replace(/\/$/, '');
  const pathMap = {
    'non-secure': '/api/v2/properties/non-secure/all',
    'secure': '/api/v2/properties/secure/all'
  };
  const fullUrl = `${cleanBaseUrl}${pathMap[type]}`;

  try {
    const res = await axios.get(fullUrl, {
      headers: {
        'client_id': creds.clientId,
        'client_secret': creds.clientSecret,
        'Content-Type': 'application/json'
      },
      params: { environment, key: keys },
      timeout: 30000
    });
    return res.data;
  } catch (err) {
    console.error(`Failed to fetch CPS ${type} properties for batch:`, err.message);
    return {};
  }
}

class DependencyGraphService {
  
  classifyNode(appName) {
    const name = appName.toLowerCase();
    if (name.includes('xapi') || name.includes('exp-')) return 'XAPI';
    if (name.includes('papi') || name.includes('prc-')) return 'PAPI';
    if (name.includes('sapi') || name.includes('sys-')) return 'SAPI';
    return 'EXTERNAL';
  }

  extractDependencies(appName, properties, allAppNamesSet) {
    const deps = [];
    if (!properties) return deps;

    // Scan all properties
    for (const [key, value] of Object.entries(properties)) {
      if (typeof value !== 'string') continue;
      if (key.endsWith('.host') || key.endsWith('.url') || key.endsWith('.endpoint') || key.endsWith('.domain')) {
        // Try to match value back to a known app in our environment
        let targetApp = null;
        const normalizedVal = value.replace(/^https?:\/\//, '').split('/')[0].split(':')[0]; // remove protocol, path, port
        
        // Find best match in our registry
        for (const knownApp of allAppNamesSet) {
          if (normalizedVal.includes(knownApp)) {
            targetApp = knownApp;
            break;
          }
        }
        
        // If not found in known apps, we treat it as an external dependency
        if (!targetApp) {
          targetApp = normalizedVal; // use the host itself as the external node
        }

        deps.push({
          target: targetApp,
          propertyKey: key,
          propertyValue: value
        });
      }
    }
    return deps;
  }

  async buildFullTopology(orgId, envId, cpsBaseUrl, cpsEnvironment, anypointToken, creds) {
    // 1. Fetch all applications
    const apps = await fetchAllAppsForEnv(anypointToken, orgId, envId);
    const appNames = apps.map(a => a.name);
    const allAppNamesSet = new Set(appNames);
    
    // 2. Fetch properties in batches of 20
    const nonSecureProps = {};
    const BATCH_SIZE = 20;
    
    for (let i = 0; i < appNames.length; i += BATCH_SIZE) {
      const batch = appNames.slice(i, i + BATCH_SIZE);
      const batchResults = await fetchCpsPropertiesBatch(cpsBaseUrl, cpsEnvironment, batch, creds, 'non-secure');
      // cps /all endpoint usually returns { [key]: { properties: {...} } }
      Object.assign(nonSecureProps, batchResults);
    }
    
    // 3. Build nodes and edges
    const nodesMap = new Map();
    const edges = [];
    
    // Add all known apps as nodes first
    for (const app of apps) {
      nodesMap.set(app.name, {
        id: app.name,
        label: app.name,
        type: this.classifyNode(app.name),
        isKnownApp: true
      });
    }

    // Process dependencies
    for (const app of apps) {
      const appProps = nonSecureProps[app.name]?.properties || {};
      const deps = this.extractDependencies(app.name, appProps, allAppNamesSet);
      
      for (const dep of deps) {
        // If target is not a known app, add it as an EXTERNAL node
        if (!nodesMap.has(dep.target)) {
          nodesMap.set(dep.target, {
            id: dep.target,
            label: dep.target,
            type: 'EXTERNAL',
            isKnownApp: false
          });
        }
        
        edges.push({
          id: `${app.name}->${dep.target}`,
          source: app.name,
          target: dep.target,
          propertyKey: dep.propertyKey,
          propertyValue: dep.propertyValue
        });
      }
    }
    
    return {
      nodes: Array.from(nodesMap.values()),
      edges
    };
  }

  getBackwardTree(graph, targetAppKey) {
    const backwardEdges = [];
    const backwardNodes = new Set();
    
    // Reverse BFS/DFS to find all apps that depend on targetAppKey
    const queue = [targetAppKey];
    backwardNodes.add(targetAppKey);
    
    while (queue.length > 0) {
      const current = queue.shift();
      // Find all edges where 'current' is the target
      for (const edge of graph.edges) {
        if (edge.target === current) {
          backwardEdges.push(edge);
          if (!backwardNodes.has(edge.source)) {
            backwardNodes.add(edge.source);
            queue.push(edge.source);
          }
        }
      }
    }
    
    const nodes = graph.nodes.filter(n => backwardNodes.has(n.id));
    // Also include edges that exist between the backwardNodes for completeness
    const edges = graph.edges.filter(e => backwardNodes.has(e.source) && backwardNodes.has(e.target));
    
    return { nodes, edges };
  }
  
  getForwardTree(graph, sourceAppKey) {
    const forwardEdges = [];
    const forwardNodes = new Set();
    
    // BFS to find all apps that sourceAppKey depends on
    const queue = [sourceAppKey];
    forwardNodes.add(sourceAppKey);
    
    while (queue.length > 0) {
      const current = queue.shift();
      // Find all edges where 'current' is the source
      for (const edge of graph.edges) {
        if (edge.source === current) {
          forwardEdges.push(edge);
          if (!forwardNodes.has(edge.target)) {
            forwardNodes.add(edge.target);
            queue.push(edge.target);
          }
        }
      }
    }
    
    const nodes = graph.nodes.filter(n => forwardNodes.has(n.id));
    const edges = graph.edges.filter(e => forwardNodes.has(e.source) && forwardNodes.has(e.target));
    
    return { nodes, edges };
  }
}

module.exports = new DependencyGraphService();
