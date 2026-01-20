import { test, expect } from '@playwright/test';
import { CreateDealPage } from '../page-objects/CreateDealPage';
import { TEST_DEAL_MANUAL, TEST_DEAL_AI_TEXT, uniqueDealName } from '../fixtures/test-data';

test.describe('Create Deal - Manual Entry', () => {
  let createDealPage: CreateDealPage;

  test.beforeEach(async ({ page }) => {
    createDealPage = new CreateDealPage(page);
    await createDealPage.goto();
  });

  test('should display create deal form with both tabs', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Create Deal' })).toBeVisible();
    await expect(page.getByText('AI-Assisted Intake')).toBeVisible();
    await expect(page.getByText('Manual Entry')).toBeVisible();
  });

  test('should start with AI tab selected by default', async ({ page }) => {
    const aiTab = page.getByRole('tab', { name: /AI-Assisted/i });
    await expect(aiTab).toHaveAttribute('data-state', 'active');
  });

  test('should switch to manual tab', async () => {
    await createDealPage.selectManualTab();
    await expect(createDealPage.manualTab).toHaveAttribute('data-state', 'active');
    await expect(createDealPage.dealNameInput).toBeVisible();
  });

  test('should have create button disabled when name is empty', async () => {
    await createDealPage.selectManualTab();
    const isDisabled = await createDealPage.isManualCreateButtonDisabled();
    expect(isDisabled).toBe(true);
  });

  test('should enable create button when name is filled', async ({ page }) => {
    await createDealPage.selectManualTab();
    await createDealPage.dealNameInput.fill('Test Deal Name');

    const createButton = page.locator('[data-state="active"]').getByRole('button', { name: /Create Deal/i });
    await expect(createButton).toBeEnabled();
  });

  test('should create deal via manual entry and navigate to overview', async ({ page }) => {
    const dealName = uniqueDealName('Manual');

    await createDealPage.fillManualForm({
      name: dealName,
      asset_type: TEST_DEAL_MANUAL.asset_type,
      purchase_price: TEST_DEAL_MANUAL.purchase_price,
      asset_address: TEST_DEAL_MANUAL.asset_address,
      asset_state: TEST_DEAL_MANUAL.asset_state,
    });

    await createDealPage.submitManualForm();

    // Should navigate to Deal Overview
    await page.waitForURL(/DealOverview\?id=/, { timeout: 10000 });

    // Verify deal name is shown
    await expect(page.getByText(dealName)).toBeVisible();
  });

  test('should display asset type dropdown with options', async ({ page }) => {
    await createDealPage.selectManualTab();

    // Click the select trigger
    await createDealPage.assetTypeSelect.click();

    // Verify options are visible
    await expect(page.getByRole('option', { name: 'Multifamily' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Office' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Industrial' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Retail' })).toBeVisible();
  });
});

test.describe('Create Deal - AI Assisted', () => {
  let createDealPage: CreateDealPage;

  test.beforeEach(async ({ page }) => {
    createDealPage = new CreateDealPage(page);
    await createDealPage.goto();
  });

  test('should display AI textarea with placeholder', async ({ page }) => {
    await expect(createDealPage.aiTextarea).toBeVisible();
    await expect(createDealPage.aiTextarea).toHaveAttribute('placeholder', /Paste your deal memo/i);
  });

  test('should disable parse button when textarea is empty', async ({ page }) => {
    await expect(createDealPage.parseButton).toBeDisabled();
  });

  test('should enable parse button when text is entered', async ({ page }) => {
    await createDealPage.aiTextarea.fill('Some deal text');
    await expect(createDealPage.parseButton).toBeEnabled();
  });

  // This test requires the AI/LLM service to be running
  test.skip('should parse deal text and show extracted fields', async ({ page }) => {
    await createDealPage.aiTextarea.fill(TEST_DEAL_AI_TEXT);
    await createDealPage.parseButton.click();

    // Wait for parsing
    await expect(page.getByText(/Parsing/i)).toBeVisible();

    // Wait for result - either success or validation warning
    await page.waitForSelector('text=AI-Derived', { timeout: 60000 });

    // Should show the extracted asset type
    await expect(page.getByText('Industrial')).toBeVisible();
  });
});
