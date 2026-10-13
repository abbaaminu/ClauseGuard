/**
 * Route table metadata.
 *
 * The rendered route tree lives in `src/App.tsx`; this module is the single
 * source of truth for *which* paths exist and which of them are reachable
 * without a session, so `RouteGuard` can never drift out of sync with the
 * router. Keep it in sync when adding or renaming a route.
 */
export interface RouteConfig {
  name: string;
  path: string;
  /** Reachable while signed out. Everything else requires a session. */
  public?: boolean;
  /** Surfaced in primary navigation (see `AppLayout`). */
  visible?: boolean;
}

export const routes: RouteConfig[] = [
  // Public routes
  { name: 'Login', path: '/login', public: true },
  { name: 'Register', path: '/register', public: true },
  // Root redirect
  { name: 'Home', path: '/', public: true },
  // Authenticated routes (rendered inside AppLayout's <Outlet />)
  { name: 'Dashboard', path: '/dashboard', visible: true },
  { name: 'Contract Workspace', path: '/contracts/:id', visible: false },
  { name: 'Playbooks', path: '/playbooks', visible: true },
  { name: 'Plans & usage', path: '/billing', visible: true },
];

/**
 * Paths that stay reachable for signed-out visitors, derived from the
 * `public: true` entries above. `*` may be used as a glob suffix (e.g.
 * `/reset-password/*`) so future public sections only need a metadata entry.
 *
 * Note: the `*` catch-all route (see `src/App.tsx`) is intentionally *not*
 * public, so unknown URLs redirect signed-out visitors to sign-in.
 */
export const PUBLIC_ROUTE_PATHS: readonly string[] = routes
  .filter((route) => route.public)
  .map((route) => route.path);
