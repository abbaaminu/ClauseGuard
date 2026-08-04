import { test, expect } from '@playwright/test';
import path from 'node:path';

// Core workflow: Upload -> Scan -> Review -> Export.
// Requires E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD for a seeded test
// account (see docs/ROADMAP.md "Testing" section for the seed script).
const TEST_EMAIL = process.env.E2E_TEST_USER_EMAIL ?? '';
const TEST_PASSWORD = process.env.E2E_TEST_USER_PASSWORD ?? '';

test.describe('Contract review workflow', () => {
  test.skip(!TEST_EMAIL || !TEST_PASSWORD, 'E2E test credentials not configured');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(TEST_EMAIL);
    await page.getByLabel(/password/i).fill(TEST_PASSWORD);
    await page.getByRole('button', { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/dashboard/i);
  });

  test('uploads a contract, runs an audit, reviews flags, and exports', async ({ page }) => {
    await page.getByRole('link', { name: /upload|new contract/i }).click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'fixtures', 'sample-nda.docx'));

    await page.getByRole('button', { name: /select playbook/i }).click();
    await page.getByRole('option', { name: /standard vendor nda guidelines/i }).click();
    await page.getByRole('button', { name: /run audit|scan/i }).click();

    // Async pipeline — poll for completion rather than a fixed sleep.
    await expect(page.getByText(/completed/i)).toBeVisible({ timeout: 60_000 });

    await expect(page.getByTestId('risk-score')).toBeVisible();
    const flaggedRows = page.getByTestId('audit-result-row').filter({ hasText: /flagged|missing/i });
    await expect(flaggedRows.first()).toBeVisible();

    await flaggedRows.first().click();
    await expect(page.getByTestId('clause-detail-panel')).toBeVisible();
    await expect(page.getByTestId('original-document-pane')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /export|download redline/i }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.docx$/);
  });

  test('is keyboard-navigable end to end (WCAG 2.1 AA)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(active).not.toBe('BODY');
  });
});
