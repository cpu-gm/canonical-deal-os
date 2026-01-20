import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Page object for the Create Deal page
 */
export class CreateDealPage extends BasePage {
  // Tab elements
  readonly aiTab: Locator;
  readonly manualTab: Locator;

  // AI intake elements
  readonly aiTextarea: Locator;
  readonly parseButton: Locator;

  // Manual entry elements
  readonly dealNameInput: Locator;
  readonly assetTypeSelect: Locator;
  readonly purchasePriceInput: Locator;
  readonly addressInput: Locator;
  readonly cityInput: Locator;
  readonly stateInput: Locator;
  readonly noiInput: Locator;
  readonly gpNameInput: Locator;
  readonly summaryTextarea: Locator;

  constructor(page: Page) {
    super(page);

    // Tabs - using role selectors for reliability
    this.aiTab = page.getByRole('tab', { name: /AI-Assisted/i });
    this.manualTab = page.getByRole('tab', { name: /Manual Entry/i });

    // AI intake
    this.aiTextarea = page.getByPlaceholder(/Paste your deal memo/i);
    this.parseButton = page.getByRole('button', { name: /Parse with AI/i });

    // Manual entry form fields
    this.dealNameInput = page.getByPlaceholder(/123 Main Street/i);
    this.assetTypeSelect = page.locator('[data-state="active"]').getByRole('combobox');
    this.purchasePriceInput = page.locator('[data-state="active"]').getByPlaceholder(/25,000,000/i);
    this.addressInput = page.locator('[data-state="active"]').getByPlaceholder(/Street address/i);
    this.cityInput = page.locator('[data-state="active"] input').nth(4); // City input by position
    this.stateInput = page.locator('[data-state="active"]').getByPlaceholder(/e.g., CA/i);
    this.noiInput = page.locator('[data-state="active"]').getByPlaceholder(/Net Operating Income/i);
    this.gpNameInput = page.locator('[data-state="active"]').getByPlaceholder(/General Partner/i);
    this.summaryTextarea = page.locator('[data-state="active"]').getByPlaceholder(/Brief description/i);
  }

  /**
   * Navigate to Create Deal page
   */
  async goto() {
    await this.page.goto('/CreateDeal');
    await this.waitForPageLoad();
    await expect(this.page.getByRole('heading', { name: 'Create Deal' })).toBeVisible();
  }

  /**
   * Switch to Manual Entry tab
   */
  async selectManualTab() {
    await this.manualTab.click();
    await expect(this.manualTab).toHaveAttribute('data-state', 'active');
  }

  /**
   * Switch to AI-Assisted tab
   */
  async selectAITab() {
    await this.aiTab.click();
    await expect(this.aiTab).toHaveAttribute('data-state', 'active');
  }

  /**
   * Fill the manual entry form
   */
  async fillManualForm(data: {
    name: string;
    asset_type?: string;
    purchase_price?: string;
    asset_address?: string;
    asset_city?: string;
    asset_state?: string;
    noi?: string;
    gp_name?: string;
    deal_summary?: string;
  }) {
    await this.selectManualTab();

    // Deal name is required
    await this.dealNameInput.fill(data.name);

    if (data.asset_type) {
      await this.assetTypeSelect.click();
      await this.page.getByRole('option', { name: data.asset_type }).click();
    }

    if (data.purchase_price) {
      await this.purchasePriceInput.click();
      await this.purchasePriceInput.fill(data.purchase_price);
    }

    if (data.asset_address) {
      await this.addressInput.fill(data.asset_address);
    }

    if (data.asset_city) {
      await this.cityInput.fill(data.asset_city);
    }

    if (data.asset_state) {
      await this.stateInput.fill(data.asset_state);
    }

    if (data.noi) {
      await this.noiInput.click();
      await this.noiInput.fill(data.noi);
    }

    if (data.gp_name) {
      await this.gpNameInput.fill(data.gp_name);
    }

    if (data.deal_summary) {
      await this.summaryTextarea.fill(data.deal_summary);
    }
  }

  /**
   * Submit the manual entry form
   */
  async submitManualForm() {
    const createButton = this.page.locator('[data-state="active"]').getByRole('button', { name: /Create Deal/i });
    await createButton.click();
  }

  /**
   * Enter text in AI textarea and parse it
   */
  async parseAIInput(text: string) {
    await this.selectAITab();
    await this.aiTextarea.fill(text);
    await this.parseButton.click();

    // Wait for parsing to start (button shows "Parsing...")
    await expect(this.page.getByText(/Parsing/i)).toBeVisible();

    // Wait for parsing to complete - either shows review section or error
    await this.page.waitForSelector('text=AI-Derived, text=error, text=failed', { timeout: 60000 });
  }

  /**
   * Submit the AI-parsed deal
   */
  async submitAIForm() {
    // The Create Deal button in the parsed result section
    const createButton = this.page.locator('.bg-\\[\\#FAFAFA\\]').getByRole('button', { name: /Create Deal/i });
    await createButton.click();
  }

  /**
   * Get the Create Deal button's disabled state (manual tab)
   */
  async isManualCreateButtonDisabled(): Promise<boolean> {
    const button = this.page.locator('[data-state="active"]').getByRole('button', { name: /Create Deal/i });
    return await button.isDisabled();
  }
}
