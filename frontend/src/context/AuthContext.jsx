import React, { createContext, useContext, useState, useEffect } from 'react';
import api, { isDemoMode, enableDemoMode, disableDemoMode, DEMO_MODE_KEY } from '../services/api';
import { MOCK_USER } from '../services/mockData.js';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [orgId, setOrgId] = useState(null);
  const [orgName, setOrgName] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []);

  const checkSession = async () => {
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
      }
    } catch (e) {
      // not authenticated
    } finally {
      setLoading(false);
    }
  };

  const login = async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    setUser(res.data.user);
    setOrgId(res.data.orgId);
    setOrgName(res.data.orgName);
    return res.data;
  };

  const tokenLogin = async (token) => {
    const res = await api.post('/auth/token-login', { token });
    setUser(res.data.user);
    setOrgId(res.data.orgId);
    setOrgName(res.data.orgName);
    return res.data;
  };

  const demoLogin = () => {
    enableDemoMode();
    setUser(MOCK_USER);
    setOrgId('demo-org-001');
    setOrgName('Demo Organization');
  };

  const logout = async () => {
    disableDemoMode();
    await api.post('/auth/logout');
    setUser(null);
    setOrgId(null);
    setOrgName(null);
  };

  return (
    <AuthContext.Provider value={{ user, orgId, orgName, loading, login, tokenLogin, demoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);