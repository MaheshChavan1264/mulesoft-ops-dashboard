import React from 'react';

// ── Status configuration ──────────────────────────────────────────────────────
// pulse:true  → the indicator dot animates with animate-pulse to signal
//               that this is a transient / in-progress state.
const statusConfig = {
  RUNNING:           { label: 'Running',       color: 'bg-green-100 text-green-700 border-green-200',    pulse: false },
  STARTED:           { label: 'Running',       color: 'bg-green-100 text-green-700 border-green-200',    pulse: false },
  FAILED:            { label: 'Failed',        color: 'bg-red-100 text-red-700 border-red-200',          pulse: false },
  DEPLOY_FAILED:     { label: 'Deploy Failed', color: 'bg-red-100 text-red-700 border-red-200',          pulse: false },
  STOPPED:           { label: 'Stopped',       color: 'bg-gray-100 text-gray-600 border-gray-200',       pulse: false },
  UNDEPLOYED:        { label: 'Undeployed',    color: 'bg-gray-100 text-gray-600 border-gray-200',       pulse: false },
  DEPLOYING:         { label: 'Deploying',     color: 'bg-blue-100 text-blue-700 border-blue-200',       pulse: true  },
  UPDATING:          { label: 'Updating',      color: 'bg-purple-100 text-purple-700 border-purple-200', pulse: true  },
  STARTING:          { label: 'Starting',      color: 'bg-blue-100 text-blue-600 border-blue-200',       pulse: true  },
  STOPPING:          { label: 'Stopping',      color: 'bg-orange-100 text-orange-700 border-orange-200', pulse: true  },
  PARTIALLY_STARTED: { label: 'Partial',       color: 'bg-yellow-100 text-yellow-700 border-yellow-200', pulse: true  },
  PARTIALLY_RUNNING: { label: 'Partial',       color: 'bg-yellow-100 text-yellow-700 border-yellow-200', pulse: true  },
  APPLIED:           { label: 'Applied',       color: 'bg-cyan-100 text-cyan-700 border-cyan-200',       pulse: false },
  APPLYING:          { label: 'Applying',      color: 'bg-cyan-100 text-cyan-600 border-cyan-200',       pulse: true  },
  NOT_RUNNING:       { label: 'Not Running',   color: 'bg-gray-100 text-gray-600 border-gray-200',       pulse: false },
  active:            { label: 'Active',        color: 'bg-green-100 text-green-700 border-green-200',    pulse: false },
  inactive:          { label: 'Inactive',      color: 'bg-gray-100 text-gray-600 border-gray-200',       pulse: false },
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
    color: 'bg-gray-100 text-gray-600 border-gray-200',
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
