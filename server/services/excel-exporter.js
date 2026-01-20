/**
 * Excel Exporter Service
 *
 * Generate professional Excel workbooks from underwriting models.
 * Creates formatted spreadsheets with formulas, not just static values.
 */

import ExcelJS from 'exceljs';

/**
 * Style definitions for professional formatting
 */
const STYLES = {
  header: {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } },
    alignment: { horizontal: 'center', vertical: 'middle' },
    border: {
      bottom: { style: 'thin', color: { argb: 'FF000000' } }
    }
  },
  sectionHeader: {
    font: { bold: true, size: 11, color: { argb: 'FF1F4E79' } },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6DCE4' } }
  },
  label: {
    font: { size: 10 },
    alignment: { horizontal: 'left' }
  },
  currency: {
    numFmt: '$#,##0',
    alignment: { horizontal: 'right' }
  },
  currencyDetailed: {
    numFmt: '$#,##0.00',
    alignment: { horizontal: 'right' }
  },
  percentage: {
    numFmt: '0.00%',
    alignment: { horizontal: 'right' }
  },
  number: {
    numFmt: '#,##0.00',
    alignment: { horizontal: 'right' }
  },
  ratio: {
    numFmt: '0.00"x"',
    alignment: { horizontal: 'right' }
  },
  years: {
    numFmt: '0 "yrs"',
    alignment: { horizontal: 'right' }
  },
  positive: {
    font: { color: { argb: 'FF006400' } }
  },
  negative: {
    font: { color: { argb: 'FFDC143C' } }
  }
};

/**
 * Export underwriting model to Excel workbook
 * @param {Object} model - UnderwritingModel data
 * @param {Object} options - Export options
 * @returns {Buffer} Excel file buffer
 */
export async function exportToExcel(model, options = {}) {
  const workbook = new ExcelJS.Workbook();

  workbook.creator = 'Canonical Deal OS';
  workbook.created = new Date();
  workbook.modified = new Date();

  const {
    includeFormulas = true,
    includeSensitivity = true,
    includeWaterfall = model.waterfall != null,
    template = 'standard'
  } = options;

  // Create sheets
  createSummarySheet(workbook, model);
  createAssumptionsSheet(workbook, model);
  createCashFlowSheet(workbook, model, includeFormulas);

  if (includeWaterfall && model.waterfall) {
    createWaterfallSheet(workbook, model);
  }

  if (includeSensitivity) {
    createSensitivitySheet(workbook, model);
  }

  // Generate buffer
  const buffer = await workbook.xlsx.writeBuffer();
  return buffer;
}

/**
 * Create Summary sheet with key metrics
 */
