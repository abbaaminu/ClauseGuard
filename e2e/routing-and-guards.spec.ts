import { test, expect } from '@playwright/test';
import { routes } from '../src/routes';

// Routing, guard and accessibility behaviour for signed-out visitors. These
// run without credentials: they pin the redirect rules implemented in
// src/components/common/RouteGuard.tsx (driven by PUBLIC_ROUTE_PATHS in
// src/routes.tsx) and the accessible names of the login form controls.

// The first page load of the production bundle can be slow on a cold
// `vite preview` (large pdfjs/editor chunks), so allow more than the default
// 5s before failing a redirect assertion.
const REDIRECT_TIMEOUT = { timeout: 15_000 };

// Derived from the metadata table, so declaring a route without protecting it
// (or dropping it from PUBLIC_ROUTE_PATHS) fails here instead of shipping.
const guardedPaths = routes
  .filter((route) => !route.public && !route.path.includes(':'))
  .map((route) => route.path);

test.describe('Routing and auth guards (signed out)', () => {
  for (const path of guardedPaths) {
    test(`redirects the declared protected route ${path} to the sign-in page`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/, REDIRECT_TIMEOUT);
      await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    });
  }

  test('redirects unknown routes to the sign-in page instead of rendering the app shell', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveURL(/\/login$/, REDIRECT_TIMEOUT);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('exposes the password visibility toggle as an accessible button', async ({ page }) => {
    await page.goto('/login');

    const password = page.getByLabel('Password', { exact: true });
    await expect(password).toHaveAttribute('type', 'password');

    const showPassword = page.getByRole('button', { name: 'Show password' });
    await expect(showPassword).toHaveAttribute('aria-pressed', 'false');
    await showPassword.click();

    const hidePassword = page.getByRole('button', { name: 'Hide password' });
    await expect(hidePassword).toHaveAttribute('aria-pressed', 'true');
    await expect(password).toHaveAttribute('type', 'text');
  });
});
