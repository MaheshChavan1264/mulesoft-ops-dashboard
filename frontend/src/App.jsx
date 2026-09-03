import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { CredentialStoreProvider } from './context/CredentialStoreContext';
import { CpsCredentialStoreProvider } from './context/CpsCredentialStoreContext';
import { ToastProvider } from './context/ToastContext';
import { NotificationProvider } from './context/NotificationContext';
import Layout from './components/Layout';
import LoginPage from './pages/LoginPage';
import ApplicationsPage from './pages/ApplicationsPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import ApiManagerPage from './pages/ApiManagerPage';
import ExchangePage from './pages/ExchangePage';
import PingTestPage from './pages/PingTestPage';
import CpsComparisonPage from './pages/CpsComparisonPage';
import UserSearchPage from './pages/UserSearchPage';
import CpsManagerPage from './pages/CpsManagerPage';
import ApiGraphPage from './pages/ApiGraphPage';

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
};

export default function App() {
  return (
    <ToastProvider>
    <NotificationProvider>
    <CpsCredentialStoreProvider>
    <CredentialStoreProvider>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/applications" replace />} />
            <Route path="applications" element={<ApplicationsPage />} />
            <Route path="applications/:orgId/:envId/:appId" element={<ApplicationDetailPage />} />
            <Route path="api-manager" element={<ApiManagerPage />} />
            <Route path="exchange" element={<ExchangePage />} />
            <Route path="ping-test" element={<PingTestPage />} />
            <Route path="cps-compare" element={<CpsComparisonPage />} />
            <Route path="user-search" element={<UserSearchPage />} />
            <Route path="cps-manager" element={<CpsManagerPage />} />
            <Route path="api-graph" element={<ApiGraphPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </CredentialStoreProvider>
    </CpsCredentialStoreProvider>
    </NotificationProvider>
    </ToastProvider>
  );
}
