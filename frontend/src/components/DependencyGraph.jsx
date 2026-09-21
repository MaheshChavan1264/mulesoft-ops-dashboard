import React, { useMemo } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Info } from 'lucide-react';

const NODE_COLORS = {
  XAPI: { bg: '#1e3a8a', border: '#3b82f6', text: '#bfdbfe' }, // Blue
  PAPI: { bg: '#4c1d95', border: '#8b5cf6', text: '#e9d5ff' }, // Purple
  SAPI: { bg: '#14532d', border: '#22c55e', text: '#bbf7d0' }, // Green
  EXTERNAL: { bg: '#78350f', border: '#f59e0b', text: '#fde68a' }, // Amber
  DEFAULT: { bg: '#1f2937', border: '#4b5563', text: '#f3f4f6' }, // Gray
  TARGET: { bg: '#7f1d1d', border: '#ef4444', text: '#fecaca' }, // Red (for backward target)
};

const CustomNode = ({ data }) => {
  const isTarget = data.isTarget;
  const styleConf = isTarget ? NODE_COLORS.TARGET : (NODE_COLORS[data.type] || NODE_COLORS.DEFAULT);

  return (
    <div
      className="px-4 py-2 shadow-lg rounded-md border-2 min-w-[150px] text-center transition-all"
      style={{
        backgroundColor: styleConf.bg,
        borderColor: styleConf.border,
        color: styleConf.text,
      }}
    >
      <div className="font-bold text-xs mb-1 opacity-80">{data.type}</div>
      <div className="font-medium text-sm break-words">{data.label}</div>
    </div>
  );
};

const nodeTypes = {
  custom: CustomNode,
};

export default function DependencyGraph({ graphData, direction, targetAppKey, onEdgeClick }) {
  // Convert backend graphData to React Flow format
  const { initialNodes, initialEdges } = useMemo(() => {
    if (!graphData || !graphData.nodes) return { initialNodes: [], initialEdges: [] };

    // Layout logic: extremely simple auto-layout based on type layers
    // XAPI at y=50, PAPI at y=150, SAPI at y=250, EXTERNAL at y=350
    const layerY = {
      XAPI: 50,
      PAPI: 200,
      SAPI: 350,
      EXTERNAL: 500,
      DEFAULT: 650,
    };
    
    // Count nodes in each layer to distribute horizontally
    const layerCounts = { XAPI: 0, PAPI: 0, SAPI: 0, EXTERNAL: 0, DEFAULT: 0 };
    
    const nodes = graphData.nodes.map((node) => {
      const type = node.type || 'DEFAULT';
      const isTarget = (direction === 'backward' || direction === 'forward') && node.id === targetAppKey;
      
      const x = (layerCounts[type] * 200) + 100;
      layerCounts[type]++;
      
      return {
        id: node.id,
        type: 'custom',
        position: { x, y: layerY[type] || layerY.DEFAULT },
        data: {
          label: node.label,
          type: node.type,
          isTarget,
        },
      };
    });

    const edges = (graphData.edges || []).map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      label: 'calls',
      animated: direction === 'backward' && edge.target === targetAppKey,
      style: {
        stroke: direction === 'backward' ? '#ef4444' : '#6b7280',
        strokeWidth: 2,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: direction === 'backward' ? '#ef4444' : '#6b7280',
      },
      data: {
        propertyKey: edge.propertyKey,
        propertyValue: edge.propertyValue,
      },
    }));

    return { initialNodes: nodes, initialEdges: edges };
  }, [graphData, direction, targetAppKey]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Sync state when props change
  React.useEffect(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const handleEdgeClick = (event, edge) => {
    event.stopPropagation();
    if (onEdgeClick) {
      onEdgeClick(edge, { x: event.clientX, y: event.clientY });
    }
  };

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={handleEdgeClick}
        nodeTypes={nodeTypes}
        fitView
        attributionPosition="bottom-right"
      >
        <Background color="#374151" gap={16} />
        <Controls />
        <MiniMap
          nodeStrokeColor={(n) => {
            if (n.data?.isTarget) return '#ef4444';
            return '#4b5563';
          }}
          nodeColor={(n) => {
            if (n.data?.isTarget) return '#7f1d1d';
            const type = n.data?.type;
            if (type === 'XAPI') return '#1e3a8a';
            if (type === 'PAPI') return '#4c1d95';
            if (type === 'SAPI') return '#14532d';
            if (type === 'EXTERNAL') return '#78350f';
            return '#1f2937';
          }}
        />
      </ReactFlow>
    </div>
  );
}
