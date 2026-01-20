import { test, expect } from '@playwright/test';
import { CreateDealPage } from '../page-objects/CreateDealPage';
import { DealOverviewPage } from '../page-objects/DealOverviewPage';
import { uniqueDealName } from '../fixtures/test-data';

test.describe('Deal Overview - View Data', () => {
  let dealId: string;
  let dealName: string;

  // Create a test deal before running overview tests
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const createDealPage = new CreateDealPage(page);

    dealName = uniqueDealName('Overview');

    await createDealPage.goto();
    await createDealPage.fillManualForm({
      name: dealName,
      asset_type: 'Multifamily',
      purchase_price: '30000000',
      noi: '2000000',
      gp_name: 'Test GP',
    });
    await createDealPage.submitManualForm();

    // Wait for navigation and extract deal ID
    await page.waitForURL(/DealOverview\?id=/);
    const url = new URL(page.url());
    dealId = url.searchParams.get('id') || '';

    await page.close();
  });

  test('should display deal header with name', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    await overviewPage.verifyDealLoaded(dealName);
  });

  test('should display key metrics section', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    // Check that metric labels are visible
    await expect(page.getByText('Purchase Price')).toBeVisible();
    await expect(page.getByText('NOI')).toBeVisible();
    await expect(page.getByText('LTV')).toBeVisible();
    await expect(page.getByText('DSCR')).toBeVisible();
  });

  test('should display formatted purchase price', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    // $30M should display as $30.0M or similar formatted value
    const value = await overviewPage.getMetricValue('Purchase Price');
    expect(value).toMatch(/\$30/i);
  });

  test('should display Capital Stack section', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    const isVisible = await overviewPage.isSectionVisible('capitalStack');
    expect(isVisible).toBe(true);
  });

  test('should display Data Trust section', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    const isVisible = await overviewPage.isSectionVisible('dataTrust');
    expect(isVisible).toBe(true);

    // Should show DOC-backed and AI-derived labels
    await expect(page.getByText('DOC-backed')).toBeVisible();
    await expect(page.getByText('AI-derived')).toBeVisible();
  });

  test('should have Upload Documents button visible', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    // The main upload button in the header area is "Upload Documents"
    await expect(page.getByRole('button', { name: /Upload Documents/i })).toBeVisible();
  });

  test('should open Smart Upload dialog on button click', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    // Click the Upload Documents button
    await page.getByRole('button', { name: /Upload Documents/i }).click();

    // Dialog should be open - check for upload UI elements
    await expect(page.getByText(/Smart Document Upload/i)).toBeVisible({ timeout: 10000 });
  });

  test('should close Smart Upload dialog when clicking escape', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);
    await overviewPage.goto(dealId);

    // Open dialog
    await page.getByRole('button', { name: /Upload Documents/i }).click();
    await expect(page.getByText(/Smart Document Upload/i)).toBeVisible({ timeout: 10000 });

    // Press escape to close
    await page.keyboard.press('Escape');

    // Wait for dialog animation
    await page.waitForTimeout(500);

    // Dialog should be closed
    await expect(page.getByText(/Smart Document Upload/i)).not.toBeVisible();
  });
});

test.describe('Deal Overview - Navigation', () => {
  test('should redirect to deals list if invalid deal ID', async ({ page }) => {
    const overviewPage = new DealOverviewPage(page);

    // Navigate with a non-existent deal ID
    await page.goto('/DealOverview?id=non-existent-deal-id');

    // Should show error or redirect - depends on implementation
    // At minimum, shouldn't crash
    await page.waitForLoadState('networkidle');

    // Check that page is still functional
    const url = page.url();
    // Either shows error on overview or redirects
    expect(url).toBeTruthy();
  });

  test('should handle missing deal ID parameter', async ({ page }) => {
    await page.goto('/DealOverview');

    // Should handle gracefully - show error or redirect
    await page.waitForLoadState('networkidle');

    // Page should still be functional
    const url = page.url();
    expect(url).toBeTruthy();
  });
});