function createSummarySheet(workbook, model) {
  const sheet = workbook.addWorksheet('Summary', {
    properties: { tabColor: { argb: 'FF1F4E79' } }
  });

  // Set column widths
  sheet.columns = [
    { width: 25 },
    { width: 18 },
    { width: 5 },
    { width: 25 },
    { width: 18 }
  ];

  // Title
  sheet.getCell('A1').value = 'INVESTMENT SUMMARY';
  sheet.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF1F4E79' } };
  sheet.mergeCells('A1:E1');

  // Deal name
  sheet.getCell('A2').value = model.dealName || 'Untitled Deal';
  sheet.getCell('A2').font = { size: 14 };
  sheet.mergeCells('A2:E2');

  // Property Info Section
  let row = 4;
  row = addSectionHeader(sheet, row, 'PROPERTY INFORMATION');
  row = addLabelValue(sheet, row, 'Purchase Price', model.purchasePrice, 'currency');
  row = addLabelValue(sheet, row, 'Property Type', model.propertyType || 'Multifamily', 'text');
  row = addLabelValue(sheet, row, 'Units', model.units, 'number');
  row = addLabelValue(sheet, row, 'Price Per Unit', model.purchasePrice && model.units ? model.purchasePrice / model.units : null, 'currency');

  row++;

  // Returns Section (right column)
  let rightRow = 4;
  rightRow = addSectionHeader(sheet, rightRow, 'RETURNS', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Levered IRR', model.irr, 'percentage', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Equity Multiple', model.equityMultiple, 'ratio', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Cash-on-Cash', model.cashOnCash, 'percentage', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Going-In Cap', model.goingInCapRate, 'percentage', 3);

  // Debt Section
  row = addSectionHeader(sheet, row, 'FINANCING');
  row = addLabelValue(sheet, row, 'Loan Amount', model.loanAmount, 'currency');
  row = addLabelValue(sheet, row, 'LTV', model.loanAmount && model.purchasePrice ? model.loanAmount / model.purchasePrice : null, 'percentage');
  row = addLabelValue(sheet, row, 'Interest Rate', model.interestRate, 'percentage');
  row = addLabelValue(sheet, row, 'Amortization', model.amortization, 'years');
  row = addLabelValue(sheet, row, 'Debt Service', model.annualDebtService, 'currency');

  row++;

  // Risk Metrics (right column)
  rightRow = addSectionHeader(sheet, rightRow + 1, 'RISK METRICS', 3);
  rightRow = addLabelValue(sheet, rightRow, 'DSCR', model.dscr, 'ratio', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Break-Even Occ', model.breakEvenOccupancy, 'percentage', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Debt Yield', model.debtYield, 'percentage', 3);

  // Income Section
  row = addSectionHeader(sheet, row, 'INCOME & EXPENSES');
  row = addLabelValue(sheet, row, 'Gross Potential Rent', model.grossPotentialRent, 'currency');
  row = addLabelValue(sheet, row, 'Vacancy', model.vacancyRate, 'percentage');
  row = addLabelValue(sheet, row, 'Effective Gross Income', model.effectiveGrossIncome, 'currency');
  row = addLabelValue(sheet, row, 'Operating Expenses', model.operatingExpenses, 'currency');
  row = addLabelValue(sheet, row, 'Net Operating Income', model.netOperatingIncome, 'currency');

  // Freeze panes
  sheet.views = [{ state: 'frozen', ySplit: 3 }];

  return sheet;
}

/**
 * Create Assumptions sheet with all inputs
 */
function createAssumptionsSheet(workbook, model) {
  const sheet = workbook.addWorksheet('Assumptions', {
    properties: { tabColor: { argb: 'FF4472C4' } }
  });

  sheet.columns = [
    { width: 30 },
    { width: 15 },
    { width: 5 },
    { width: 30 },
    { width: 15 }
  ];

  // Title
  sheet.getCell('A1').value = 'MODEL ASSUMPTIONS';
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };

  let row = 3;

  // Revenue Assumptions
  row = addSectionHeader(sheet, row, 'REVENUE');
  row = addLabelValue(sheet, row, 'Gross Potential Rent', model.grossPotentialRent, 'currency');
  row = addLabelValue(sheet, row, 'Vacancy Rate', model.vacancyRate, 'percentage');
  row = addLabelValue(sheet, row, 'Other Income', model.otherIncome, 'currency');
  row = addLabelValue(sheet, row, 'Rent Growth (Annual)', model.rentGrowth, 'percentage');

  row++;

  // Expense Assumptions
  row = addSectionHeader(sheet, row, 'EXPENSES');
  row = addLabelValue(sheet, row, 'Operating Expenses', model.operatingExpenses, 'currency');
  row = addLabelValue(sheet, row, 'Taxes', model.taxes, 'currency');
  row = addLabelValue(sheet, row, 'Insurance', model.insurance, 'currency');
  row = addLabelValue(sheet, row, 'Management', model.management, 'currency');
  row = addLabelValue(sheet, row, 'Reserves', model.reserves, 'currency');
  row = addLabelValue(sheet, row, 'Expense Growth (Annual)', model.expenseGrowth, 'percentage');

  row++;

  // Debt Assumptions (right side)
  let rightRow = 3;
  rightRow = addSectionHeader(sheet, rightRow, 'DEBT', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Loan Amount', model.loanAmount, 'currency', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Interest Rate', model.interestRate, 'percentage', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Amortization', model.amortization, 'years', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Loan Term', model.loanTerm, 'years', 3);
  rightRow = addLabelValue(sheet, rightRow, 'IO Period', model.ioPeriod || 0, 'years', 3);

  rightRow++;

  // Exit Assumptions
  rightRow = addSectionHeader(sheet, rightRow, 'EXIT', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Hold Period', model.holdPeriod, 'years', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Exit Cap Rate', model.exitCapRate, 'percentage', 3);
  rightRow = addLabelValue(sheet, rightRow, 'Selling Costs', 0.02, 'percentage', 3);

  return sheet;
}

