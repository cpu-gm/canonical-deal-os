/**
 * Underwriting Calculator Service
 *
 * Performs financial calculations for real estate underwriting models.
 * Calculates NOI, cap rates, debt service, returns, and IRR.
 *
 * Enhanced with sector-specific calculations for:
 * - Hotel (RevPAR, GOPPAR, management fees)
 * - Data Center ($/kW, PUE, power-based NOI)
 * - Life Sciences (TI exposure, lab/office blend)
 * - Seniors Housing (RIDEA, per-unit metrics)
 * - Student Housing (per-bed metrics, prelease)
 * - Self Storage (ECRI, economic occupancy)
 * - Manufactured Housing (lot rent, POH ratio)
 */

import { getSectorConfig, detectSector, validateAgainstBenchmark } from './sector-config.js';

/**
 * Calculate full underwriting model from inputs
 *
 * @param {Object} inputs - All model inputs
 * @returns {Object} Calculated model with all metrics
 */
export function calculateUnderwriting(inputs) {
  const {
    // Property
    purchasePrice,

    // Revenue (from rent roll or T12)
    grossPotentialRent,
    vacancyRate = 0.05,
    otherIncome = 0,

    // Expenses (from T12)
    operatingExpenses,
    taxes,
    insurance,
    management,
    reserves,

    // Debt (from loan terms)
    loanAmount,
    interestRate,
    amortization = 30,
    loanTerm,
    ioPeriod = 0,

    // Assumptions
    exitCapRate,
    holdPeriod = 5,
    rentGrowth = 0.03,
    expenseGrowth = 0.02
  } = inputs;

  const result = {
    // Input echo
    inputs: {
      purchasePrice,
      grossPotentialRent,
      vacancyRate,
      otherIncome,
      loanAmount,
      interestRate,
      exitCapRate,
      holdPeriod
    },

    // Calculated values
    income: {},
    expenses: {},
    returns: {},
    debtMetrics: {},
    projections: null,
    warnings: []
  };

  // Calculate income
  if (grossPotentialRent) {
    result.income.grossPotentialRent = grossPotentialRent;
    result.income.vacancyLoss = grossPotentialRent * vacancyRate;
    result.income.effectiveGrossIncome = grossPotentialRent * (1 - vacancyRate) + (otherIncome || 0);
    result.income.otherIncome = otherIncome || 0;
  }

  // Calculate expenses
  if (operatingExpenses) {
    result.expenses.totalOperating = operatingExpenses;
  } else if (taxes || insurance || management || reserves) {
    // Sum individual components if total not provided
    result.expenses.taxes = taxes || 0;
    result.expenses.insurance = insurance || 0;
    result.expenses.management = management || 0;
    result.expenses.reserves = reserves || 0;
    result.expenses.totalOperating = (taxes || 0) + (insurance || 0) + (management || 0) + (reserves || 0);
  }

  // Calculate NOI
  if (result.income.effectiveGrossIncome && result.expenses.totalOperating !== undefined) {
    result.income.netOperatingIncome = result.income.effectiveGrossIncome - result.expenses.totalOperating;
    result.expenses.expenseRatio = result.expenses.totalOperating / result.income.effectiveGrossIncome;
  }

  // Calculate cap rate
  if (result.income.netOperatingIncome && purchasePrice) {
    result.returns.goingInCapRate = result.income.netOperatingIncome / purchasePrice;
  }

  // Calculate debt service
  if (loanAmount && interestRate) {
    const debtService = calculateDebtService(loanAmount, interestRate, amortization, ioPeriod);
    result.debtMetrics.annualDebtService = debtService.annualDebtService;
    result.debtMetrics.monthlyPayment = debtService.monthlyPayment;
    result.debtMetrics.isInterestOnly = debtService.isInterestOnly;

    // DSCR
    if (result.income.netOperatingIncome) {
      result.debtMetrics.dscr = result.income.netOperatingIncome / debtService.annualDebtService;

      if (result.debtMetrics.dscr < 1.0) {
        result.warnings.push('DSCR below 1.0 - negative cash flow');
      } else if (result.debtMetrics.dscr < 1.25) {
        result.warnings.push('DSCR below typical lender minimum of 1.25');
      }
    }
  }

  // Calculate LTV
  if (loanAmount && purchasePrice) {
    result.debtMetrics.ltv = loanAmount / purchasePrice;

    if (result.debtMetrics.ltv > 0.80) {
      result.warnings.push('LTV above 80% - may require additional guarantees');
    }
  }

  // Calculate equity metrics
  if (purchasePrice && loanAmount) {
    result.returns.equityRequired = purchasePrice - loanAmount;

    if (result.income.netOperatingIncome && result.debtMetrics.annualDebtService) {
      const beforeTaxCashFlow = result.income.netOperatingIncome - result.debtMetrics.annualDebtService;
      result.returns.beforeTaxCashFlow = beforeTaxCashFlow;
      result.returns.cashOnCash = beforeTaxCashFlow / result.returns.equityRequired;
    }
  }

  // Calculate projected returns (IRR and equity multiple)
  if (purchasePrice && result.income.netOperatingIncome && exitCapRate && holdPeriod && loanAmount) {
    result.projections = calculateProjectedReturns({
      purchasePrice,
      noi: result.income.netOperatingIncome,
      annualDebtService: result.debtMetrics.annualDebtService,
      exitCapRate,
      holdPeriod,
      rentGrowth,
      expenseGrowth,
      loanAmount,
      interestRate,
      amortization,
      expenseRatio: result.expenses.expenseRatio || 0.40
    });

    result.returns.irr = result.projections.irr;
    result.returns.equityMultiple = result.projections.equityMultiple;
  }

  return result;
}

/**
 * Calculate debt service (annual and monthly payments)
 */
