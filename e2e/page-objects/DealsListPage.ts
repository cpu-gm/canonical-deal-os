import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Deals List page
 */
export class DealsListPage extends BasePage {
  readonly pageTitle: Locator;
  readonly searchInput: Locator;
  readonly dealCards: Locator;
  readonly createDealLink: Locator;
  readonly emptyState: Locator;
  readonly loadingState: Locator;

  constructor(page: Page) {
    super(page);

    this.pageTitle = page.getByRole('heading', { name: 'Deals' });
    this.searchInput = page.getByPlaceholder(/Search deals/i);
    this.dealCards = page.locator('a[href*="DealOverview"]');
    // Specifically target the Create Deal link in the main content (empty state), not navigation
    this.createDealLink = page.getByRole('main').getByRole('link', { name: /Create Deal/i });
    this.emptyState = page.getByText(/No deals found/i);
    this.loadingState = page.locator('.animate-pulse');
  }

  /**
   * Navigate to the Deals list page
   */
  async goto() {
    await this.page.goto('/Deals');
    await this.waitForPageLoad();
    await expect(this.pageTitle).toBeVisible();
  }

  /**
   * Search for deals by query
   */
  async search(query: string) {
    await this.searchInput.fill(query);
    // Wait for filter to apply (debounced)
    await this.page.waitForTimeout(300);
  }

  /**
   * Clear the search input
   */
  async clearSearch() {
    await this.searchInput.clear();
    await this.page.waitForTimeout(300);
  }

  /**
   * Get the number of deal cards displayed
   */
  async getDealCount(): Promise<number> {
    return await this.dealCards.count();
  }

  /**
   * Click on a deal card by deal name
   */
  async clickDealByName(dealName: string) {
    await this.page.getByText(dealName).click();
    await this.page.waitForURL(/DealOverview/);
  }

  /**
   * Check if a deal is visible in the list
   */
  async isDealVisible(dealName: string): Promise<boolean> {
    return await this.page.getByText(dealName).isVisible();
  }

  /**
   * Check if the empty state is displayed
   */
  async isEmptyStateVisible(): Promise<boolean> {
    return await this.emptyState.isVisible();
  }

  /**
   * Check if loading state is displayed
   */
  async isLoading(): Promise<boolean> {
    return await this.loadingState.first().isVisible();
  }

  /**
   * Wait for deals to load (loading state disappears)
   */
  async waitForDealsLoaded() {
    await this.page.waitForSelector('.animate-pulse', { state: 'hidden', timeout: 10000 }).catch(() => {
      // Loading state might not appear if data loads quickly
    });
  }

  /**
   * Get all visible deal names
   */
  async getVisibleDealNames(): Promise<string[]> {
    const names: string[] = [];
    const cards = await this.dealCards.all();
    for (const card of cards) {
      const nameElement = card.locator('h3');
      const name = await nameElement.textContent();
      if (name) names.push(name.trim());
    }
    return names;
  }
}
