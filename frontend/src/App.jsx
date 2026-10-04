import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CredentialStoreProvider } from './context/CredentialStoreContext';
import { CpsCredentialStoreProvider } from './context/CpsCredentialStoreContext';
import { GlobalCpsCredentialStoreProvider } from './context/GlobalCpsCredentialStoreContext';
import { ToastProvider } from './context/ToastContext';
import { NotificationProvider } from './context/NotificationContext';
import AppRoutes from './routes/AppRoutes';

export default function App() {
  return (
    <ThemeProvider>
    <ToastProvider>
    <NotificationProvider>
    <CpsCredentialStoreProvider>
    <GlobalCpsCredentialStoreProvider>
    <CredentialStoreProvider>
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
    </CredentialStoreProvider>
    </GlobalCpsCredentialStoreProvider>
    </CpsCredentialStoreProvider>
    </NotificationProvider>
    </ToastProvider>
    </ThemeProvider>
  );
}
