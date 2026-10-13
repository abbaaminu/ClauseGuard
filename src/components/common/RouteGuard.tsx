import { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { PUBLIC_ROUTE_PATHS } from '@/routes';

interface RouteGuardProps {
  children: React.ReactNode;
}

/**
 * Exact-match against the public route table, with support for `*` globs
 * (e.g. `/reset-password/*`) so future public sections only need a
 * `public: true` entry in `src/routes.tsx`.
 */
function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTE_PATHS.some((pattern) => {
    if (!pattern.includes('*')) return pattern === pathname;
    const escaped = pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(pathname);
  });
}

export function RouteGuard({ children }: RouteGuardProps) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isPublic = isPublicPath(location.pathname);

  useEffect(() => {
    if (loading || user || isPublic) return;
    navigate('/login', { state: { from: location.pathname }, replace: true });
  }, [loading, user, isPublic, location.pathname, navigate]);

  // Never render protected content while the session is resolving, or during
  // the redirect above — otherwise the app shell flashes for signed-out users.
  if (loading || (!user && !isPublic)) {
    return (
      <div className="flex items-center justify-center min-h-screen" role="status">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary" />
        <span className="sr-only">Checking your session…</span>
      </div>
    );
  }

  return <>{children}</>;
}