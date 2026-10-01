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
      } bg-white border-r border-gray-200 flex flex-col transition-all duration-300 flex-shrink-0`}
    >
      {/* Logo */}
      <div className="flex items-center h-16 px-4 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-sf-600 flex items-center justify-center flex-shrink-0">
            <span className="text-white font-bold text-sm">M</span>
          </div>
          {open && (
            <div>
              <p className="text-gray-900 font-semibold text-sm leading-tight">MuleSoft</p>
              <p className="text-gray-500 text-xs">Ops Dashboard</p>
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
                    ? 'bg-sf-600 text-white'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
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
        <div className="p-4 border-t border-gray-200">
          <p className="text-xs text-gray-500">Anypoint Platform</p>
          <a
            href="https://docs.mulesoft.com/general/"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-sf-600 hover:text-sf-700 flex items-center gap-1 mt-1"
          >
            Docs <ChevronRight size={10} />
          </a>
        </div>
      )}
    </aside>
  );
}