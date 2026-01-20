import { Page, expect } from '@playwright/test';

/**
 * Base page object with shared utilities
 */
export class BasePage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /**
   * Wait for page to finish loading (network idle)
   */
  async waitForPageLoad() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Wait for a toast notification with specific text
   */
  async waitForToast(text: string, timeout = 5000) {
    await expect(this.page.getByText(text)).toBeVisible({ timeout });
  }

  /**
   * Navigate to a page by name
   */
  async navigateTo(pageName: string) {
    await this.page.goto(`/${pageName}`);
    await this.waitForPageLoad();
  }

  /**
   * Get current URL
   */
  getCurrentUrl(): string {
    return this.page.url();
  }

  /**
   * Extract query parameter from current URL
   */
  getQueryParam(param: string): string | null {
    const url = new URL(this.page.url());
    return url.searchParams.get(param);
  }
}