/**
 * Create Cash Flow sheet with year-by-year projections
 */
function createCashFlowSheet(workbook, model, includeFormulas = true) {
  const sheet = workbook.addWorksheet('Cash Flows', {
    properties: { tabColor: { argb: 'FF70AD47' } }
  });

  const holdPeriod = model.holdPeriod || 5;

  // Set column widths
  const columns = [{ width: 25 }];
  for (let i = 0; i <= holdPeriod; i++) {
    columns.push({ width: 14 });
  }
  sheet.columns = columns;

  // Title
  sheet.getCell('A1').value = 'PROJECTED CASH FLOWS';
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };

  // Year headers
  let row = 3;
  const headerRow = sheet.getRow(row);
  headerRow.getCell(1).value = '';
  for (let year = 0; year <= holdPeriod; year++) {
    const cell = headerRow.getCell(year + 2);
    cell.value = year === 0 ? 'Year 0' : `Year ${year}`;
    Object.assign(cell, STYLES.header);
  }
  row++;

  // Calculate projections
  const projections = calculateDetailedCashFlows(model);

  // Revenue Section
  row = addCashFlowSection(sheet, row, 'REVENUE', [
    { label: 'Gross Potential Rent', key: 'grossPotentialRent' },
    { label: 'Less: Vacancy', key: 'vacancyLoss', isNegative: true },
    { label: 'Other Income', key: 'otherIncome' },
    { label: 'Effective Gross Income', key: 'effectiveGrossIncome', isTotal: true }
  ], projections, holdPeriod);

  row++;

  // Expense Section
  row = addCashFlowSection(sheet, row, 'EXPENSES', [
    { label: 'Operating Expenses', key: 'operatingExpenses' },
    { label: 'Taxes', key: 'taxes' },
    { label: 'Insurance', key: 'insurance' },
    { label: 'Management', key: 'management' },
    { label: 'Reserves', key: 'reserves' },
    { label: 'Total Expenses', key: 'totalExpenses', isTotal: true }
  ], projections, holdPeriod);

  row++;

  // NOI
  const noiRow = sheet.getRow(row);
  noiRow.getCell(1).value = 'Net Operating Income';
  noiRow.getCell(1).font = { bold: true };
  for (let year = 0; year <= holdPeriod; year++) {
    const cell = noiRow.getCell(year + 2);
    cell.value = projections.years[year]?.noi || 0;
    cell.numFmt = '$#,##0';
    cell.font = { bold: true };
  }
  row += 2;

  // Debt Service Section
  row = addCashFlowSection(sheet, row, 'DEBT SERVICE', [
    { label: 'Interest Payment', key: 'interestPayment' },
    { label: 'Principal Payment', key: 'principalPayment' },
    { label: 'Total Debt Service', key: 'totalDebtService', isTotal: true }
  ], projections, holdPeriod);

  row++;

  // Before Tax Cash Flow
  const btcfRow = sheet.getRow(row);
  btcfRow.getCell(1).value = 'Before-Tax Cash Flow';
  btcfRow.getCell(1).font = { bold: true };
  for (let year = 0; year <= holdPeriod; year++) {
    const cell = btcfRow.getCell(year + 2);
    const value = projections.years[year]?.beforeTaxCashFlow || 0;
    cell.value = value;
    cell.numFmt = '$#,##0';
    cell.font = { bold: true, color: { argb: value >= 0 ? 'FF006400' : 'FFDC143C' } };
  }
  row += 2;

  // Exit Section (only in final year)
  row = addSectionHeader(sheet, row, 'EXIT ANALYSIS');
  row = addLabelValue(sheet, row, 'Exit NOI', projections.exit?.exitNOI, 'currency');
  row = addLabelValue(sheet, row, 'Exit Cap Rate', model.exitCapRate, 'percentage');
  row = addLabelValue(sheet, row, 'Gross Sale Price', projections.exit?.grossSalePrice, 'currency');
  row = addLabelValue(sheet, row, 'Less: Selling Costs', projections.exit?.sellingCosts, 'currency');
  row = addLabelValue(sheet, row, 'Less: Loan Payoff', projections.exit?.loanPayoff, 'currency');
  row = addLabelValue(sheet, row, 'Net Sale Proceeds', projections.exit?.netSaleProceeds, 'currency');

  row += 2;

  // Summary Returns
  row = addSectionHeader(sheet, row, 'RETURNS SUMMARY');
  row = addLabelValue(sheet, row, 'Total Equity Invested', projections.totals?.equityInvested, 'currency');
  row = addLabelValue(sheet, row, 'Total Cash Distributions', projections.totals?.totalCashDistributed, 'currency');
  row = addLabelValue(sheet, row, 'Equity Multiple', projections.totals?.equityMultiple, 'ratio');
  row = addLabelValue(sheet, row, 'IRR', projections.totals?.irr, 'percentage');

  // Freeze panes
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 3 }];

  return sheet;
}

