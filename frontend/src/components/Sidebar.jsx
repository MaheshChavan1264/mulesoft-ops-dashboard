import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Server,
  ShieldCheck,
  Package,
  Activity,
  GitCompare,
  Users,
  Database,
  Globe,
  ChevronRight
} from 'lucide-react';

const navItems = [
  { to: '/applications', icon: Server, label: 'Applications' },
  { to: '/api-manager', icon: ShieldCheck, label: 'API Manager' },
  { to: '/exchange', icon: Package, label: 'Exchange Assets' },
  { to: '/ping-test', icon: Activity, label: 'Ping Test' },
  { to: '/cps-compare', icon: GitCompare, label: 'CPS Compare' },
  { to: '/cps-manager', icon: Database, label: 'CPS Manager' },
  { to: '/global-cps-manager', icon: Globe, label: 'Global CPS Manager' },
  { to: '/user-search', icon: Users, label: 'Global Search' },
];

export default function Sidebar({ open }) {
  const location = useLocation();
  return (
    <aside
      className={`${
        open ? 'w-64' : 'w-16'
      } bg-gray-900 border-r border-gray-800 flex flex-col transition-all duration-300 flex-shrink-0`}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          {open && (
            <div>
              <p className="text-white font-semibold text-sm leading-tight">MuleSoft</p>
              <p className="text-gray-400 text-xs">Integration Dashboard</p>
            </div>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-2 py-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => {
          // Use prefix matching so sub-routes (e.g. /applications/:org/:env/:id)
          // keep the parent nav item highlighted (Feature 1.6).
          const isActive = location.pathname === to || location.pathname.startsWith(to + '/');
          return (
            <NavLink
              key={to}
              to={to}
              title={!open ? label : undefined}
              className={() =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm font-medium ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`
              }
            >
              <Icon size={18} className="flex-shrink-0" />
              {open && <span>{label}</span>}
            </NavLink>
          );
        })}
      </nav>

      {/* Footer */}
      {open && (
        <div className="p-4 border-t border-gray-800">
          <p className="text-xs text-gray-500">Anypoint Platform</p>
          <a
            href="https://docs.mulesoft.com/general/"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 mt-1"
          >
            Docs <ChevronRight size={10} />
          </a>
        </div>
      )}
    </aside>
  );
}