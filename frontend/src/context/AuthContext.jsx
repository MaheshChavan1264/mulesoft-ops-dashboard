import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import api, { isDemoMode, enableDemoMode, disableDemoMode } from '../services/api';
import { MOCK_USER } from '../services/mocks/mockData.js';
import { clearCache } from '../services/apiCache';
import { warmCache } from '../services/prefetch';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState(null);
  const [loading, setLoading] = useState(true);

  const checkSession = useCallback(async () => {
    try {
      if (isDemoMode()) {
        setUser(MOCK_USER);
        setOrgId('demo-org-001');
        setOrgName('Demo Organization');
        setLoading(false);
        return;
      }
      const res = await api.get('/auth/session');
      if (res.data.authenticated) {
        setUser(res.data.user);
        setOrgId(res.data.orgId);
        setOrgName(res.data.orgName);
      } else {
        // Session expired or server restarted — clear stale user state
        // so the route guard redirects to the login page.
        setUser(null);
        setOrgId(null);
        setOrgName(null);
      }
    } catch (e) {
      // Network error or unexpected failure — clear user state to be safe
      setUser(null);
      setOrgId(null);
      setOrgName(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkSession();

    // Recheck session when the user switches back to this tab.
    // This handles the "server restarted while tab was open" case:
    // the React state still shows the user as logged in but the backend
    // session is gone — the visibility change triggers a re-validation.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        checkSession();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [checkSession]);

  const applyResult = useCallback((data) => {
    setUser(data.user);
    setOrgId(data.orgId);
    setOrgName(data.orgName);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  }, [applyResult]);

  const tokenLogin = useCallback(async (token) => {
    const res = await api.post('/auth/token-login', { token });
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  }, [applyResult]);

  const connectedAppLogin = useCallback(async (clientId, clientSecret) => {
    const res = await api.post('/auth/connected-app-login', { clientId, clientSecret });
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  }, [applyResult]);

  const demoLogin = useCallback(() => {
    enableDemoMode();
    setUser(MOCK_USER);
    setOrgId('demo-org-001');
    setOrgName('Demo Organization');
  }, []);

  const logout = useCallback(async () => {
    disableDemoMode();
    await api.post('/auth/logout');
    clearCache(); // flush stale data so next user never sees previous session
    setUser(null);
    setOrgId(null);
    setOrgName(null);
  }, []);

  const value = useMemo(
    () => ({ user, orgId, orgName, loading, login, tokenLogin, connectedAppLogin, demoLogin, logout }),
    [user, orgId, orgName, loading, login, tokenLogin, connectedAppLogin, demoLogin, logout]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);