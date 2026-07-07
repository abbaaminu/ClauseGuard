import { Navigate } from 'react-router-dom';
import type { ReactNode } from 'react';
import AppLayout from '@/components/layouts/AppLayout';
import LoginPage from '@/pages/LoginPage';
import RegisterPage from '@/pages/RegisterPage';
import DashboardPage from '@/pages/DashboardPage';
import ContractWorkspacePage from '@/pages/ContractWorkspacePage';
import PlaybooksPage from '@/pages/PlaybooksPage';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  /** Accessible without login. Routes without this flag require authentication. */
  public?: boolean;
}

export const routes: RouteConfig[] = [
  // Public routes
  {
    name: 'Login',
    path: '/login',
    element: <LoginPage />,
    public: true,
  },
  {
    name: 'Register',
    path: '/register',
    element: <RegisterPage />,
    public: true,
  },
  // Root redirect
  {
    name: 'Home',
    path: '/',
    element: <Navigate to="/dashboard" replace />,
    public: true,
  },
  // Authenticated app routes (wrapped in layout)
  {
    name: 'Dashboard',
    path: '/dashboard',
    element: (
      <AppLayout />
    ),
    visible: true,
  },
  {
    name: 'Contract Workspace',
    path: '/contracts/:id',
    element: (
      <AppLayout />
    ),
    visible: false,
  },
  {
    name: 'Playbooks',
    path: '/playbooks',
    element: (
      <AppLayout />
    ),
    visible: true,
  },
];
