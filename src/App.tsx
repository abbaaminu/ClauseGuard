import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import DashboardPage from '@/pages/DashboardPage';
import ContractWorkspacePage from '@/pages/ContractWorkspacePage';
import PlaybooksPage from '@/pages/PlaybooksPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import AppLayout from '@/components/layouts/AppLayout';

const App: React.FC = () => {
  return (
    <Router>
      <AuthProvider>
        <RouteGuard>
          <IntersectObserver />
          <Routes>
            {/* Public */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            {/* App shell — layout wraps child pages via Outlet */}
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/contracts/:id" element={<ContractWorkspacePage />} />
              <Route path="/playbooks" element={<PlaybooksPage />} />
            </Route>
            {/* Default */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          <Toaster richColors position="top-right" />
        </RouteGuard>
      </AuthProvider>
    </Router>
  );
};

export default App;
