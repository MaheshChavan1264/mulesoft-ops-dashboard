import React from 'react';

export default function StatCard({ title, value, icon: Icon, color = 'blue', subtitle }) {
  const colorMap = {
    blue: 'bg-blue-500/10 text-blue-400',
    green: 'bg-green-500/10 text-green-400',
    red: 'bg-red-500/10 text-red-400',
    yellow: 'bg-yellow-500/10 text-yellow-400',
    purple: 'bg-purple-500/10 text-purple-400',
    gray: 'bg-gray-500/10 text-gray-400'
  };

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 flex items-center gap-4">
      <div className={`p-3 rounded-xl ${colorMap[color]}`}>
        <Icon size={22} />
      </div>
      <div>
        <p className="text-gray-400 text-sm">{title}</p>
        <p className="text-white text-2xl font-bold">{value ?? '—'}</p>
        {subtitle && <p className="text-gray-500 text-xs mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}