import React, { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/layout/Layout';
import LoginPage from '../pages/LoginPage';

// Route-level code splitting — each page (and its exclusive dependencies,
// e.g. xlsx/cronstrue) only downloads when the user actually navigates to
// it, instead of all 10 pages (~2900-line ApplicationDetailPage,
// ~2200-line CpsManagerPage, etc.) shipping in one initial bundle.
const ApplicationsPage = lazy(() => import('../features/applications/ApplicationsPage'));
const ApplicationDetailPage = lazy(() => import('../features/applications/ApplicationDetailPage'));
const ApiManagerPage = lazy(() => import('../features/api-manager/ApiManagerPage'));
const ExchangePage = lazy(() => import('../features/exchange/ExchangePage'));
const PingTestPage = lazy(() => import('../features/ping-test/PingTestPage'));
const CpsComparisonPage = lazy(() => import('../features/cps/CpsComparisonPage'));
const GlobalSearchPage = lazy(() => import('../features/search/GlobalSearchPage'));
const CpsManagerPage = lazy(() => import('../features/cps/CpsManagerPage'));
const GlobalCpsManagerPage = lazy(() => import('../features/cps/GlobalCpsManagerPage'));

const RouteFallback = () => (
  <div className="flex items-center justify-center h-full min-h-[60vh]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-sf-500"></div>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-sf-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
      </div>
    );
  }
  return user ? children : <Navigate to="/login" replace />;
};

/**
 * AppRoutes
 *
 * The full route table — extracted out of App.jsx (which otherwise mixed
 * provider nesting with route/lazy-import wiring) so each concern lives in
 * its own module — see FRONTEND_ARCHITECTURE_REVIEW.md §4 "routes/ module".
 */
export default function AppRoutes() {
  return (
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
        <Route path="applications" element={<Suspense fallback={<RouteFallback />}><ApplicationsPage /></Suspense>} />
        <Route path="applications/:orgId/:envId/:appId" element={<Suspense fallback={<RouteFallback />}><ApplicationDetailPage /></Suspense>} />
        <Route path="api-manager" element={<Suspense fallback={<RouteFallback />}><ApiManagerPage /></Suspense>} />
        <Route path="exchange" element={<Suspense fallback={<RouteFallback />}><ExchangePage /></Suspense>} />
        <Route path="ping-test" element={<Suspense fallback={<RouteFallback />}><PingTestPage /></Suspense>} />
        <Route path="cps-compare" element={<Suspense fallback={<RouteFallback />}><CpsComparisonPage /></Suspense>} />
        <Route path="user-search" element={<Suspense fallback={<RouteFallback />}><GlobalSearchPage /></Suspense>} />
        <Route path="cps-manager" element={<Suspense fallback={<RouteFallback />}><CpsManagerPage /></Suspense>} />
        <Route path="global-cps-manager" element={<Suspense fallback={<RouteFallback />}><GlobalCpsManagerPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/applications" replace />} />
      </Route>
    </Routes>
  );
}