function calculateDebtService(loanAmount, interestRate, amortization, ioPeriod = 0) {
  const annualInterest = loanAmount * interestRate;
  const monthlyInterestOnly = annualInterest / 12;

  if (ioPeriod > 0) {
    return {
      annualDebtService: annualInterest,
      monthlyPayment: monthlyInterestOnly,
      isInterestOnly: true
    };
  }

  const monthlyRate = interestRate / 12;
  const numPayments = amortization * 12;

  if (monthlyRate === 0) {
    const monthlyPayment = loanAmount / numPayments;
    return {
      annualDebtService: monthlyPayment * 12,
      monthlyPayment,
      isInterestOnly: false
    };
  }

  const monthlyPayment = loanAmount *
    (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  return {
    annualDebtService: monthlyPayment * 12,
    monthlyPayment,
    isInterestOnly: false
  };
}

/**
 * Calculate projected returns including IRR and equity multiple
 */
function calculateProjectedReturns(params) {
  const {
    purchasePrice,
    noi,
    annualDebtService,
    exitCapRate,
    holdPeriod,
    rentGrowth,
    expenseGrowth,
    loanAmount,
    interestRate,
    amortization,
    expenseRatio
  } = params;

  const equity = purchasePrice - loanAmount;
  const cashFlows = [-equity]; // Initial investment (negative)

  let currentNOI = noi;
  let totalCashFlow = 0;
  let currentLoanBalance = loanAmount;

  // Project cash flows for each year
  for (let year = 1; year <= holdPeriod; year++) {
    // Grow revenue and expenses
    const revenueGrowthFactor = Math.pow(1 + rentGrowth, year);
    const expenseGrowthFactor = Math.pow(1 + expenseGrowth, year);

    // Calculate NOI for this year (simplified growth model)
    const revenue = (noi / (1 - expenseRatio)) * revenueGrowthFactor;
    const expenses = revenue * expenseRatio * expenseGrowthFactor / revenueGrowthFactor;
    currentNOI = revenue - expenses;

    // Before-tax cash flow
    const btcf = currentNOI - annualDebtService;

    if (year < holdPeriod) {
      cashFlows.push(btcf);
      totalCashFlow += btcf;
    }

    // Update loan balance (simplified amortization)
    const monthlyRate = interestRate / 12;
    const monthlyPayment = annualDebtService / 12;
    for (let month = 0; month < 12; month++) {
      const interestPayment = currentLoanBalance * monthlyRate;
      const principalPayment = monthlyPayment - interestPayment;
      currentLoanBalance -= principalPayment;
    }
  }

  // Calculate exit value and net proceeds in final year
  const exitValue = currentNOI / exitCapRate;
  const sellingCosts = exitValue * 0.02; // ~2% selling costs
  const netSaleProceeds = exitValue - sellingCosts - currentLoanBalance;

  // Final year: cash flow + sale proceeds
  const finalYearCashFlow = (currentNOI - annualDebtService) + netSaleProceeds;
  cashFlows.push(finalYearCashFlow);
  totalCashFlow += finalYearCashFlow;

  // Calculate IRR
  const irr = calculateIRR(cashFlows);

  // Calculate equity multiple
  const equityMultiple = (totalCashFlow + equity) / equity;

  return {
    cashFlows,
    irr,
    equityMultiple,
    exitValue,
    netSaleProceeds,
    finalLoanBalance: currentLoanBalance
  };
}

/**
 * Calculate Internal Rate of Return using Newton-Raphson method
 */
export function calculateIRR(cashFlows, guess = 0.1, tolerance = 0.0001, maxIterations = 100) {
  let rate = guess;

  for (let i = 0; i < maxIterations; i++) {
    let npv = 0;
    let dnpv = 0; // Derivative of NPV

    for (let j = 0; j < cashFlows.length; j++) {
      npv += cashFlows[j] / Math.pow(1 + rate, j);
      dnpv -= j * cashFlows[j] / Math.pow(1 + rate, j + 1);
    }

    const newRate = rate - npv / dnpv;

    if (Math.abs(newRate - rate) < tolerance) {
      return newRate;
    }

    rate = newRate;

    // Prevent runaway values
    if (rate < -0.99 || rate > 10) {
      return null; // IRR couldn't converge
    }
  }

  return rate; // Return best estimate even if didn't converge
}

/**
 * Calculate returns for a scenario with modified assumptions
 */
export function calculateScenario(baseModel, scenarioAssumptions) {
  const inputs = {
    ...baseModel.inputs,
    ...scenarioAssumptions
  };

  return calculateUnderwriting(inputs);
}

/**
 * Compare multiple scenarios
 */
export function compareScenarios(scenarios) {
  return scenarios.map(scenario => ({
    name: scenario.name,
    irr: scenario.results?.returns?.irr ?? null,
    cashOnCash: scenario.results?.returns?.cashOnCash ?? null,
    dscr: scenario.results?.debtMetrics?.dscr ?? null,
    equityMultiple: scenario.results?.returns?.equityMultiple ?? null,
    goingInCap: scenario.results?.returns?.goingInCapRate ?? null
  }));
}

/**
 * Sensitivity analysis - vary one input and show impact on returns
 */
export function sensitivityAnalysis(baseInputs, field, variations) {
  return variations.map(value => {
    const inputs = { ...baseInputs, [field]: value };
    const result = calculateUnderwriting(inputs);
    return {
      [field]: value,
      irr: result.returns?.irr ?? null,
      cashOnCash: result.returns?.cashOnCash ?? null,
      dscr: result.debtMetrics?.dscr ?? null
    };
  });
}

/**
 * Project Detailed Year-by-Year Cash Flows
 *
 * Provides full transparency into annual cash flow components:
 * - Revenue line items (GPR, vacancy, other income)
 * - Expense line items (OpEx, taxes, insurance, management, reserves)
 * - NOI breakdown
 * - Debt service (interest, principal, balance)
 * - Before-tax cash flow
 * - Exit analysis
 *
 * @param {Object} model - Underwriting model inputs
 * @param {number} years - Hold period (default from model or 5)
 * @returns {Object} Detailed cash flow projection
 */
export function projectDetailedCashFlows(model, years = null) {
  const holdPeriod = years || model.holdPeriod || 5;

  // Extract inputs with defaults
  const grossPotentialRent = model.grossPotentialRent || 0;
  const vacancyRate = model.vacancyRate || 0.05;
  const otherIncome = model.otherIncome || 0;

  // Expenses - use individual items or total
  const taxes = model.taxes || 0;
  const insurance = model.insurance || 0;
  const management = model.management || 0;
  const reserves = model.reserves || 0;
  const operatingExpenses = model.operatingExpenses || (taxes + insurance + management + reserves);

  // Debt parameters
  const loanAmount = model.loanAmount || 0;
  const interestRate = model.interestRate || 0;
  const amortization = model.amortization || 30;
  const ioPeriod = model.ioPeriod || 0;

  // Growth assumptions
  const rentGrowth = model.rentGrowth || 0.03;
  const expenseGrowth = model.expenseGrowth || 0.02;
  const otherIncomeGrowth = model.otherIncomeGrowth || rentGrowth;

  // Exit assumptions
  const exitCapRate = model.exitCapRate || 0.055;
  const sellingCostRate = model.sellingCostRate || 0.02;

  // Purchase info
  const purchasePrice = model.purchasePrice || 0;
  const equityRequired = purchasePrice - loanAmount;

  // Calculate Year 1 base values
  const year1GPR = grossPotentialRent;
  const year1Vacancy = year1GPR * vacancyRate;
  const year1OtherIncome = otherIncome;
  const year1EGI = year1GPR - year1Vacancy + year1OtherIncome;

  // If we have expense breakdown, use it; otherwise estimate from ratio
  let year1Taxes = taxes;
  let year1Insurance = insurance;
  let year1Management = management;
  let year1Reserves = reserves;
  let year1OpEx = operatingExpenses - taxes - insurance - management - reserves;

  // If using total opex, distribute approximately
  if (operatingExpenses > 0 && taxes === 0 && insurance === 0) {
    year1OpEx = operatingExpenses * 0.50;
    year1Taxes = operatingExpenses * 0.25;
    year1Insurance = operatingExpenses * 0.08;
    year1Management = operatingExpenses * 0.12;
    year1Reserves = operatingExpenses * 0.05;
  }

  const year1TotalExpenses = year1OpEx + year1Taxes + year1Insurance + year1Management + year1Reserves;
  const year1NOI = year1EGI - year1TotalExpenses;

  // Calculate debt service
  const debtServiceInfo = calculateDebtServiceSchedule(
    loanAmount,
    interestRate,
    amortization,
    ioPeriod,
    holdPeriod
  );

  // Build year-by-year projections
  const yearlyProjections = [];
  let cumulativeCashFlow = 0;
  let currentLoanBalance = loanAmount;

  for (let year = 1; year <= holdPeriod; year++) {
    const growthMultiplierRevenue = Math.pow(1 + rentGrowth, year - 1);
    const growthMultiplierExpense = Math.pow(1 + expenseGrowth, year - 1);
    const growthMultiplierOther = Math.pow(1 + otherIncomeGrowth, year - 1);

    // Revenue
    const gpr = year1GPR * growthMultiplierRevenue;
    const vacancy = gpr * vacancyRate;
    const other = year1OtherIncome * growthMultiplierOther;
    const egi = gpr - vacancy + other;

    // Expenses (grow at expense growth rate)
    const opEx = year1OpEx * growthMultiplierExpense;
    const taxesYear = year1Taxes * growthMultiplierExpense;
    const insuranceYear = year1Insurance * growthMultiplierExpense;
    const managementYear = year1Management * growthMultiplierExpense;
    const reservesYear = year1Reserves * growthMultiplierExpense;
    const totalExpenses = opEx + taxesYear + insuranceYear + managementYear + reservesYear;

    // NOI
    const noi = egi - totalExpenses;

    // Debt service for this year
    const yearDebtInfo = debtServiceInfo.schedule[year - 1] || {};
    const interestPayment = yearDebtInfo.interestPayment || 0;
    const principalPayment = yearDebtInfo.principalPayment || 0;
    const totalDebtService = interestPayment + principalPayment;
    const endingBalance = yearDebtInfo.endingBalance || 0;

    // Before-tax cash flow
    const btcf = noi - totalDebtService;
    cumulativeCashFlow += btcf;

    yearlyProjections.push({
      year,
      revenue: {
        grossPotentialRent: round(gpr),
        vacancy: round(-vacancy),
        vacancyRate: vacancyRate,
        otherIncome: round(other),
        effectiveGrossIncome: round(egi)
      },
      expenses: {
        operating: round(opEx),
        taxes: round(taxesYear),
        insurance: round(insuranceYear),
        management: round(managementYear),
        reserves: round(reservesYear),
        totalExpenses: round(totalExpenses),
        expenseRatio: totalExpenses / egi
      },
      noi: round(noi),
      debtService: {
        interestPayment: round(interestPayment),
        principalPayment: round(principalPayment),
        totalDebtService: round(totalDebtService),
        beginningBalance: round(year === 1 ? loanAmount : yearlyProjections[year - 2]?.debtService?.endingBalance || currentLoanBalance),
        endingBalance: round(endingBalance),
        isInterestOnly: year <= ioPeriod
      },
      beforeTaxCashFlow: round(btcf),
      cumulativeCashFlow: round(cumulativeCashFlow),
      metrics: {
        dscr: totalDebtService > 0 ? noi / totalDebtService : null,
        debtYield: loanAmount > 0 ? noi / loanAmount : null,
        capRate: purchasePrice > 0 ? noi / purchasePrice : null
      }
    });

    currentLoanBalance = endingBalance;
  }

  // Calculate exit
  const finalYearNOI = yearlyProjections[holdPeriod - 1].noi;
  const exitNOI = finalYearNOI * (1 + rentGrowth); // Next year's NOI for exit cap
  const grossSalePrice = exitNOI / exitCapRate;
  const sellingCosts = grossSalePrice * sellingCostRate;
  const netSaleProceeds = grossSalePrice - sellingCosts;
  const loanPayoff = currentLoanBalance;
  const netEquityProceeds = netSaleProceeds - loanPayoff;

  // Calculate returns
  const cashFlowsForIRR = [-equityRequired];
  for (let i = 0; i < holdPeriod - 1; i++) {
    cashFlowsForIRR.push(yearlyProjections[i].beforeTaxCashFlow);
  }
  // Final year: cash flow + equity proceeds
  cashFlowsForIRR.push(yearlyProjections[holdPeriod - 1].beforeTaxCashFlow + netEquityProceeds);

  const irr = calculateIRR(cashFlowsForIRR);
  const totalDistributed = cumulativeCashFlow + netEquityProceeds;
  const equityMultiple = (totalDistributed + equityRequired) / equityRequired;
  const avgCashOnCash = cumulativeCashFlow / holdPeriod / equityRequired;

  return {
    years: yearlyProjections,
    exit: {
      year: holdPeriod,
      noiAtExit: round(finalYearNOI),
      exitNOI: round(exitNOI),
      exitCapRate: exitCapRate,
      grossSalePrice: round(grossSalePrice),
      sellingCosts: round(sellingCosts),
      sellingCostRate: sellingCostRate,
      netSaleProceeds: round(netSaleProceeds),
      loanPayoff: round(loanPayoff),
      netEquityProceeds: round(netEquityProceeds)
    },
    totals: {
      equityInvested: round(equityRequired),
      totalCashDistributed: round(cumulativeCashFlow),
      totalSaleProceeds: round(netEquityProceeds),
      totalReturned: round(totalDistributed + equityRequired),
      equityMultiple: round(equityMultiple, 2),
      irr: irr !== null ? round(irr, 4) : null,
      avgCashOnCash: round(avgCashOnCash, 4),
      avgDSCR: round(yearlyProjections.reduce((sum, y) => sum + (y.metrics.dscr || 0), 0) / holdPeriod, 2)
    },
    assumptions: {
      holdPeriod,
      rentGrowth,
      expenseGrowth,
      exitCapRate,
      interestRate,
      amortization,
      ioPeriod
    }
  };
}

/**
 * Calculate full debt service schedule with amortization
 */
function calculateDebtServiceSchedule(loanAmount, interestRate, amortization, ioPeriod, holdPeriod) {
  const schedule = [];
  let balance = loanAmount;
  const monthlyRate = interestRate / 12;
  const numPayments = amortization * 12;

  // Calculate amortizing payment
  let monthlyPayment = 0;
  if (monthlyRate > 0 && numPayments > 0) {
    monthlyPayment = loanAmount *
      (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
      (Math.pow(1 + monthlyRate, numPayments) - 1);
  } else if (numPayments > 0) {
    monthlyPayment = loanAmount / numPayments;
  }

  for (let year = 1; year <= holdPeriod; year++) {
    const isIO = year <= ioPeriod;
    let yearInterest = 0;
    let yearPrincipal = 0;

    for (let month = 1; month <= 12; month++) {
      const interestPayment = balance * monthlyRate;

      if (isIO) {
        yearInterest += interestPayment;
        // No principal in IO period
      } else {
        yearInterest += interestPayment;
        const principalPayment = monthlyPayment - interestPayment;
        yearPrincipal += principalPayment;
        balance -= principalPayment;
      }
    }

    schedule.push({
      year,
      beginningBalance: year === 1 ? loanAmount : schedule[year - 2]?.endingBalance || balance + yearPrincipal,
      interestPayment: yearInterest,
      principalPayment: yearPrincipal,
      totalPayment: yearInterest + yearPrincipal,
      endingBalance: balance,
      isInterestOnly: isIO
    });
  }

  return {
    schedule,
    monthlyPayment,
    totalInterest: schedule.reduce((sum, y) => sum + y.interestPayment, 0),
    totalPrincipal: schedule.reduce((sum, y) => sum + y.principalPayment, 0)
  };
}

/**
 * Helper to round numbers
 */
function round(value, decimals = 0) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const multiplier = Math.pow(10, decimals);
  return Math.round(value * multiplier) / multiplier;
}

/**
 * Calculate sector-specific metrics
 * Adds specialized calculations based on property type
 */
export function calculateSectorMetrics(inputs, sector = null) {
  const detectedSector = sector || detectSector(inputs) || 'MULTIFAMILY';
  const config = getSectorConfig(detectedSector);

  if (!config) {
    return { sector: detectedSector, metrics: {}, warnings: [] };
  }

  const metrics = {};
  const warnings = [];

  switch (detectedSector) {
    case 'HOTEL':
      Object.assign(metrics, calculateHotelMetrics(inputs));
      break;
    case 'DATA_CENTER':
      Object.assign(metrics, calculateDataCenterMetrics(inputs));
      break;
    case 'LIFE_SCIENCES':
      Object.assign(metrics, calculateLifeSciencesMetrics(inputs));
      break;
    case 'SENIORS_HOUSING':
      Object.assign(metrics, calculateSeniorsHousingMetrics(inputs));
      break;
    case 'STUDENT_HOUSING':
      Object.assign(metrics, calculateStudentHousingMetrics(inputs));
      break;
    case 'SELF_STORAGE':
      Object.assign(metrics, calculateSelfStorageMetrics(inputs));
      break;
    case 'MANUFACTURED_HOUSING':
      Object.assign(metrics, calculateManufacturedHousingMetrics(inputs));
      break;
    case 'RETAIL':
      Object.assign(metrics, calculateRetailMetrics(inputs));
      break;
    case 'INDUSTRIAL':
      Object.assign(metrics, calculateIndustrialMetrics(inputs));
      break;
    case 'OFFICE':
      Object.assign(metrics, calculateOfficeMetrics(inputs));
      break;
    case 'GROUND_LEASE':
      Object.assign(metrics, calculateGroundLeaseMetrics(inputs));
      break;
    case 'NET_LEASE':
      Object.assign(metrics, calculateNetLeaseMetrics(inputs));
      break;
    case 'CONDOMINIUM':
      Object.assign(metrics, calculateCondominiumMetrics(inputs));
      break;
    case 'COLD_STORAGE':
      Object.assign(metrics, calculateColdStorageMetrics(inputs));
      break;
    case 'FLEX_RD':
      Object.assign(metrics, calculateFlexRDMetrics(inputs));
      break;
    case 'MEDICAL_OFFICE':
      Object.assign(metrics, calculateMedicalOfficeMetrics(inputs));
      break;
    case 'MULTIFAMILY':
    default:
      Object.assign(metrics, calculateMultifamilyMetrics(inputs));
      break;
  }

  // Validate against benchmarks
  const benchmarks = config.benchmarks || {};
  for (const [key, value] of Object.entries(metrics)) {
    const validation = validateAgainstBenchmark(detectedSector, key, value);
    if (validation.warning) {
      warnings.push({ metric: key, value, warning: validation.warning, benchmark: validation.benchmark });
    }
  }

  return {
    sector: detectedSector,
    sectorName: config.name,
    metrics,
    warnings,
    riskFactors: config.riskFactors || [],
    primaryMetrics: config.primaryMetrics || []
  };
}

/**
 * Hotel-specific calculations
 */
function calculateHotelMetrics(inputs) {
  const {
    roomCount,
    adr,
    occupancyRate,
    roomRevenue,
    fbRevenue = 0,
    otherRevenue = 0,
    departmentalExpenses = 0,
    undistributedExpenses = 0,
    managementFee = 0.03,
    franchiseFee = 0.05,
    ffAndE = 0.04,
    purchasePrice
  } = inputs;

  const metrics = {};

  // RevPAR
  if (adr && occupancyRate) {
    metrics.revpar = adr * occupancyRate;
  }

  // Total Revenue
  const totalRevenue = (roomRevenue || 0) + fbRevenue + otherRevenue;
  if (totalRevenue > 0) {
    metrics.totalRevenue = totalRevenue;

    // GOP (Gross Operating Profit)
    const departmental = departmentalExpenses || (totalRevenue * 0.35);
    const undistributed = undistributedExpenses || (totalRevenue * 0.15);
    const mgmtFee = totalRevenue * managementFee;
    const franchise = totalRevenue * franchiseFee;

    const gop = totalRevenue - departmental - undistributed - mgmtFee - franchise;
    metrics.gop = gop;
    metrics.gopMargin = gop / totalRevenue;

    // GOPPAR
    if (roomCount) {
      metrics.goppar = gop / roomCount / 365;
    }

    // NOI (after FF&E reserve)
    const ffAndEReserve = totalRevenue * ffAndE;
    const noi = gop - ffAndEReserve;
    metrics.noi = noi;
    metrics.noiMargin = noi / totalRevenue;
    metrics.ffAndEReserve = ffAndEReserve;
  }

  // Price per key
  if (purchasePrice && roomCount) {
    metrics.pricePerKey = purchasePrice / roomCount;
  }

  return metrics;
}

/**
 * Data Center-specific calculations
 */
function calculateDataCenterMetrics(inputs) {
  const {
    itLoadKW,
    pue = 1.4,
    ratePerKW,
    powerCost = 0.10,
    totalSF,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (itLoadKW) {
    // Total power draw
    metrics.totalPowerDrawKW = itLoadKW * pue;
    metrics.totalMW = metrics.totalPowerDrawKW / 1000;

    // Annual power cost
    metrics.annualPowerCost = metrics.totalPowerDrawKW * powerCost * 8760;

    // Revenue
    if (ratePerKW) {
      metrics.annualRevenue = itLoadKW * ratePerKW * 12;
      metrics.revenuePerKW = ratePerKW * 12;
    }

    // NOI per kW
    if (metrics.annualRevenue && metrics.annualPowerCost) {
      const otherOpex = metrics.annualRevenue * 0.10; // ~10% other opex
      metrics.noi = metrics.annualRevenue - metrics.annualPowerCost - otherOpex;
      metrics.noiPerKW = metrics.noi / itLoadKW;
    }

    // Price per kW
    if (purchasePrice) {
      metrics.pricePerKW = purchasePrice / itLoadKW;
    }
  }

  // Power density
  if (itLoadKW && totalSF) {
    metrics.powerDensity = (itLoadKW * 1000) / totalSF; // watts per SF
  }

  metrics.pue = pue;

  return metrics;
}

/**
 * Life Sciences-specific calculations
 */
function calculateLifeSciencesMetrics(inputs) {
  const {
    totalSF,
    labSF,
    officeSF,
    labRentPSF,
    officeRentPSF,
    tenantImprovements = 150,
    tenantFundingRunway,
    purchasePrice
  } = inputs;

  const metrics = {};

  // Lab to office ratio
  if (totalSF && labSF) {
    metrics.labToOfficeRatio = labSF / totalSF;
  }

  // Blended rent
  if (labSF && officeSF && labRentPSF && officeRentPSF) {
    const labRevenue = labSF * labRentPSF;
    const officeRevenue = officeSF * officeRentPSF;
    metrics.blendedRentPSF = (labRevenue + officeRevenue) / (labSF + officeSF);
    metrics.totalPotentialRent = labRevenue + officeRevenue;
  }

  // TI exposure
  if (tenantImprovements && totalSF) {
    metrics.totalTIExposure = tenantImprovements * totalSF;
  }

  // Lab TI typically 3-4x office
  if (labSF && officeSF && tenantImprovements) {
    const labTI = tenantImprovements * 1.5; // Lab premium
    const officeTI = tenantImprovements * 0.4;
    metrics.estimatedLabTI = labSF * labTI;
    metrics.estimatedOfficeTI = officeSF * officeTI;
  }

  // Funding runway indicator
  if (tenantFundingRunway) {
    metrics.fundingRunwayMonths = tenantFundingRunway;
    if (tenantFundingRunway < 12) {
      metrics.fundingRisk = 'HIGH';
    } else if (tenantFundingRunway < 24) {
      metrics.fundingRisk = 'MEDIUM';
    } else {
      metrics.fundingRisk = 'LOW';
    }
  }

  // Price per SF
  if (purchasePrice && totalSF) {
    metrics.pricePerSF = purchasePrice / totalSF;
  }

  return metrics;
}

/**
 * Seniors Housing-specific calculations
 */
function calculateSeniorsHousingMetrics(inputs) {
  const {
    unitCount,
    avgMonthlyRate,
    occupancyRate = 0.88,
    managementFee = 0.05,
    careRevenue = 0,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (unitCount) {
    // Revenue
    if (avgMonthlyRate) {
      const occupiedUnits = unitCount * occupancyRate;
      metrics.annualRevenue = occupiedUnits * avgMonthlyRate * 12;
      metrics.revenuePerOccupiedUnit = avgMonthlyRate * 12;
    }

    // Price per unit
    if (purchasePrice) {
      metrics.pricePerUnit = purchasePrice / unitCount;
    }
  }

  // Care revenue as percent
  if (careRevenue && metrics.annualRevenue) {
    metrics.careRevenuePercent = careRevenue / metrics.annualRevenue;
  }

  // Estimate NOI margin (seniors housing typically 28-35%)
  if (metrics.annualRevenue) {
    const estimatedNOIMargin = 0.32; // 32% typical
    metrics.estimatedNOI = metrics.annualRevenue * estimatedNOIMargin;
    metrics.noiMargin = estimatedNOIMargin;

    if (unitCount) {
      metrics.noiPerUnit = metrics.estimatedNOI / unitCount;
    }
  }

  metrics.occupancyRate = occupancyRate;

  return metrics;
}

/**
 * Student Housing-specific calculations
 */
function calculateStudentHousingMetrics(inputs) {
  const {
    bedCount,
    unitCount,
    avgRentPerBed,
    preleaseRate,
    renewalRate,
    distanceToCampus,
    enrollment,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (bedCount) {
    // Beds per unit
    if (unitCount) {
      metrics.bedsPerUnit = bedCount / unitCount;
    }

    // Price per bed
    if (purchasePrice) {
      metrics.pricePerBed = purchasePrice / bedCount;
    }

    // Annual rent per bed
    if (avgRentPerBed) {
      metrics.annualRentPerBed = avgRentPerBed * 12;
      metrics.grossPotentialRent = bedCount * avgRentPerBed * 12;
    }
  }

  // Prelease and renewal metrics
  if (preleaseRate !== undefined) {
    metrics.preleaseRate = preleaseRate;
    if (preleaseRate < 0.60) {
      metrics.preleaseRisk = 'HIGH';
    } else if (preleaseRate < 0.80) {
      metrics.preleaseRisk = 'MEDIUM';
    } else {
      metrics.preleaseRisk = 'LOW';
    }
  }

  if (renewalRate !== undefined) {
    metrics.renewalRate = renewalRate;
  }

  // Distance premium/discount
  if (distanceToCampus !== undefined) {
    metrics.distanceToCampus = distanceToCampus;
    if (distanceToCampus <= 0.5) {
      metrics.distancePremium = 1.33; // 33% premium
    } else if (distanceToCampus <= 1.0) {
      metrics.distancePremium = 1.15;
    } else {
      metrics.distancePremium = 1.0;
      metrics.distanceRisk = 'Properties >1 mile from campus face leasing challenges';
    }
  }

  // Enrollment coverage
  if (enrollment && bedCount) {
    metrics.enrollmentCoverage = bedCount / enrollment;
  }

  return metrics;
}

/**
 * Self Storage-specific calculations
 */
function calculateSelfStorageMetrics(inputs) {
  const {
    netRentableSF,
    unitCount,
    avgRentPerSF,
    streetRate,
    physicalOccupancy,
    economicOccupancy,
    ancillaryIncome = 0,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (netRentableSF) {
    // Revenue per SF
    if (avgRentPerSF) {
      metrics.revenuePerSF = avgRentPerSF;
      metrics.grossPotentialRent = netRentableSF * avgRentPerSF;
    }

    // Price per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / netRentableSF;
    }
  }

  // Average unit size
  if (netRentableSF && unitCount) {
    metrics.avgUnitSize = netRentableSF / unitCount;
  }

  // Occupancy metrics
  if (physicalOccupancy !== undefined) {
    metrics.physicalOccupancy = physicalOccupancy;
  }
  if (economicOccupancy !== undefined) {
    metrics.economicOccupancy = economicOccupancy;
  }

  // Street rate vs in-place (ECRI opportunity)
  if (streetRate && avgRentPerSF) {
    metrics.streetRate = streetRate;
    metrics.rateGap = streetRate - avgRentPerSF;
    metrics.rateGapPercent = (streetRate - avgRentPerSF) / avgRentPerSF;
    metrics.ecriOpportunity = metrics.rateGapPercent > 0.10 ? 'HIGH' : metrics.rateGapPercent > 0.05 ? 'MEDIUM' : 'LOW';
  }

  // Ancillary income
  if (ancillaryIncome && metrics.grossPotentialRent) {
    metrics.ancillaryIncomePercent = ancillaryIncome / metrics.grossPotentialRent;
  }

  return metrics;
}

/**
 * Manufactured Housing / MHP-specific calculations
 */
function calculateManufacturedHousingMetrics(inputs) {
  const {
    totalPads,
    occupiedPads,
    avgLotRent,
    marketLotRent,
    parkOwnedHomes = 0,
    pohRentPremium = 0,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (totalPads) {
    // Occupancy
    if (occupiedPads !== undefined) {
      metrics.occupancy = occupiedPads / totalPads;
      metrics.vacantPads = totalPads - occupiedPads;
    }

    // POH ratio
    metrics.pohCount = parkOwnedHomes;
    metrics.pohRatio = parkOwnedHomes / totalPads;
    if (metrics.pohRatio > 0.10) {
      metrics.pohRisk = 'HIGH - Lenders prefer <10% POH';
    } else if (metrics.pohRatio > 0.05) {
      metrics.pohRisk = 'MEDIUM';
    } else {
      metrics.pohRisk = 'LOW';
    }

    // Price per pad
    if (purchasePrice) {
      metrics.pricePerPad = purchasePrice / totalPads;
    }
  }

  // Lot rent metrics
  if (avgLotRent) {
    metrics.avgLotRent = avgLotRent;
    metrics.annualLotRentPerPad = avgLotRent * 12;
  }

  // Loss to lease (rent upside)
  if (avgLotRent && marketLotRent && occupiedPads) {
    metrics.lossToLease = (marketLotRent - avgLotRent) * occupiedPads * 12;
    metrics.lossToLeasePercent = (marketLotRent - avgLotRent) / marketLotRent;
  }

  // POH revenue contribution
  if (parkOwnedHomes && pohRentPremium) {
    metrics.pohAnnualIncome = parkOwnedHomes * pohRentPremium * 12;
  }

  return metrics;
}

/**
 * Retail-specific calculations
 */
function calculateRetailMetrics(inputs) {
  const {
    gla,
    anchorSF,
    inlineSF,
    anchorRent,
    inlineRent,
    percentRent = 0,
    tenantSales,
    cam,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (gla) {
    // Anchor vs inline breakdown
    if (anchorSF) {
      metrics.anchorPercent = anchorSF / gla;
    }
    if (inlineSF) {
      metrics.inlinePercent = inlineSF / gla;
    }

    // Price per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / gla;
    }
  }

  // Blended rent
  if (anchorSF && inlineSF && anchorRent && inlineRent) {
    const anchorRevenue = anchorSF * anchorRent;
    const inlineRevenue = inlineSF * inlineRent;
    metrics.blendedRentPSF = (anchorRevenue + inlineRevenue) / (anchorSF + inlineSF);
    metrics.totalBaseRent = anchorRevenue + inlineRevenue;
  }

  // Occupancy cost ratio
  if (tenantSales && metrics.blendedRentPSF && cam) {
    const totalOccupancyCost = metrics.blendedRentPSF + cam;
    metrics.occupancyCostRatio = totalOccupancyCost / tenantSales;
    if (metrics.occupancyCostRatio > 0.15) {
      metrics.occupancyCostRisk = 'HIGH - Occupancy cost >15% of sales';
    } else if (metrics.occupancyCostRatio > 0.10) {
      metrics.occupancyCostRisk = 'MEDIUM';
    } else {
      metrics.occupancyCostRisk = 'LOW';
    }
  }

  // Sales per SF
  if (tenantSales) {
    metrics.salesPerSF = tenantSales;
  }

  return metrics;
}

/**
 * Industrial-specific calculations
 */
function calculateIndustrialMetrics(inputs) {
  const {
    totalSF,
    officeSF,
    warehouseSF,
    clearHeight,
    dockDoors,
    avgRentPerSF,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (totalSF) {
    // Office ratio
    if (officeSF) {
      metrics.officeRatio = officeSF / totalSF;
    }
    if (warehouseSF) {
      metrics.warehouseRatio = warehouseSF / totalSF;
    }

    // Price per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / totalSF;
    }

    // Rent per SF
    if (avgRentPerSF) {
      metrics.rentPerSF = avgRentPerSF;
      metrics.grossPotentialRent = totalSF * avgRentPerSF;
    }

    // Dock ratio (doors per 10,000 SF)
    if (dockDoors) {
      metrics.dockRatio = dockDoors / (totalSF / 10000);
    }
  }

  // Clear height assessment
  if (clearHeight) {
    metrics.clearHeight = clearHeight;
    if (clearHeight >= 36) {
      metrics.clearHeightClass = 'Class A - Modern logistics';
    } else if (clearHeight >= 28) {
      metrics.clearHeightClass = 'Class B - Standard distribution';
    } else {
      metrics.clearHeightClass = 'Older/Limited - May face obsolescence';
    }
  }

  return metrics;
}

/**
 * Office-specific calculations
 */
function calculateOfficeMetrics(inputs) {
  const {
    rentableSF,
    usableSF,
    buildingClass,
    avgRentPerSF,
    tenantImprovements,
    freeRent = 0,
    walt,
    tenantConcentration,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (rentableSF) {
    // Load factor
    if (usableSF) {
      metrics.loadFactor = (rentableSF - usableSF) / rentableSF;
    }

    // Price per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / rentableSF;
    }

    // Rent per SF
    if (avgRentPerSF) {
      metrics.rentPerSF = avgRentPerSF;
      metrics.grossPotentialRent = rentableSF * avgRentPerSF;
    }
  }

  // Effective rent (after TI and free rent)
  if (avgRentPerSF && tenantImprovements && walt) {
    const monthlyRent = avgRentPerSF / 12;
    const freeRentCost = freeRent * monthlyRent;
    const tiCostAnnualized = tenantImprovements / walt;
    metrics.effectiveRentPSF = avgRentPerSF - tiCostAnnualized - (freeRentCost / walt);
  }

  // WALT
  if (walt) {
    metrics.walt = walt;
    if (walt < 3) {
      metrics.rolloverRisk = 'HIGH - Short WALT';
    } else if (walt < 5) {
      metrics.rolloverRisk = 'MEDIUM';
    } else {
      metrics.rolloverRisk = 'LOW';
    }
  }

  // Tenant concentration risk
  if (tenantConcentration) {
    metrics.tenantConcentration = tenantConcentration;
    if (tenantConcentration > 0.50) {
      metrics.concentrationRisk = 'HIGH - Single tenant >50%';
    } else if (tenantConcentration > 0.30) {
      metrics.concentrationRisk = 'MEDIUM';
    } else {
      metrics.concentrationRisk = 'LOW';
    }
  }

  metrics.buildingClass = buildingClass;

  return metrics;
}

/**
 * Multifamily-specific calculations
 */
function calculateMultifamilyMetrics(inputs) {
  const {
    unitCount,
    avgUnitSize,
    avgRentPerUnit,
    avgRentPerSF,
    occupancyRate = 0.95,
    concessions = 0,
    turnoverRate,
    turnCost,
    lossToLease,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (unitCount) {
    // Price per unit
    if (purchasePrice) {
      metrics.pricePerUnit = purchasePrice / unitCount;
    }

    // Rent per unit
    if (avgRentPerUnit) {
      metrics.rentPerUnit = avgRentPerUnit;
      metrics.annualRentPerUnit = avgRentPerUnit * 12;
      metrics.grossPotentialRent = unitCount * avgRentPerUnit * 12;
    }
  }

  // Rent per SF
  if (avgRentPerUnit && avgUnitSize) {
    metrics.rentPerSF = avgRentPerUnit / avgUnitSize;
  } else if (avgRentPerSF) {
    metrics.rentPerSF = avgRentPerSF;
  }

  // Turnover cost
  if (turnoverRate && turnCost && unitCount) {
    metrics.annualTurnoverCost = unitCount * turnoverRate * turnCost;
  }

  // Loss to lease
  if (lossToLease && metrics.grossPotentialRent) {
    metrics.lossToLeasePercent = lossToLease / metrics.grossPotentialRent;
    metrics.lossToLeaseAnnual = lossToLease;
  }

  // Concession impact
  if (concessions && metrics.grossPotentialRent) {
    metrics.concessionPercent = concessions / metrics.grossPotentialRent;
  }

  metrics.occupancyRate = occupancyRate;

  return metrics;
}

/**
 * Ground Lease-specific calculations
 */
function calculateGroundLeaseMetrics(inputs) {
  const {
    landArea,
    landAreaAcres,
    baseRent,
    escalationRate = 0.02,
    escalationInterval = 5,
    remainingTerm,
    improvementValue,
    reversionValue,
    purchasePrice
  } = inputs;

  const metrics = {};

  // Land area conversions
  if (landArea) {
    metrics.landAreaSF = landArea;
    metrics.landAreaAcres = landArea / 43560;
  } else if (landAreaAcres) {
    metrics.landAreaAcres = landAreaAcres;
    metrics.landAreaSF = landAreaAcres * 43560;
  }

  // Cap rate on ground rent
  if (baseRent && purchasePrice) {
    metrics.capRate = baseRent / purchasePrice;
  }

  // Price per SF
  if (purchasePrice && metrics.landAreaSF) {
    metrics.pricePerSF = purchasePrice / metrics.landAreaSF;
  }

  // Rent per SF
  if (baseRent && metrics.landAreaSF) {
    metrics.rentPerSF = baseRent / metrics.landAreaSF;
  }

  // Total remaining rent (without escalation)
  if (baseRent && remainingTerm) {
    metrics.remainingTerm = remainingTerm;
    metrics.totalRemainingRentNoEsc = baseRent * remainingTerm;

    // With escalation - compound growth
    if (escalationRate) {
      let totalRent = 0;
      let currentRent = baseRent;
      for (let year = 1; year <= remainingTerm; year++) {
        totalRent += currentRent;
        // Apply escalation at intervals
        if (escalationInterval && year % escalationInterval === 0) {
          currentRent = currentRent * Math.pow(1 + escalationRate, escalationInterval);
        }
      }
      metrics.totalRemainingRentWithEsc = totalRent;
      metrics.avgAnnualRent = totalRent / remainingTerm;
    }
  }

  // Improvement coverage
  if (improvementValue && purchasePrice) {
    metrics.improvementCoverage = improvementValue / purchasePrice;
    if (metrics.improvementCoverage < 2) {
      metrics.improvementCoverageRisk = 'LOW - Improvements less than 2x land value';
    }
  }

  // Reversion value
  if (reversionValue && remainingTerm) {
    metrics.reversionValue = reversionValue;
    // Present value of reversion at 6% discount rate
    const discountRate = 0.06;
    metrics.reversionPV = reversionValue / Math.pow(1 + discountRate, remainingTerm);
    metrics.reversionPVPercent = metrics.reversionPV / purchasePrice;
  }

  // FFO approximation (for ground lease, FFO ≈ ground rent - minimal expenses)
  if (baseRent) {
    const estimatedExpenses = baseRent * 0.05; // 5% admin/insurance
    metrics.ffo = baseRent - estimatedExpenses;
    if (purchasePrice) {
      metrics.ffoYield = metrics.ffo / purchasePrice;
    }
  }

  return metrics;
}

/**
 * Net Lease / Single Tenant-specific calculations
 */
function calculateNetLeaseMetrics(inputs) {
  const {
    totalSF,
    baseRent,
    remainingTerm,
    escalationRate,
    tenantCredit,
    roofWalls,
    capExReserve = 0,
    purchasePrice,
    treasury10Year = 0.04 // Default 10-year Treasury rate
  } = inputs;

  const metrics = {};

  // Cap rate
  if (baseRent && purchasePrice) {
    metrics.capRate = baseRent / purchasePrice;
  }

  // Price and rent per SF
  if (totalSF) {
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / totalSF;
    }
    if (baseRent) {
      metrics.rentPerSF = baseRent / totalSF;
    }
  }

  // Spread to Treasury (key metric for net lease)
  if (metrics.capRate && treasury10Year) {
    metrics.spreadToTreasury = metrics.capRate - treasury10Year;
    metrics.spreadBps = metrics.spreadToTreasury * 10000; // Basis points

    if (metrics.spreadToTreasury < 0.02) {
      metrics.spreadAssessment = 'TIGHT - Below typical 200bp spread';
    } else if (metrics.spreadToTreasury < 0.03) {
      metrics.spreadAssessment = 'MARKET - Within typical range';
    } else {
      metrics.spreadAssessment = 'WIDE - Premium yield, check credit';
    }
  }

  // WALT (Weighted Average Lease Term)
  if (remainingTerm) {
    metrics.walt = remainingTerm;
    if (remainingTerm < 5) {
      metrics.waltRisk = 'HIGH - Short remaining term';
    } else if (remainingTerm < 10) {
      metrics.waltRisk = 'MEDIUM - Monitor renewal';
    } else {
      metrics.waltRisk = 'LOW - Long-term stability';
    }
  }

  // Tenant credit assessment
  if (tenantCredit) {
    metrics.tenantCredit = tenantCredit;
    const investmentGrade = ['AAA', 'AA', 'A', 'BBB'];
    metrics.isInvestmentGrade = investmentGrade.includes(tenantCredit);
  }

  // FFO and AFFO (key REIT metrics)
  if (baseRent) {
    // FFO ≈ NOI for net lease (minimal landlord expenses)
    const landExpenses = roofWalls === 'Landlord' ? baseRent * 0.03 : baseRent * 0.01;
    metrics.noi = baseRent - landExpenses;
    metrics.ffo = metrics.noi; // FFO adds back depreciation (assume captured in NOI)
    metrics.affo = metrics.ffo - capExReserve;

    if (purchasePrice) {
      metrics.ffoYield = metrics.ffo / purchasePrice;
      metrics.affoYield = metrics.affo / purchasePrice;
    }
  }

  // Total rent over remaining term
  if (baseRent && remainingTerm) {
    if (escalationRate) {
      let totalRent = 0;
      for (let year = 1; year <= remainingTerm; year++) {
        totalRent += baseRent * Math.pow(1 + escalationRate, year - 1);
      }
      metrics.totalRemainingRent = totalRent;
    } else {
      metrics.totalRemainingRent = baseRent * remainingTerm;
    }
  }

  return metrics;
}

/**
 * Condominium Development-specific calculations
 */
function calculateCondominiumMetrics(inputs) {
  const {
    totalUnits,
    avgUnitSize,
    totalSellableSF,
    avgSalePrice,
    presalesRequired = 0.50,
    currentPresales = 0,
    depositAmount = 0.10,
    landCost,
    hardCosts,
    softCosts,
    contingency = 0.05,
    constructionLoan,
    constructionRate = 0.08,
    constructionPeriod = 24,
    absorptionRate,
    brokerCommission = 0.05,
    closingCosts = 0.02,
    warrantyReserve = 0.01
  } = inputs;

  const metrics = {};

  // Calculate sellable SF if not provided
  const sellableSF = totalSellableSF || (totalUnits && avgUnitSize ? totalUnits * avgUnitSize : 0);

  // Gross revenue
  if (totalUnits && avgSalePrice) {
    metrics.grossRevenue = totalUnits * avgSalePrice;
    metrics.pricePerUnit = avgSalePrice;

    if (sellableSF) {
      metrics.pricePerSF = metrics.grossRevenue / sellableSF;
    }
  }

  // Development costs
  const land = landCost || 0;
  const hard = hardCosts || 0;
  const soft = softCosts || (hard * 0.25); // Default soft costs at 25% of hard
  const contingencyAmount = (hard + soft) * contingency;

  // Construction interest (half-drawn average)
  const constructionInterest = constructionLoan
    ? constructionLoan * constructionRate * (constructionPeriod / 12) * 0.5
    : 0;

  // Sales costs
  const salesCostRate = brokerCommission + closingCosts + warrantyReserve;
  const salesCosts = metrics.grossRevenue ? metrics.grossRevenue * salesCostRate : 0;

  metrics.totalDevelopmentCost = land + hard + soft + contingencyAmount + constructionInterest;
  metrics.totalCosts = metrics.totalDevelopmentCost + salesCosts;

  if (hard && sellableSF) {
    metrics.hardCostPerSF = hard / sellableSF;
  }

  // Profit analysis
  if (metrics.grossRevenue && metrics.totalCosts) {
    metrics.grossProfit = metrics.grossRevenue - metrics.totalCosts;
    metrics.profitMargin = metrics.grossProfit / metrics.grossRevenue;
    metrics.returnOnCost = metrics.grossProfit / metrics.totalDevelopmentCost;

    if (metrics.profitMargin < 0.15) {
      metrics.profitAssessment = 'THIN - Below typical 15% margin';
    } else if (metrics.profitMargin < 0.20) {
      metrics.profitAssessment = 'MARKET - Acceptable margin';
    } else {
      metrics.profitAssessment = 'STRONG - Above-market returns';
    }
  }

  // Break-even analysis
  if (metrics.totalCosts && avgSalePrice) {
    metrics.breakEvenUnits = Math.ceil(metrics.totalCosts / avgSalePrice);
    metrics.breakEvenPercent = metrics.breakEvenUnits / totalUnits;

    if (metrics.breakEvenPercent > 0.80) {
      metrics.breakEvenRisk = 'HIGH - Need >80% sell-through to break even';
    } else if (metrics.breakEvenPercent > 0.60) {
      metrics.breakEvenRisk = 'MODERATE - Break-even at 60-80%';
    } else {
      metrics.breakEvenRisk = 'LOW - Comfortable margin';
    }
  }

  // Presale status
  if (totalUnits) {
    metrics.presalesRequired = Math.ceil(totalUnits * presalesRequired);
    metrics.currentPresales = currentPresales;
    metrics.presaleProgress = currentPresales / metrics.presalesRequired;
    metrics.presalePercent = currentPresales / totalUnits;

    if (metrics.presaleProgress >= 1.0) {
      metrics.presaleStatus = 'MET - Lender requirement satisfied';
    } else if (metrics.presaleProgress >= 0.75) {
      metrics.presaleStatus = 'CLOSE - Nearly at lender threshold';
    } else {
      metrics.presaleStatus = 'IN PROGRESS - More presales needed';
    }

    // Deposit collected
    if (avgSalePrice && depositAmount) {
      metrics.depositsCollected = currentPresales * avgSalePrice * depositAmount;
    }
  }

  // Absorption / timeline
  if (totalUnits && absorptionRate) {
    metrics.absorptionRate = absorptionRate;
    metrics.monthsToSellOut = Math.ceil((totalUnits - currentPresales) / absorptionRate);
    metrics.expectedSellOutDate = `${Math.ceil(metrics.monthsToSellOut)} months from construction completion`;
  }

  // IRR estimate (simplified)
  if (metrics.grossProfit && metrics.totalDevelopmentCost && constructionPeriod && metrics.monthsToSellOut) {
    const totalMonths = constructionPeriod + (metrics.monthsToSellOut || 12);
    const equity = metrics.totalDevelopmentCost - (constructionLoan || 0);
    // Simplified IRR approximation
    const years = totalMonths / 12;
    metrics.estimatedIRR = Math.pow((equity + metrics.grossProfit) / equity, 1 / years) - 1;
    metrics.equityMultiple = (equity + metrics.grossProfit) / equity;
  }

  return metrics;
}

/**
 * Cold Storage-specific calculations
 */
function calculateColdStorageMetrics(inputs) {
  const {
    totalSF,
    freezerSF = 0,
    coolerSF = 0,
    ambientSF = 0,
    freezerRentPSF,
    coolerRentPSF,
    ambientRentPSF,
    avgRentPerSF,
    clearHeight,
    refrigerationAge,
    refrigerationSystemType,
    powerCapacity,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (totalSF) {
    // Temperature zone breakdown
    metrics.freezerPercent = freezerSF / totalSF;
    metrics.coolerPercent = coolerSF / totalSF;
    metrics.ambientPercent = ambientSF / totalSF;

    // Blended rent calculation
    if (freezerRentPSF || coolerRentPSF || ambientRentPSF) {
      const freezerRevenue = freezerSF * (freezerRentPSF || 0);
      const coolerRevenue = coolerSF * (coolerRentPSF || 0);
      const ambientRevenue = ambientSF * (ambientRentPSF || 0);
      const totalRevenue = freezerRevenue + coolerRevenue + ambientRevenue;
      metrics.blendedRentPSF = totalRevenue / totalSF;
      metrics.grossPotentialRent = totalRevenue;
    } else if (avgRentPerSF) {
      metrics.blendedRentPSF = avgRentPerSF;
      metrics.grossPotentialRent = totalSF * avgRentPerSF;
    }

    // Price per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / totalSF;
    }

    // Rent premium analysis (cold storage vs typical dry warehouse at ~$8/SF)
    const dryWarehouseBenchmark = 8;
    if (metrics.blendedRentPSF) {
      metrics.rentPremiumMultiple = metrics.blendedRentPSF / dryWarehouseBenchmark;
    }
  }

  // Clear height classification
  if (clearHeight) {
    metrics.clearHeight = clearHeight;
    if (clearHeight >= 100) {
      metrics.clearHeightClass = 'High-Rise ASRS - Fully automated';
    } else if (clearHeight >= 50) {
      metrics.clearHeightClass = 'Modern Cold Storage - ASRS capable';
    } else if (clearHeight >= 30) {
      metrics.clearHeightClass = 'Standard Cold Storage';
    } else {
      metrics.clearHeightClass = 'Older/Low-Rise - Limited racking';
    }
  }

  // Refrigeration system assessment
  if (refrigerationAge !== undefined) {
    metrics.refrigerationAge = refrigerationAge;
    const systemLife = 25; // Average useful life
    metrics.refrigerationRemainingLife = Math.max(0, systemLife - refrigerationAge);

    if (refrigerationAge > 20) {
      metrics.refrigerationRisk = 'HIGH - System replacement needed soon';
      // Estimate replacement cost at ~$50/SF for freezer
      metrics.estimatedReplacementCost = freezerSF * 50 + coolerSF * 30;
    } else if (refrigerationAge > 15) {
      metrics.refrigerationRisk = 'MEDIUM - Plan for capital reserves';
    } else {
      metrics.refrigerationRisk = 'LOW - System in good condition';
    }
  }

  // System type considerations
  if (refrigerationSystemType) {
    metrics.refrigerationSystemType = refrigerationSystemType;
    if (refrigerationSystemType === 'Ammonia') {
      metrics.systemNote = 'Ammonia: Most efficient but requires PSM/RMP compliance';
    } else if (refrigerationSystemType === 'CO2') {
      metrics.systemNote = 'CO2: Modern, efficient, lower regulatory burden';
    }
  }

  // Power density
  if (powerCapacity && totalSF) {
    metrics.powerDensity = (powerCapacity * 100) / totalSF; // Watts per SF (amps * 100 approx)
  }

  return metrics;
}

/**
 * Flex/R&D Industrial-specific calculations
 */
function calculateFlexRDMetrics(inputs) {
  const {
    totalSF,
    officeSF = 0,
    warehouseSF = 0,
    labSF = 0,
    manufacturingSF = 0,
    officeRentPSF,
    warehouseRentPSF,
    avgRentPerSF,
    clearHeight,
    tenantImprovements,
    innovationCluster,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (totalSF) {
    // Space breakdown
    metrics.officeRatio = officeSF / totalSF;
    metrics.warehouseRatio = warehouseSF / totalSF;
    metrics.labRatio = labSF / totalSF;
    metrics.manufacturingRatio = manufacturingSF / totalSF;

    // Verify flex classification (25%+ office)
    if (metrics.officeRatio < 0.25) {
      metrics.classificationNote = 'Office <25% - May not qualify as Flex';
    } else if (metrics.officeRatio > 0.60) {
      metrics.classificationNote = 'Office >60% - Consider as Office/Tech';
    } else {
      metrics.classificationNote = 'True Flex Space - 25-60% office buildout';
    }

    // Blended rent
    if (officeRentPSF && warehouseRentPSF) {
      const officeRevenue = officeSF * officeRentPSF;
      const warehouseRevenue = warehouseSF * warehouseRentPSF;
      const totalRevenue = officeRevenue + warehouseRevenue;
      metrics.blendedRentPSF = totalRevenue / totalSF;
      metrics.grossPotentialRent = totalRevenue;
    } else if (avgRentPerSF) {
      metrics.blendedRentPSF = avgRentPerSF;
      metrics.grossPotentialRent = totalSF * avgRentPerSF;
    }

    // Price per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / totalSF;
    }
  }

  // Clear height
  if (clearHeight) {
    metrics.clearHeight = clearHeight;
    if (clearHeight >= 20) {
      metrics.clearHeightClass = 'High - Good for industrial use';
    } else if (clearHeight >= 14) {
      metrics.clearHeightClass = 'Standard Flex - Typical 14-16ft';
    } else {
      metrics.clearHeightClass = 'Low - Office-like ceiling';
    }
  }

  // TI exposure
  if (tenantImprovements && totalSF) {
    metrics.totalTIExposure = tenantImprovements * totalSF;
    // Flex typically $5-20/SF vs Office $30-80/SF
    if (tenantImprovements < 5) {
      metrics.tiRisk = 'LOW - Minimal TI requirement';
    } else if (tenantImprovements <= 20) {
      metrics.tiRisk = 'MARKET - Typical flex range';
    } else {
      metrics.tiRisk = 'HIGH - Above-market TI for flex';
    }
  }

  // Innovation cluster premium
  if (innovationCluster) {
    metrics.innovationCluster = innovationCluster;
    if (innovationCluster === 'In Cluster') {
      metrics.clusterPremium = 1.15; // 15% rent premium
      metrics.clusterNote = 'In innovation cluster - commands premium rents';
    } else if (innovationCluster === 'Adjacent') {
      metrics.clusterPremium = 1.05;
      metrics.clusterNote = 'Adjacent to cluster - moderate premium';
    } else {
      metrics.clusterPremium = 1.0;
      metrics.clusterNote = 'Remote from cluster - standard pricing';
    }
  }

  return metrics;
}

/**
 * Medical Office Building-specific calculations
 */
function calculateMedicalOfficeMetrics(inputs) {
  const {
    totalSF,
    campusType,
    affiliationStrength,
    avgRentPerSF,
    walt,
    anchorTenantSF,
    anchorTenantCredit,
    hopd,
    parkingRatio,
    tenantImprovements,
    purchasePrice
  } = inputs;

  const metrics = {};

  if (totalSF) {
    // Price and rent per SF
    if (purchasePrice) {
      metrics.pricePerSF = purchasePrice / totalSF;
    }
    if (avgRentPerSF) {
      metrics.rentPerSF = avgRentPerSF;
      metrics.grossPotentialRent = totalSF * avgRentPerSF;
    }

    // Anchor tenant concentration
    if (anchorTenantSF) {
      metrics.anchorPercent = anchorTenantSF / totalSF;
      if (metrics.anchorPercent > 0.70) {
        metrics.anchorConcentration = 'HIGH - Single tenant risk';
      } else if (metrics.anchorPercent > 0.40) {
        metrics.anchorConcentration = 'MODERATE - Significant anchor';
      } else {
        metrics.anchorConcentration = 'DIVERSIFIED - Multi-tenant';
      }
    }
  }

  // Campus type premium/discount
  if (campusType) {
    metrics.campusType = campusType;
    if (campusType === 'On-Campus') {
      metrics.campusPremium = 1.10; // 10% premium for on-campus
      metrics.campusNote = 'On-campus MOB - Premium pricing, stable tenancy';
    } else if (campusType === 'Adjacent') {
      metrics.campusPremium = 1.05;
      metrics.campusNote = 'Adjacent to hospital - Good connectivity';
    } else {
      metrics.campusPremium = 1.0;
      metrics.campusNote = 'Off-campus - Must prove patient access';
    }
  }

  // Affiliation strength assessment
  if (affiliationStrength) {
    metrics.affiliationStrength = affiliationStrength;
    const affiliationScores = {
      'Owned by System': 5,
      'Master Lease': 4,
      'Affiliated Physicians': 3,
      'Independent': 1
    };
    metrics.affiliationScore = affiliationScores[affiliationStrength] || 1;
  }

  // WALT risk
  if (walt) {
    metrics.walt = walt;
    if (walt < 4) {
      metrics.waltRisk = 'HIGH - Short remaining term';
    } else if (walt < 6) {
      metrics.waltRisk = 'MEDIUM - Monitor renewals';
    } else {
      metrics.waltRisk = 'LOW - Long-term stability';
    }
  }

  // Anchor credit quality
  if (anchorTenantCredit) {
    metrics.anchorTenantCredit = anchorTenantCredit;
    if (anchorTenantCredit === 'Health System') {
      metrics.creditQuality = 'STRONG - Health system guarantee';
    } else if (anchorTenantCredit === 'Large Group Practice') {
      metrics.creditQuality = 'GOOD - Established practice';
    } else if (anchorTenantCredit === 'Small Practice') {
      metrics.creditQuality = 'MODERATE - Practice-level credit';
    } else {
      metrics.creditQuality = 'VARIABLE - Independent physicians';
    }
  }

  // HOPD premium
  if (hopd) {
    metrics.hopd = hopd;
    metrics.hopdNote = 'HOPD designation allows hospital outpatient billing rates';
    metrics.hopdPremium = 1.08; // 8% premium for HOPD properties
  }

  // Parking adequacy (medical needs 4-6 spaces per 1,000 SF)
  if (parkingRatio) {
    metrics.parkingRatio = parkingRatio;
    if (parkingRatio < 4) {
      metrics.parkingAdequacy = 'INADEQUATE - Medical typically needs 4-6/1000 SF';
    } else if (parkingRatio < 5) {
      metrics.parkingAdequacy = 'ADEQUATE - Meets minimum';
    } else {
      metrics.parkingAdequacy = 'EXCELLENT - Ample parking';
    }
  }

  // TI exposure
  if (tenantImprovements && totalSF) {
    metrics.totalTIExposure = tenantImprovements * totalSF;
    // Medical TI typically $40-100/SF (higher than standard office $30-50)
    if (tenantImprovements < 40) {
      metrics.tiAssessment = 'BELOW MARKET - May limit tenant attraction';
    } else if (tenantImprovements <= 80) {
      metrics.tiAssessment = 'MARKET - Typical MOB range';
    } else {
      metrics.tiAssessment = 'PREMIUM - High-end medical buildout';
    }
  }

  return metrics;
}

/**
 * Calculate returns with sector context
 */
export function calculateReturns(model) {
  const baseCalc = calculateUnderwriting(model);
  const sectorMetrics = calculateSectorMetrics(model);

  return {
    ...baseCalc.returns,
    ...baseCalc.debtMetrics,
    noi: baseCalc.income?.netOperatingIncome,
    sector: sectorMetrics.sector,
    sectorMetrics: sectorMetrics.metrics,
    warnings: [...(baseCalc.warnings || []), ...(sectorMetrics.warnings || [])]
  };
}

export default {
  calculateUnderwriting,
  calculateScenario,
  compareScenarios,
  sensitivityAnalysis,
  calculateIRR,
  projectDetailedCashFlows,
  calculateSectorMetrics,
  calculateReturns
};
