import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import IntersectObserver from '@/components/common/IntersectObserver';
import { AppErrorBoundary } from '@/components/common/AppErrorBoundary';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/contexts/AuthContext';
import { RouteGuard } from '@/components/common/RouteGuard';
import DashboardPage from '@/pages/DashboardPage';
import ContractWorkspacePage from '@/pages/ContractWorkspacePage';
import PlaybooksPage from '@/pages/PlaybooksPage';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import AppLayout from '@/components/layouts/AppLayout';
import BillingPage from '@/pages/BillingPage';
import NotFound from '@/pages/NotFound';

const App: React.FC = () => {
  return (
    <AppErrorBoundary>
      <Router>
        <AuthProvider>
          <Toaster richColors position="top-right" />
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
                <Route path="/billing" element={<BillingPage />} />
                {/* Unknown paths render a real 404 instead of silently
                    bouncing the user back to the dashboard. */}
                <Route path="*" element={<NotFound />} />
              </Route>
              {/* Root */}
              <Route path="/" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </RouteGuard>
        </AuthProvider>
      </Router>
    </AppErrorBoundary>
  );
};

export default App;
