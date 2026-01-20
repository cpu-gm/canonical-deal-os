import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Deal Overview page
 */
export class DealOverviewPage extends BasePage {
  // Header elements
  readonly dealName: Locator;

  // Key metrics
  readonly purchasePriceCard: Locator;
  readonly noiCard: Locator;
  readonly ltvCard: Locator;
  readonly dscrCard: Locator;

  // Sections
  readonly capitalStackSection: Locator;
  readonly dataTrustSection: Locator;
  readonly underwritingSection: Locator;
  readonly verificationQueueSection: Locator;
  readonly documentFactorySection: Locator;

  // Action buttons
  readonly smartUploadButton: Locator;

  constructor(page: Page) {
    super(page);

    // Header
    this.dealName = page.locator('h1').first();

    // Key metrics cards (identified by label text)
    this.purchasePriceCard = page.getByText('Purchase Price').locator('..');
    this.noiCard = page.getByText('NOI').locator('..');
    this.ltvCard = page.getByText('LTV').locator('..');
    this.dscrCard = page.getByText('DSCR').locator('..');

    // Sections
    this.capitalStackSection = page.getByText('Capital Stack').first();
    this.dataTrustSection = page.getByText('Data Trust').first();
    this.underwritingSection = page.getByText('Underwriting Model').first();
    this.verificationQueueSection = page.getByText('Verification Queue').first();
    this.documentFactorySection = page.getByText('Document Factory').first();

    // Buttons
    this.smartUploadButton = page.getByRole('button', { name: /Smart Upload/i });
  }

  /**
   * Navigate to a specific deal's overview page
   */
  async goto(dealId: string) {
    await this.page.goto(`/DealOverview?id=${dealId}`);
    await this.waitForPageLoad();
  }

  /**
   * Verify the deal page loaded with expected name
   */
  async verifyDealLoaded(dealName: string) {
    await expect(this.page.getByText(dealName)).toBeVisible({ timeout: 10000 });
  }

  /**
   * Get the value displayed in a metric card
   */
  async getMetricValue(metric: 'Purchase Price' | 'NOI' | 'LTV' | 'DSCR'): Promise<string> {
    const card = this.page.getByText(metric).locator('..');
    // The value is typically in a <p> tag within the card
    const valueElement = card.locator('p').last();
    const text = await valueElement.textContent();
    return text || '';
  }

  /**
   * Check if a section is visible
   */
  async isSectionVisible(section: 'capitalStack' | 'dataTrust' | 'underwriting' | 'verification' | 'documents'): Promise<boolean> {
    const sectionMap = {
      capitalStack: this.capitalStackSection,
      dataTrust: this.dataTrustSection,
      underwriting: this.underwritingSection,
      verification: this.verificationQueueSection,
      documents: this.documentFactorySection,
    };
    return await sectionMap[section].isVisible();
  }

  /**
   * Open the Smart Upload dialog
   */
  async openSmartUploadDialog() {
    await this.smartUploadButton.click();
    await expect(this.page.getByText(/Smart Document Upload|Upload a document/i)).toBeVisible();
  }

  /**
   * Click on an expandable section to expand/collapse it
   */
  async toggleSection(section: 'underwriting' | 'verification' | 'documents') {
    const sectionMap = {
      underwriting: this.underwritingSection,
      verification: this.verificationQueueSection,
      documents: this.documentFactorySection,
    };
    await sectionMap[section].click();
  }

  /**
   * Check if the deal has a specific lifecycle state badge
   */
  async hasLifecycleState(state: string): Promise<boolean> {
    return await this.page.getByText(state, { exact: false }).first().isVisible();
  }

  /**
   * Get the deal ID from the current URL
   */
  getDealId(): string | null {
    return this.getQueryParam('id');
  }
}