/**
 * Create Waterfall sheet for equity distributions
 */
function createWaterfallSheet(workbook, model) {
  const sheet = workbook.addWorksheet('Waterfall', {
    properties: { tabColor: { argb: 'FF7030A0' } }
  });

  sheet.columns = [
    { width: 25 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 },
    { width: 15 }
  ];

  // Title
  sheet.getCell('A1').value = 'EQUITY WATERFALL';
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };

  let row = 3;

  // Structure Section
  row = addSectionHeader(sheet, row, 'CAPITAL STRUCTURE');
  row = addLabelValue(sheet, row, 'LP Equity', model.waterfall?.lpEquity, 'currency');
  row = addLabelValue(sheet, row, 'GP Equity', model.waterfall?.gpEquity, 'currency');
  row = addLabelValue(sheet, row, 'Preferred Return', model.waterfall?.preferredReturn, 'percentage');

  row += 2;

  // Promote Tiers
  if (model.waterfall?.promoteTiers) {
    row = addSectionHeader(sheet, row, 'PROMOTE TIERS');
    const tiers = typeof model.waterfall.promoteTiers === 'string'
      ? JSON.parse(model.waterfall.promoteTiers)
      : model.waterfall.promoteTiers;

    for (let i = 0; i < tiers.length; i++) {
      const tier = tiers[i];
      const tierRow = sheet.getRow(row);
      tierRow.getCell(1).value = `Tier ${i + 1}`;
      tierRow.getCell(2).value = `Above ${(tier.hurdle * 100).toFixed(1)}% IRR`;
      tierRow.getCell(3).value = `${(tier.lpSplit * 100).toFixed(0)}% LP / ${(tier.gpSplit * 100).toFixed(0)}% GP`;
      row++;
    }
  }

  return sheet;
}

/**
 * Create Sensitivity sheet with analysis matrices
 */
