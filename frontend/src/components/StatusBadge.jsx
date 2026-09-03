import React from 'react';

// ── Status configuration ──────────────────────────────────────────────────────
// pulse:true  → the indicator dot animates with animate-pulse to signal
//               that this is a transient / in-progress state.
const statusConfig = {
  RUNNING:           { label: 'Running',       color: 'bg-green-500/20 text-green-400 border-green-500/30',    pulse: false },
  STARTED:           { label: 'Running',       color: 'bg-green-500/20 text-green-400 border-green-500/30',    pulse: false },
  FAILED:            { label: 'Failed',        color: 'bg-red-500/20 text-red-400 border-red-500/30',          pulse: false },
  DEPLOY_FAILED:     { label: 'Deploy Failed', color: 'bg-red-500/20 text-red-400 border-red-500/30',          pulse: false },
  STOPPED:           { label: 'Stopped',       color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',       pulse: false },
  UNDEPLOYED:        { label: 'Undeployed',    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',       pulse: false },
  DEPLOYING:         { label: 'Deploying',     color: 'bg-blue-500/20 text-blue-400 border-blue-500/30',       pulse: true  },
  UPDATING:          { label: 'Updating',      color: 'bg-purple-500/20 text-purple-400 border-purple-500/30', pulse: true  },
  STARTING:          { label: 'Starting',      color: 'bg-blue-500/20 text-blue-300 border-blue-500/30',       pulse: true  },
  STOPPING:          { label: 'Stopping',      color: 'bg-orange-500/20 text-orange-400 border-orange-500/30', pulse: true  },
  PARTIALLY_STARTED: { label: 'Partial',       color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', pulse: true  },
  PARTIALLY_RUNNING: { label: 'Partial',       color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30', pulse: true  },
  APPLIED:           { label: 'Applied',       color: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',       pulse: false },
  APPLYING:          { label: 'Applying',      color: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',       pulse: true  },
  NOT_RUNNING:       { label: 'Not Running',   color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',       pulse: false },
  active:            { label: 'Active',        color: 'bg-green-500/20 text-green-400 border-green-500/30',    pulse: false },
  inactive:          { label: 'Inactive',      color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',       pulse: false },
};

// In-progress states whose dot should pulse
const PULSING_STATES = new Set([
  'DEPLOYING', 'UPDATING', 'STARTING', 'STOPPING',
  'APPLYING', 'PARTIALLY_STARTED', 'PARTIALLY_RUNNING',
]);

export default function StatusBadge({ status }) {
  const key = (status || '').toUpperCase();
  const config = statusConfig[key] || statusConfig[status] || {
    label: status || 'Unknown',
    color: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
    pulse: false,
  };

  const shouldPulse = config.pulse || PULSING_STATES.has(key);

  return (
    <span
      role="status"
      aria-label={`Status: ${config.label}`}
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${config.color}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full bg-current mr-1.5 ${shouldPulse ? 'animate-pulse' : ''}`}
      />
      {config.label}
    </span>
  );
}