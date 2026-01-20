import { test, expect } from '@playwright/test';
import { DealsListPage } from '../page-objects/DealsListPage';
import { CreateDealPage } from '../page-objects/CreateDealPage';
import { uniqueDealName } from '../fixtures/test-data';

test.describe('Deals List - View', () => {
  test('should display deals list page', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();

    await expect(dealsListPage.pageTitle).toBeVisible();
    await expect(dealsListPage.searchInput).toBeVisible();
  });

  test('should have search input with placeholder', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();

    await expect(dealsListPage.searchInput).toHaveAttribute('placeholder', /Search deals/i);
  });

  test('should show loading state initially', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);

    // Navigate but don't wait for network idle
    await page.goto('/Deals');

    // Loading state might appear briefly
    // This test just ensures the page loads without errors
    await dealsListPage.waitForDealsLoaded();
  });
});

test.describe('Deals List - Search', () => {
  const testDeals: { name: string; id: string }[] = [];

  // Create test deals for search testing
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    const createDealPage = new CreateDealPage(page);

    const dealNames = [
      uniqueDealName('SearchAlpha'),
      uniqueDealName('SearchBeta'),
      uniqueDealName('SearchGamma'),
    ];

    for (const name of dealNames) {
      await createDealPage.goto();
      await createDealPage.fillManualForm({
        name,
        asset_type: 'Multifamily',
        purchase_price: '10000000',
      });
      await createDealPage.submitManualForm();

      // Wait for navigation and extract deal ID
      await page.waitForURL(/DealOverview\?id=/);
      const url = new URL(page.url());
      const id = url.searchParams.get('id') || '';
      testDeals.push({ name, id });
    }

    await page.close();
  });

  test('should filter deals by search query', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();
    await dealsListPage.waitForDealsLoaded();

    // Search for the first test deal (contains "Alpha")
    await dealsListPage.search('SearchAlpha');

    // Should find the Alpha deal
    const isAlphaVisible = await dealsListPage.isDealVisible(testDeals[0].name);
    expect(isAlphaVisible).toBe(true);

    // Other deals should not be visible
    const isBetaVisible = await page.getByText(testDeals[1].name).isVisible().catch(() => false);
    expect(isBetaVisible).toBe(false);
  });

  test('should clear search and show all deals', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();
    await dealsListPage.waitForDealsLoaded();

    // Search then clear
    await dealsListPage.search('SearchAlpha');
    await dealsListPage.clearSearch();

    // All test deals should be visible again
    for (const deal of testDeals) {
      const isVisible = await dealsListPage.isDealVisible(deal.name);
      expect(isVisible).toBe(true);
    }
  });

  test('should show empty state for non-matching search', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();
    await dealsListPage.waitForDealsLoaded();

    // Search for something that doesn't exist
    await dealsListPage.search('ZZZZNONEXISTENT12345');

    const isEmpty = await dealsListPage.isEmptyStateVisible();
    expect(isEmpty).toBe(true);
  });

  test('should navigate to deal overview on card click', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();
    await dealsListPage.waitForDealsLoaded();

    // Click on the first test deal
    await dealsListPage.clickDealByName(testDeals[0].name);

    // Should be on the deal overview page
    expect(page.url()).toContain('DealOverview');
    expect(page.url()).toContain(`id=${testDeals[0].id}`);

    // Deal name should be visible on overview
    await expect(page.getByText(testDeals[0].name)).toBeVisible();
  });
});

test.describe('Deals List - Empty State', () => {
  test('should show create deal link in empty state', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();
    await dealsListPage.waitForDealsLoaded();

    // Search for something non-existent to trigger empty state
    await dealsListPage.search('ZZZZNONEXISTENT12345');

    // Empty state should have a link to create deal
    await expect(dealsListPage.createDealLink).toBeVisible();
  });

  test('should navigate to create deal from empty state', async ({ page }) => {
    const dealsListPage = new DealsListPage(page);
    await dealsListPage.goto();
    await dealsListPage.waitForDealsLoaded();

    // Trigger empty state
    await dealsListPage.search('ZZZZNONEXISTENT12345');

    // Click create deal link
    await dealsListPage.createDealLink.click();

    // Should navigate to create deal page
    await page.waitForURL(/CreateDeal/);
    await expect(page.getByRole('heading', { name: 'Create Deal' })).toBeVisible();
  });
});