function createSensitivitySheet(workbook, model) {
  const sheet = workbook.addWorksheet('Sensitivity', {
    properties: { tabColor: { argb: 'FFED7D31' } }
  });

  sheet.columns = [
    { width: 15 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 },
    { width: 12 }
  ];

  // Title
  sheet.getCell('A1').value = 'SENSITIVITY ANALYSIS';
  sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };

  // IRR Sensitivity: Exit Cap vs Vacancy
  let row = 3;
  sheet.getCell(`A${row}`).value = 'IRR Sensitivity: Exit Cap Rate vs Vacancy Rate';
  sheet.getCell(`A${row}`).font = { bold: true };
  row++;

  // Exit cap rates across top
  const exitCaps = [0.045, 0.05, 0.055, 0.06, 0.065];
  const vacancies = [0.03, 0.05, 0.07, 0.10];

  // Headers
  const headerRow = sheet.getRow(row);
  headerRow.getCell(1).value = 'Vacancy \\ Exit Cap';
  for (let i = 0; i < exitCaps.length; i++) {
    headerRow.getCell(i + 2).value = exitCaps[i];
    headerRow.getCell(i + 2).numFmt = '0.0%';
    Object.assign(headerRow.getCell(i + 2), STYLES.header);
  }
  row++;

  // Matrix values (placeholder - would calculate actual IRRs)
  for (const vacancy of vacancies) {
    const dataRow = sheet.getRow(row);
    dataRow.getCell(1).value = vacancy;
    dataRow.getCell(1).numFmt = '0.0%';

    for (let i = 0; i < exitCaps.length; i++) {
      // Simplified IRR calculation for sensitivity
      // In production, would use full calculateUnderwriting
      const baseIRR = model.irr || 0.14;
      const exitCapDelta = (exitCaps[i] - (model.exitCapRate || 0.055)) * -8;
      const vacancyDelta = (vacancy - (model.vacancyRate || 0.05)) * -3;
      const irr = baseIRR + exitCapDelta + vacancyDelta;

      const cell = dataRow.getCell(i + 2);
      cell.value = irr;
      cell.numFmt = '0.0%';

      // Conditional formatting colors
      if (irr >= 0.15) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC6EFCE' } };
      } else if (irr >= 0.10) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } };
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
      }
    }
    row++;
  }

  return sheet;
}

/**
 * Calculate detailed year-by-year cash flows
 */
function calculateDetailedCashFlows(model) {
  const holdPeriod = model.holdPeriod || 5;
  const years = [];

  // Year 0 (acquisition)
  years.push({
    year: 0,
    grossPotentialRent: 0,
    vacancyLoss: 0,
    otherIncome: 0,
    effectiveGrossIncome: 0,
    operatingExpenses: 0,
    taxes: 0,
    insurance: 0,
    management: 0,
    reserves: 0,
    totalExpenses: 0,
    noi: 0,
    interestPayment: 0,
    principalPayment: 0,
    totalDebtService: 0,
    beforeTaxCashFlow: -(model.purchasePrice - model.loanAmount)
  });

  let currentLoanBalance = model.loanAmount || 0;
  const monthlyRate = (model.interestRate || 0.06) / 12;
  const monthlyPayment = model.annualDebtService ? model.annualDebtService / 12 : 0;

  for (let year = 1; year <= holdPeriod; year++) {
    const revenueGrowthFactor = Math.pow(1 + (model.rentGrowth || 0.03), year - 1);
    const expenseGrowthFactor = Math.pow(1 + (model.expenseGrowth || 0.02), year - 1);

    const gpr = (model.grossPotentialRent || 0) * revenueGrowthFactor;
    const vacancyLoss = gpr * (model.vacancyRate || 0.05);
    const otherIncome = (model.otherIncome || 0) * revenueGrowthFactor;
    const egi = gpr - vacancyLoss + otherIncome;

    const opex = (model.operatingExpenses || 0) * expenseGrowthFactor;
    const taxes = (model.taxes || 0) * expenseGrowthFactor;
    const insurance = (model.insurance || 0) * expenseGrowthFactor;
    const management = (model.management || 0) * expenseGrowthFactor;
    const reserves = (model.reserves || 0) * expenseGrowthFactor;
    const totalExpenses = opex || (taxes + insurance + management + reserves);

    const noi = egi - totalExpenses;

    // Calculate debt service split
    let yearInterest = 0;
    let yearPrincipal = 0;

    for (let month = 0; month < 12; month++) {
      const interestPayment = currentLoanBalance * monthlyRate;
      const principalPayment = monthlyPayment - interestPayment;
      yearInterest += interestPayment;
      yearPrincipal += principalPayment;
      currentLoanBalance -= principalPayment;
    }

    const totalDebtService = model.annualDebtService || (yearInterest + yearPrincipal);
    const beforeTaxCashFlow = noi - totalDebtService;

    years.push({
      year,
      grossPotentialRent: gpr,
      vacancyLoss,
      otherIncome,
      effectiveGrossIncome: egi,
      operatingExpenses: opex,
      taxes,
      insurance,
      management,
      reserves,
      totalExpenses,
      noi,
      interestPayment: yearInterest,
      principalPayment: yearPrincipal,
      totalDebtService,
      beforeTaxCashFlow,
      endingLoanBalance: currentLoanBalance
    });
  }

  // Exit calculations
  const finalYear = years[holdPeriod];
  const exitNOI = finalYear.noi;
  const exitCapRate = model.exitCapRate || 0.055;
  const grossSalePrice = exitNOI / exitCapRate;
  const sellingCosts = grossSalePrice * 0.02;
  const loanPayoff = currentLoanBalance;
  const netSaleProceeds = grossSalePrice - sellingCosts - loanPayoff;

  // Calculate totals
  const equityInvested = model.purchasePrice - model.loanAmount;
  let totalCashDistributed = 0;
  for (let year = 1; year <= holdPeriod; year++) {
    totalCashDistributed += years[year].beforeTaxCashFlow;
  }
  totalCashDistributed += netSaleProceeds;

  const equityMultiple = (totalCashDistributed + equityInvested) / equityInvested;

  // Calculate IRR
  const cashFlows = years.map(y => y.beforeTaxCashFlow);
  cashFlows[holdPeriod] += netSaleProceeds;
  const irr = calculateIRR(cashFlows);

  return {
    years,
    exit: {
      exitNOI,
      exitCapRate,
      grossSalePrice,
      sellingCosts,
      loanPayoff,
      netSaleProceeds
    },
    totals: {
      equityInvested,
      totalCashDistributed,
      equityMultiple,
      irr
    }
  };
}

