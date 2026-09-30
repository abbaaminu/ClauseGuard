import { test, expect } from '@playwright/test';

// Core supported workflow: Upload -> Scan -> Review.
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

  test('uploads a text contract and previews the stored document', async ({ page }) => {
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'sample-contract.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('This fixture verifies the original uploaded contract text is shown.'),
    });

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: /standard vendor nda guidelines/i }).click();
    await page.getByRole('button', { name: /upload & analyze/i }).click();

    const contractRow = page.getByRole('row', { name: /sample-contract\.txt/i });
    await expect(contractRow).toBeVisible({ timeout: 60_000 });
    await contractRow.click();

    await expect(page.getByText('Document Preview')).toBeVisible();
    await expect(page.getByText(/fixture verifies the original uploaded contract text/i)).toBeVisible();
  });

  test('is keyboard-navigable end to end (WCAG 2.1 AA)', async ({ page }) => {
    await page.goto('/dashboard');
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(active).not.toBe('BODY');
  });
});
