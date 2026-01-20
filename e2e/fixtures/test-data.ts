/**
 * Test data for E2E tests
 */

export const TEST_DEAL_MANUAL = {
  name: 'E2E Test Deal - Manual',
  asset_type: 'Multifamily',
  purchase_price: '25000000',
  noi: '1500000',
  asset_address: '123 Test Street',
  asset_city: 'New York',
  asset_state: 'NY',
  gp_name: 'Test GP Partners',
  deal_summary: 'E2E test deal created via manual entry',
};

export const TEST_DEAL_AI_TEXT = `
Deal Memo: 456 Industrial Way Acquisition

Asset Type: Industrial
Location: 456 Industrial Way, Chicago, IL
Purchase Price: $18,500,000
NOI: $1,200,000
Cap Rate: 6.5%

General Partner: Industrial Holdings LLC
Lender: First National Bank

This is a stabilized industrial asset with long-term NNN leases.
The property is 95% occupied with a weighted average lease term of 7.5 years.
`;

// Unique identifier generator for test isolation
export function uniqueDealName(prefix: string = 'E2E'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix} Test ${timestamp}-${random}`;
}
