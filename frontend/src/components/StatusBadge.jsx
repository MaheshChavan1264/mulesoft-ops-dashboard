import React from 'react';

const statusConfig = {
  RUNNING: { label: 'Running', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  running: { label: 'Running', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  STARTED: { label: 'Running', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  FAILED: { label: 'Failed', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  failed: { label: 'Failed', color: 'bg-red-500/20 text-red-400 border-red-500/30' },
  STOPPED: { label: 'Stopped', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  stopped: { label: 'Stopped', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' },
  UNDEPLOYED: { label: 'Undeployed', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' },
  DEPLOYING: { label: 'Deploying', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  deploying: { label: 'Deploying', color: 'bg-blue-500/20 text-blue-400 border-blue-500/30' },
  UPDATING: { label: 'Updating', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' },
  active: { label: 'Active', color: 'bg-green-500/20 text-green-400 border-green-500/30' },
  inactive: { label: 'Inactive', color: 'bg-gray-500/20 text-gray-400 border-gray-500/30' }
};

export default function StatusBadge({ status }) {
  const config = statusConfig[status] || {
    label: status || 'Unknown',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30'
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current mr-1.5"></span>
      {config.label}
    </span>
  );
}