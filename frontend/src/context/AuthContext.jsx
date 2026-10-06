import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { isDemoMode, enableDemoMode, disableDemoMode } from '../services/api';
import { MOCK_USER } from '../services/mocks/mockData.js';
import { clearCache } from '../services/apiCache';
import { warmCache } from '../services/prefetch';
import * as authService from '../services/authService';
import { useCredentialStore } from './CredentialStoreContext';
import { useCpsCredentialStore } from './CpsCredentialStoreContext';
import { useGlobalCpsCredentialStore } from './GlobalCpsCredentialStoreContext';

const AuthContext = createContext(null);

// Read once by Layout.jsx right after mount to decide whether to show the
// post-login "upload your Ping/CPS credentials" modal — set here (not in
// Layout) so it only fires on an actual login action, never on checkSession's
// background revalidation (tab focus, page refresh) which would otherwise
// re-show the modal on every reload.
const JUST_LOGGED_IN_KEY = 'mule_dashboard_just_logged_in';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState(null);
  const [loading, setLoading] = useState(true);

  // All three credential stores are RAM-only — none persist secrets to
  // localStorage/sessionStorage — but since their Providers are mounted
  // once at the top of the app and never unmount on logout, their React
  // state would otherwise survive a logout → different-user login within
  // the same browser tab. Clearing them explicitly here closes that gap.
  const { clearCredentials: clearAppCreds } = useCredentialStore();
  const { clearCredentials: clearCpsCreds } = useCpsCredentialStore();
  const { clearCredentials: clearGlobalCpsCreds } = useGlobalCpsCredentialStore();

  const checkSession = useCallback(async () => {
    try {
      if (isDemoMode()) {
        setUser(MOCK_USER);
        setOrgId('demo-org-001');
        setOrgName('Demo Organization');
        setLoading(false);
        return;
      }
      const res = await authService.getSession();
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
    sessionStorage.setItem(JUST_LOGGED_IN_KEY, '1');
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await authService.login(username, password);
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  }, [applyResult]);

  const tokenLogin = useCallback(async (token) => {
    const res = await authService.tokenLogin(token);
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  }, [applyResult]);

  const connectedAppLogin = useCallback(async (clientId, clientSecret) => {
    const res = await authService.connectedAppLogin(clientId, clientSecret);
    applyResult(res.data);
    warmCache(res.data.orgId); // fire-and-forget background prefetch
    return res.data;
  }, [applyResult]);

  const demoLogin = useCallback(() => {
    enableDemoMode();
    setUser(MOCK_USER);
    setOrgId('demo-org-001');
    setOrgName('Demo Organization');
    sessionStorage.setItem(JUST_LOGGED_IN_KEY, '1');
  }, []);

  const logout = useCallback(async () => {
    disableDemoMode();
    await authService.logout();
    clearCache(); // flush stale data so next user never sees previous session
    clearAppCreds();       // CredentialStoreContext — RAM-only ping-test CSV creds
    clearCpsCreds();        // CpsCredentialStoreContext — RAM-only per-app CPS CSV creds
    clearGlobalCpsCreds();  // GlobalCpsCredentialStoreContext — RAM-only Global CPS matrix
    sessionStorage.removeItem(JUST_LOGGED_IN_KEY);
    setUser(null);
    setOrgId(null);
    setOrgName(null);
  }, [clearAppCreds, clearCpsCreds, clearGlobalCpsCreds]);

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

/**
 * Consume (read-then-clear) the "just logged in" flag set by a real login
 * action (login/tokenLogin/connectedAppLogin/demoLogin). Called once by
 * Layout.jsx on mount — returns true at most once per actual login, never
 * on a page refresh or tab-focus session revalidation.
 */
export function consumeJustLoggedIn() {
  const flag = sessionStorage.getItem(JUST_LOGGED_IN_KEY);
  if (flag) sessionStorage.removeItem(JUST_LOGGED_IN_KEY);
  return !!flag;
}