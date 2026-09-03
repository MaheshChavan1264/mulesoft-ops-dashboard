import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Menu, LogOut, User, RefreshCw, Zap, SlidersHorizontal, Building2, Globe } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { isDemoMode } from '../services/api';
import api from '../services/api';
import CredentialImportButton from './CredentialImportButton';
import CpsCredentialImportButton from './CpsCredentialImportButton';
import BgFilterModal, { applyBgFilter, getVisibleBgIds } from './BgFilterModal';
import EnvFilterModal, { applyEnvFilter, getVisibleEnvIds } from './EnvFilterModal';

export default function Header({ onToggleSidebar }) {
  const { user, orgName, logout } = useAuth();
  const navigate = useNavigate();
  const demo = isDemoMode();

  const [showBgFilter, setShowBgFilter] = useState(false);
  const [showEnvFilter, setShowEnvFilter] = useState(false);
  // Feature 7: last refresh timestamp
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [relativeTime, setRelativeTime] = useState('');
  const timerRef = useRef(null);
  const [allBgs, setAllBgs] = useState([]);
  const [allEnvs, setAllEnvs] = useState([]);
  const [envsLoading, setEnvsLoading] = useState(false);

  // Reactive filter-active state (re-reads localStorage after modal closes)
  const [bgFilterActive, setBgFilterActive] = useState(() => getVisibleBgIds().size > 0);
  const [envFilterActive, setEnvFilterActive] = useState(() => getVisibleEnvIds().size > 0);

  // Load BGs once on mount
  useEffect(() => {
    api.get('/organizations/business-groups')
      .then(r => setAllBgs(r.data?.data || []))
      .catch(() => {});
  }, []);

  // Load environments from all visible BGs when Env filter modal is about to open
  const loadEnvsForFilter = useCallback(async () => {
    if (allBgs.length === 0) return;
    setEnvsLoading(true);
    const visible = applyBgFilter(allBgs);
    const bgsToFetch = visible.length > 0 ? visible : allBgs.slice(0, 3);
    try {
      const results = await Promise.allSettled(bgsToFetch.map(bg => api.get(`/environments/${bg.id}`)));
      const merged = [];
      const seen = new Set();
      results.forEach((r, i) => {
        const bg = bgsToFetch[i];
        if (r.status === 'fulfilled') {
          (r.value.data?.data || []).forEach(e => {
            // Attach bgId + bgName so EnvFilterModal can group by Business Group
            if (!seen.has(e.id)) { seen.add(e.id); merged.push({ ...e, bgId: bg.id, bgName: bg.name }); }
          });
        }
      });
      setAllEnvs(merged);
    } catch { /* ignore */ }
    setEnvsLoading(false);
  }, [allBgs]);

  const handleOpenEnvFilter = () => {
    loadEnvsForFilter();
    setShowEnvFilter(true);
  };

  // Feature 7: update relative time every 30s
  const updateRelative = useCallback((ts) => {
    if (!ts) return;
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 10) setRelativeTime('just now');
    else if (diff < 60) setRelativeTime(`${diff}s ago`);
    else if (diff < 3600) setRelativeTime(`${Math.round(diff / 60)}m ago`);
    else setRelativeTime(`${Math.round(diff / 3600)}h ago`);
  }, []);

  useEffect(() => {
    if (!lastRefreshed) return;
    updateRelative(lastRefreshed);
    timerRef.current = setInterval(() => updateRelative(lastRefreshed), 30000);
    return () => clearInterval(timerRef.current);
  }, [lastRefreshed, updateRelative]);

  const handleRefresh = () => {
    setLastRefreshed(Date.now());
    window.location.reload();
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  const visibleBgsCount = applyBgFilter(allBgs).length;

  return (
    <>
      {showBgFilter && (
        <BgFilterModal
          businessGroups={allBgs}
          onClose={() => setShowBgFilter(false)}
          onSaved={() => setBgFilterActive(getVisibleBgIds().size > 0)}
        />
      )}
      {showEnvFilter && (
        <EnvFilterModal
          environments={allEnvs}
          onClose={() => setShowEnvFilter(false)}
          onSaved={() => setEnvFilterActive(getVisibleEnvIds().size > 0)}
        />
      )}

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
        {/* Global BG + Env filter buttons */}
        <div className="flex items-center gap-1.5 border-r border-gray-700/60 pr-3">
          <button
            onClick={() => setShowBgFilter(true)}
            title="Filter visible Business Groups"
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all ${
              bgFilterActive
                ? 'bg-blue-600/20 border-blue-600/50 text-blue-400 hover:bg-blue-600/30'
                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <Building2 size={12} />
            <span className="hidden sm:inline">BG Filter</span>
            {bgFilterActive && allBgs.length > 0 && (
              <span className="text-[10px] font-bold">{visibleBgsCount}/{allBgs.length}</span>
            )}
          </button>
          <button
            onClick={handleOpenEnvFilter}
            title="Filter visible Environments"
            disabled={envsLoading}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-all disabled:opacity-50 ${
              envFilterActive
                ? 'bg-green-600/20 border-green-600/50 text-green-400 hover:bg-green-600/30'
                : 'bg-gray-800 border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-600'
            }`}
          >
            <Globe size={12} />
            <span className="hidden sm:inline">Env Filter</span>
            {envsLoading && <span className="animate-spin inline-block w-2.5 h-2.5 border border-current rounded-full border-t-transparent" />}
          </button>
        </div>

        {/* Global credential imports — always accessible from any page */}
        <div className="flex items-center gap-2 border-r border-gray-700/60 pr-3">
          <CredentialImportButton compact />
          <CpsCredentialImportButton compact />
        </div>

        {/* Feature 7: Refresh button with timestamp */}
        <div className="flex items-center gap-1">
          <button onClick={handleRefresh}
            className="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-800"
            title={lastRefreshed ? `Last refreshed ${relativeTime}` : 'Refresh page'}>
            <RefreshCw size={16} />
          </button>
          {relativeTime && (
            <span className="text-[10px] text-gray-600 whitespace-nowrap hidden sm:inline" title="Last refreshed">
              {relativeTime}
            </span>
          )}
        </div>

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
    </>
  );
}
