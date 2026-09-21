import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { useCpsCredentialStore } from '../context/CpsCredentialStoreContext';
import { Activity, RefreshCw, AlertTriangle, Play, ChevronLeft, ChevronRight, Layers, Filter } from 'lucide-react';
import Select from '../components/Select';
import api, { isDemoMode } from '../services/api';
import DependencyGraph from '../components/DependencyGraph';
import { getVisibleBgIds, getVisibleEnvIds, applyBgFilter, applyEnvFilter } from '../utils/filterUtils';

export default function TopologyPage() {
  const { user } = useAuth();
  
  const [allBgs, setAllBgs] = useState([]);
  const [bgEnvs, setBgEnvs] = useState([]); // Environments specific to the selected BG

  // Local selection state for the specific graph to render
  const [localBgId, setLocalBgId] = useState('');
  const [localEnvId, setLocalEnvId] = useState('');

  const [globalTick, setGlobalTick] = useState(0);

  useEffect(() => {
    const handleFilterChange = () => setGlobalTick(t => t + 1);
    window.addEventListener('bgFilterChanged', handleFilterChange);
    window.addEventListener('envFilterChanged', handleFilterChange);
    return () => {
      window.removeEventListener('bgFilterChanged', handleFilterChange);
      window.removeEventListener('envFilterChanged', handleFilterChange);
    };
  }, []);

  // Fetch all BGs once
  useEffect(() => {
    const fetchBgs = async () => {
      try {
        const bgRes = await api.get('/organizations/business-groups');
        setAllBgs(bgRes.data?.data || []);
      } catch (err) {
        console.error('Failed to fetch BGs:', err);
      }
    };
    fetchBgs();
  }, []);

  // Fetch environments whenever localBgId changes
  useEffect(() => {
    if (!localBgId) return;
    const fetchEnvs = async () => {
      try {
        const envRes = await api.get(`/environments/${localBgId}`);
        setBgEnvs(envRes.data?.data || []);
      } catch (err) {
        console.error('Failed to fetch environments for BG:', err);
      }
    };
    fetchEnvs();
  }, [localBgId]);

  // Filter available options by global selection
  const visibleBgs = useMemo(() => applyBgFilter(allBgs), [allBgs, globalTick]);
  const visibleEnvs = useMemo(() => applyEnvFilter(bgEnvs), [bgEnvs, globalTick]);

  // Set default selections when visible options change
  useEffect(() => {
    if (visibleBgs.length > 0 && (!localBgId || !visibleBgs.find(b => b.id === localBgId))) {
      setLocalBgId(visibleBgs[0].id);
    }
    if (visibleEnvs.length > 0 && (!localEnvId || !visibleEnvs.find(e => e.id === localEnvId))) {
      setLocalEnvId(visibleEnvs[0].id);
    }
  }, [visibleBgs, visibleEnvs, localBgId, localEnvId]);
  
  // Graph controls
  const [direction, setDirection] = useState('full'); // 'full', 'forward', 'backward'
  const [targetAppKey, setTargetAppKey] = useState('');
  
  // Data state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [graphData, setGraphData] = useState(null);
  
  // Edge popover state
  const [popover, setPopover] = useState(null);



  // Compute available apps from graph for the dropdown
  const availableApps = useMemo(() => {
    if (!graphData || !graphData.nodes) return [];
    // Only show known apps, not external ones
    return graphData.nodes.filter(n => n.isKnownApp).map(n => n.id).sort();
  }, [graphData]);

  const fetchTopology = useCallback(async () => {
    if (!localBgId || !localEnvId) {
      setError('Please select a Business Group and Environment to visualize.');
      setGraphData(null);
      return;
    }

    setLoading(true);
    setError(null);
    setPopover(null);
    
    try {
      const params = {
        orgId: localBgId,
        envId: localEnvId,
        cpsBaseUrl: 'https://anypoint.mulesoft.com', // Demo/Fallback
        cpsEnvironment: 'Sandbox',
        bgOrgId: localBgId,
        direction,
      };
      
      if (direction !== 'full') {
        if (!targetAppKey) {
          // Can't run directional without target
          setLoading(false);
          return;
        }
        params.appKey = targetAppKey;
      }

      const { data } = await api.get('/topology', { params });
      setGraphData(data);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to generate topology');
    } finally {
      setLoading(false);
    }
  }, [localBgId, localEnvId, direction, targetAppKey]);

  // Initial fetch for full graph when env changes
  useEffect(() => {
    if (localBgId && localEnvId && direction === 'full') {
      fetchTopology();
    }
  }, [localBgId, localEnvId, direction, fetchTopology]);

  // Handle edge click
  const handleEdgeClick = useCallback((edge, position) => {
    setPopover({
      edge,
      position,
    });
  }, []);

  return (
    <div className="h-full flex flex-col bg-gray-950" onClick={() => setPopover(null)}>
      {/* Header & Controls */}
      <div className="flex-shrink-0 bg-gray-900 border-b border-gray-800 p-4">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <Activity className="text-cyan-400" />
              Network Topology & Impact Analysis
            </h1>
            <p className="text-sm text-gray-400 mt-1">Visualize dependencies and blast radius using CPS properties</p>
          </div>
          
          <div className="flex items-center gap-3">
            <Select
              value={localBgId}
              onChange={setLocalBgId}
              options={visibleBgs.map(b => ({ value: b.id, label: b.name }))}
              placeholder="Business Group..."
              className="w-48"
            />
            <Select
              value={localEnvId}
              onChange={setLocalEnvId}
              options={visibleEnvs.map(e => ({ value: e.id, label: e.name }))}
              placeholder="Environment..."
              className="w-40"
            />
            <button
              onClick={fetchTopology}
              disabled={loading}
              className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 transition-colors disabled:opacity-50"
              title="Refresh Graph"
            >
              <RefreshCw size={18} className={loading ? 'animate-spin text-cyan-400' : ''} />
            </button>
          </div>
        </div>

        <div className="flex items-center gap-6 bg-gray-950/50 p-2 rounded-lg border border-gray-800">
          {/* Mode Switcher */}
          <div className="flex bg-gray-900 rounded-md p-1 border border-gray-700">
            <button
              onClick={() => setDirection('forward')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${direction === 'forward' ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <ChevronRight size={14} /> Forward Tree
            </button>
            <button
              onClick={() => { setDirection('full'); setTargetAppKey(''); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${direction === 'full' ? 'bg-cyan-900/50 text-cyan-300' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <Layers size={14} /> Full Network
            </button>
            <button
              onClick={() => setDirection('backward')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md transition-colors ${direction === 'backward' ? 'bg-red-900/30 text-red-400' : 'text-gray-400 hover:text-gray-200'}`}
            >
              <ChevronLeft size={14} /> Backward Impact
            </button>
          </div>
          
          {/* Target Selector */}
          {(direction === 'forward' || direction === 'backward') && (
            <div className="flex items-center gap-3">
              <Filter size={16} className="text-gray-500" />
              <Select
                value={targetAppKey}
                onChange={setTargetAppKey}
                options={availableApps.map(a => ({ value: a, label: a }))}
                placeholder="Select Target App..."
                className="w-64"
                disabled={loading || availableApps.length === 0}
              />
              <button
                onClick={fetchTopology}
                disabled={loading || !targetAppKey}
                className="flex items-center gap-2 px-4 py-1.5 bg-cyan-700 hover:bg-cyan-600 disabled:bg-gray-800 text-white text-sm rounded-md transition-colors"
              >
                <Play size={14} /> Generate
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Canvas Area */}
      <div className="flex-1 relative overflow-hidden bg-gray-950">
        {error ? (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-6 max-w-lg text-center flex flex-col items-center">
              <AlertTriangle className="text-red-400 mb-3" size={32} />
              <p className="text-red-200">{error}</p>
            </div>
          </div>
        ) : loading && !graphData ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center">
              <RefreshCw className="animate-spin text-cyan-500 mb-4" size={32} />
              <p className="text-cyan-400 font-medium">Scanning CPS properties across environment...</p>
              <p className="text-gray-500 text-sm mt-2">This may take a moment for large environments.</p>
            </div>
          </div>
        ) : (
          <DependencyGraph 
            graphData={graphData} 
            direction={direction}
            targetAppKey={targetAppKey}
            onEdgeClick={handleEdgeClick}
          />
        )}

        {/* Edge details popover */}
        {popover && popover.edge && (
          <div 
            className="absolute z-50 bg-gray-900 border border-gray-700 shadow-2xl rounded-lg p-4 text-sm min-w-[300px]"
            style={{ 
              top: Math.min(popover.position.y - 120, window.innerHeight - 200), // simplistic boundary check
              left: Math.min(popover.position.x + 10, window.innerWidth - 320)
            }}
            onClick={e => e.stopPropagation()}
          >
            <div className="font-semibold text-cyan-400 mb-2 border-b border-gray-800 pb-2">Dependency Details</div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2">
              <span className="text-gray-500">Source:</span>
              <span className="text-gray-200 font-mono text-xs">{popover.edge.source}</span>
              <span className="text-gray-500">Target:</span>
              <span className="text-gray-200 font-mono text-xs">{popover.edge.target}</span>
              <span className="text-gray-500">CPS Key:</span>
              <span className="text-emerald-400 font-mono text-xs bg-emerald-950/30 px-1 rounded">{popover.edge.data?.propertyKey || 'Unknown'}</span>
              <span className="text-gray-500">Host URL:</span>
              <span className="text-blue-400 font-mono text-xs break-all">{popover.edge.data?.propertyValue || 'Unknown'}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