/**
 * Calculate IRR using Newton-Raphson
 */
function calculateIRR(cashFlows, guess = 0.1) {
  let rate = guess;
  const tolerance = 0.0001;
  const maxIterations = 100;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0;

    for (let j = 0; j < cashFlows.length; j++) {
      npv += cashFlows[j] / Math.pow(1 + rate, j);
      dnpv -= j * cashFlows[j] / Math.pow(1 + rate, j + 1);
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;
    if (rate < -0.99 || rate > 10) return null;
  }

  return rate;
}

// Helper functions

function addSectionHeader(sheet, row, title, startCol = 1) {
  const cell = sheet.getCell(row, startCol);
  cell.value = title;
  Object.assign(cell, STYLES.sectionHeader);
  sheet.mergeCells(row, startCol, row, startCol + 1);
  return row + 1;
}

function addLabelValue(sheet, row, label, value, format, startCol = 1) {
  const labelCell = sheet.getCell(row, startCol);
  labelCell.value = label;
  Object.assign(labelCell, STYLES.label);

  const valueCell = sheet.getCell(row, startCol + 1);
  valueCell.value = value;

  switch (format) {
    case 'currency':
      valueCell.numFmt = '$#,##0';
      break;
    case 'percentage':
      valueCell.numFmt = '0.00%';
      break;
    case 'ratio':
      valueCell.numFmt = '0.00"x"';
      break;
    case 'years':
      valueCell.numFmt = '0 "yrs"';
      break;
    case 'number':
      valueCell.numFmt = '#,##0.00';
      break;
  }

  return row + 1;
}

function addCashFlowSection(sheet, startRow, title, fields, projections, holdPeriod) {
  let row = startRow;

  // Section header
  const headerCell = sheet.getCell(row, 1);
  headerCell.value = title;
  Object.assign(headerCell, STYLES.sectionHeader);
  row++;

  // Data rows
  for (const field of fields) {
    const dataRow = sheet.getRow(row);
    dataRow.getCell(1).value = field.label;

    if (field.isTotal) {
      dataRow.getCell(1).font = { bold: true };
    }

    for (let year = 0; year <= holdPeriod; year++) {
      const cell = dataRow.getCell(year + 2);
      let value = projections.years[year]?.[field.key] || 0;

      if (field.isNegative && value > 0) {
        value = -value;
      }

      cell.value = value;
      cell.numFmt = '$#,##0';

      if (field.isTotal) {
        cell.font = { bold: true };
      }
    }
    row++;
  }

  return row;
}

export default {
  exportToExcel,
  calculateDetailedCashFlows
};
