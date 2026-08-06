import React from 'react';
import { Menu, LogOut, User, RefreshCw, Zap } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { isDemoMode } from '../services/api';
import CredentialImportButton from './CredentialImportButton';
import CpsCredentialImportButton from './CpsCredentialImportButton';

export default function Header({ onToggleSidebar }) {
  const { user, orgName, logout } = useAuth();
  const navigate = useNavigate();
  const demo = isDemoMode();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-center gap-4">
        <button
          onClick={onToggleSidebar}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div>
            <h2 className="text-sm font-semibold text-white">
              {orgName || 'MuleSoft Dashboard'}
            </h2>
            <p className="text-xs text-gray-500">Anypoint Platform</p>
          </div>
          {demo && (
            <span className="flex items-center gap-1 text-xs font-semibold bg-purple-600/20 text-purple-400 border border-purple-500/30 px-2 py-0.5 rounded-full">
              <Zap size={10} /> DEMO
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Global credential imports — always accessible from any page */}
        <div className="flex items-center gap-2 border-r border-gray-700/60 pr-3">
          <CredentialImportButton compact />
          <CpsCredentialImportButton compact />
        </div>

        <button
          onClick={() => window.location.reload()}
          className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>

        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-800">
          <User size={14} className="text-gray-400" />
          <span className="text-sm text-gray-300">
            {user?.firstName
              ? `${user.firstName} ${user.lastName || ''}`
              : user?.username || 'User'}
          </span>
        </div>

        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-gray-400 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800"
        >
          <LogOut size={15} />
          <span>{demo ? 'Exit Demo' : 'Logout'}</span>
        </button>
      </div>
    </header>
  );
}