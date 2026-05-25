import { test, expect } from '@playwright/test';

test('user can create client and sees it in list', async ({ page }) => {
  await page.goto('/clients/create');
  await page.getByLabel(/name/i).fill('Acme QA Client');
  await page.getByRole('button', { name: /save|create/i }).click();

  await expect(page).toHaveURL(/\/clients(\/|$)/);
  await expect(page.locator('main, [role="main"], body')).toContainText('Acme QA Client');
});
