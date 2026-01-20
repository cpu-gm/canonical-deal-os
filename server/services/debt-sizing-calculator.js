/**
 * Debt Sizing Calculator
 *
 * Calculates maximum loan proceeds based on lender constraints:
 * - DSCR (Debt Service Coverage Ratio)
 * - LTV (Loan-to-Value)
 * - Debt Yield
 *
 * Based on institutional lending standards from:
 * - OCC Comptroller's Handbook for CRE Lending
 * - FDIC Real Estate Lending Standards (12 CFR Part 365)
 * - CMBS/Agency underwriting guidelines
 *
 * Supports multiple loan scenarios: Agency, CMBS, Bank, Bridge, Construction
 */

/**
 * Standard lender constraint profiles by loan type
 */
export const LENDER_PROFILES = {
  // Agency loans (Fannie Mae, Freddie Mac)
  AGENCY: {
    name: 'Agency (Fannie/Freddie)',
    description: 'GSE multifamily loans with competitive rates',
    constraints: {
      maxLTV: 0.80,
      minDSCR: 1.25,
      minDebtYield: 0.065,
      amortization: 30,
      maxTerm: 10,
      ioPeriod: 0
    },
    eligibility: {
      propertyTypes: ['MULTIFAMILY', 'SENIORS_HOUSING', 'MANUFACTURED_HOUSING', 'STUDENT_HOUSING'],
      minUnits: 5,
      stabilized: true
    },
    pricing: {
      spreadOverTreasury: { min: 0.015, max: 0.025 },
      originationFee: 0.01
    }
  },

  // CMBS loans
  CMBS: {
    name: 'CMBS',
    description: 'Commercial mortgage-backed securities',
    constraints: {
      maxLTV: 0.75,
      minDSCR: 1.25,
      minDebtYield: 0.08, // Historically 9-10%, now more flexible
      amortization: 30,
      maxTerm: 10,
      ioPeriod: 0 // Can be 0-5 years
    },
    eligibility: {
      propertyTypes: ['MULTIFAMILY', 'OFFICE', 'RETAIL', 'INDUSTRIAL', 'HOTEL', 'SELF_STORAGE'],
      minLoan: 2000000,
      stabilized: true
    },
    pricing: {
      spreadOverTreasury: { min: 0.018, max: 0.035 },
      originationFee: 0.01
    }
  },

  // Bank/Life Company loans
  BANK: {
    name: 'Bank / Life Company',
    description: 'Portfolio loans from banks and life insurance companies',
    constraints: {
      maxLTV: 0.70,
      minDSCR: 1.30,
      minDebtYield: 0.09,
      amortization: 25,
      maxTerm: 10,
      ioPeriod: 0
    },
    eligibility: {
      propertyTypes: ['ALL'],
      minLoan: 5000000,
      stabilized: true
    },
    pricing: {
      spreadOverTreasury: { min: 0.015, max: 0.030 },
      originationFee: 0.0075
    }
  },

  // Bridge loans
  BRIDGE: {
    name: 'Bridge / Transitional',
    description: 'Short-term loans for value-add or transitional assets',
    constraints: {
      maxLTV: 0.80, // Based on as-stabilized value
      maxLTC: 0.90, // Loan-to-Cost for value-add
      minDSCR: 1.10, // Lower DSCR for transitional
      minDebtYield: 0.06,
      amortization: 0, // Interest-only
      maxTerm: 3,
      ioPeriod: 36 // Full term IO
    },
    eligibility: {
      propertyTypes: ['ALL'],
      minLoan: 1000000,
      stabilized: false
    },
    pricing: {
      spreadOverSOFR: { min: 0.025, max: 0.045 },
      originationFee: 0.015,
      exitFee: 0.01
    }
  },

  // Construction loans
  CONSTRUCTION: {
    name: 'Construction',
    description: 'Loans for ground-up development',
    constraints: {
      maxLTC: 0.70, // Loan-to-Cost
      maxLTV: 0.60, // Based on projected value
      minDSCR: 1.20, // Based on stabilized NOI
      minDebtYield: 0.08,
      amortization: 0, // Interest-only during construction
      maxTerm: 4, // 3-year construction + 1-year extension
      ioPeriod: 48
    },
    eligibility: {
      propertyTypes: ['ALL'],
      minLoan: 5000000,
      requiresGuaranty: true,
      presalesRequired: 0.50 // For condo development
    },
    pricing: {
      spreadOverSOFR: { min: 0.030, max: 0.050 },
      originationFee: 0.02,
      constructionFee: 0.01
    }
  },

  // Aggressive/High-LTV
  HIGH_LEVERAGE: {
    name: 'High Leverage / Mezzanine Stack',
    description: 'Senior + mezzanine combination for higher leverage',
    constraints: {
      maxLTV: 0.85,
      minDSCR: 1.15,
      minDebtYield: 0.055,
      amortization: 30,
      maxTerm: 5,
      ioPeriod: 24
    },
    eligibility: {
      propertyTypes: ['MULTIFAMILY', 'INDUSTRIAL'],
      minLoan: 10000000,
      stabilized: true,
      sponsorExperience: 'required'
    },
    pricing: {
      blendedRate: 'senior + mezzanine',
      originationFee: 0.02
    }
  },

  // Conservative Core
  CORE_CONSERVATIVE: {
    name: 'Core / Conservative',
    description: 'Low-leverage loans for core assets',
    constraints: {
      maxLTV: 0.55,
      minDSCR: 1.50,
      minDebtYield: 0.10,
      amortization: 25,
      maxTerm: 10,
      ioPeriod: 0
    },
    eligibility: {
      propertyTypes: ['ALL'],
      minLoan: 25000000,
      stabilized: true
    },
    pricing: {
      spreadOverTreasury: { min: 0.012, max: 0.020 },
      originationFee: 0.005
    }
  }
};

/**
 * Calculate maximum loan proceeds based on all constraints
 *
 * @param {Object} params - Property and loan parameters
 * @returns {Object} - Loan sizing results with constraint analysis
 */
export function calculateDebtSizing(params) {
  const {
    // Property metrics
    noi,
    propertyValue,
    purchasePrice,

    // Loan parameters
    interestRate,
    amortization = 30,
    ioPeriod = 0,
    loanTerm = 10,

    // Optional lender constraints (defaults to CMBS)
    lenderProfile = 'CMBS',
    customConstraints = null,

    // Optional development metrics (for construction loans)
    totalCost = null,
    stabilizedNOI = null, // For bridge/construction
    stabilizedValue = null
  } = params;

  // Get constraint profile
  const profile = LENDER_PROFILES[lenderProfile] || LENDER_PROFILES.CMBS;
  const constraints = customConstraints || profile.constraints;

  // Validate required inputs
  if (!noi || noi <= 0) {
    return { error: 'NOI is required and must be positive' };
  }
  if (!interestRate || interestRate <= 0) {
    return { error: 'Interest rate is required and must be positive' };
  }

  const value = propertyValue || purchasePrice;
  if (!value || value <= 0) {
    return { error: 'Property value or purchase price is required' };
  }

  // Calculate debt service constant
  const debtConstant = calculateDebtConstant(interestRate, amortization, ioPeriod);

  // Calculate max loan by each constraint
  const results = {
    profile: profile.name,
    constraints: constraints,
    sizing: {},
    binding: null,
    maxProceeds: 0
  };

  // 1. LTV Constraint
  const ltvMaxLoan = value * constraints.maxLTV;
  results.sizing.ltv = {
    constraint: `Max LTV ${(constraints.maxLTV * 100).toFixed(0)}%`,
    maxLoan: ltvMaxLoan,
    impliedLTV: ltvMaxLoan / value,
    formula: `${formatCurrency(value)} × ${(constraints.maxLTV * 100).toFixed(0)}%`
  };

  // 2. DSCR Constraint
  // Max loan where DSCR = min required
  // DSCR = NOI / Debt Service
  // Debt Service = Loan Amount × Debt Constant
  // Loan = NOI / (min DSCR × Debt Constant)
  const dscrMaxLoan = noi / (constraints.minDSCR * debtConstant);
  results.sizing.dscr = {
    constraint: `Min DSCR ${constraints.minDSCR.toFixed(2)}x`,
    maxLoan: dscrMaxLoan,
    impliedDSCR: noi / (dscrMaxLoan * debtConstant),
    formula: `${formatCurrency(noi)} ÷ (${constraints.minDSCR}x × ${(debtConstant * 100).toFixed(2)}%)`,
    debtConstant: debtConstant,
    annualDebtService: dscrMaxLoan * debtConstant
  };

  // 3. Debt Yield Constraint
  // Debt Yield = NOI / Loan Amount
  // Loan = NOI / min Debt Yield
  const dyMaxLoan = noi / constraints.minDebtYield;
  results.sizing.debtYield = {
    constraint: `Min Debt Yield ${(constraints.minDebtYield * 100).toFixed(1)}%`,
    maxLoan: dyMaxLoan,
    impliedDebtYield: noi / dyMaxLoan,
    formula: `${formatCurrency(noi)} ÷ ${(constraints.minDebtYield * 100).toFixed(1)}%`
  };

  // 4. LTC Constraint (for construction/bridge)
  if (constraints.maxLTC && totalCost) {
    const ltcMaxLoan = totalCost * constraints.maxLTC;
    results.sizing.ltc = {
      constraint: `Max LTC ${(constraints.maxLTC * 100).toFixed(0)}%`,
      maxLoan: ltcMaxLoan,
      impliedLTC: ltcMaxLoan / totalCost,
      formula: `${formatCurrency(totalCost)} × ${(constraints.maxLTC * 100).toFixed(0)}%`
    };
  }

  // Determine binding constraint (lowest max loan)
  const allSizings = Object.entries(results.sizing);
  const binding = allSizings.reduce((min, [key, sizing]) => {
    if (!min || sizing.maxLoan < min.sizing.maxLoan) {
      return { key, sizing };
    }
    return min;
  }, null);

  results.binding = {
    constraint: binding.key.toUpperCase(),
    description: binding.sizing.constraint,
    reason: getBindingReason(binding.key)
  };
  results.maxProceeds = Math.round(binding.sizing.maxLoan);

  // Calculate resulting metrics at max proceeds
  const finalLoan = results.maxProceeds;
  const annualDebtService = finalLoan * debtConstant;

  results.finalMetrics = {
    loanAmount: finalLoan,
    ltv: finalLoan / value,
    dscr: noi / annualDebtService,
    debtYield: noi / finalLoan,
    annualDebtService: annualDebtService,
    monthlyPayment: annualDebtService / 12,
    equityRequired: (purchasePrice || value) - finalLoan,
    equityPercent: 1 - (finalLoan / (purchasePrice || value)),
    ltc: totalCost ? finalLoan / totalCost : null
  };

  // Add stress test results
  results.stressTest = performDebtStressTest(finalLoan, noi, value, interestRate, constraints);

  // Add sizing at different constraint levels
  results.scenarios = generateSizingScenarios(noi, value, interestRate, amortization, ioPeriod);

  return results;
}

/**
 * Calculate debt constant (annual debt service as % of principal)
 */
function calculateDebtConstant(interestRate, amortization, ioPeriod = 0) {
  if (ioPeriod > 0 || amortization === 0) {
    // Interest-only: constant = interest rate
    return interestRate;
  }

  // Amortizing loan: calculate payment
  const monthlyRate = interestRate / 12;
  const numPayments = amortization * 12;

  const monthlyPaymentFactor = (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) /
    (Math.pow(1 + monthlyRate, numPayments) - 1);

  return monthlyPaymentFactor * 12; // Annual debt constant
}

/**
 * Get explanation for binding constraint
 */
function getBindingReason(constraintKey) {
  const reasons = {
    ltv: 'Loan amount limited by property value leverage',
    dscr: 'Loan amount limited by cash flow coverage requirement',
    debtYield: 'Loan amount limited by yield-on-cost requirement',
    ltc: 'Loan amount limited by project cost leverage'
  };
  return reasons[constraintKey] || 'Unknown constraint';
}

/**
 * Perform stress tests on the sized loan
 */
function performDebtStressTest(loanAmount, noi, value, interestRate, constraints) {
  const tests = [];

  // Test 1: NOI decline
  const noiDeclineScenarios = [0.10, 0.20, 0.30]; // 10%, 20%, 30% decline
  for (const decline of noiDeclineScenarios) {
    const stressedNOI = noi * (1 - decline);
    const debtService = loanAmount * interestRate; // IO worst case
    const stressedDSCR = stressedNOI / debtService;

    tests.push({
      scenario: `NOI -${decline * 100}%`,
      stressedNOI,
      stressedDSCR,
      passesMinDSCR: stressedDSCR >= constraints.minDSCR,
      passesBreakeven: stressedDSCR >= 1.0
    });
  }

  // Test 2: Rate increase
  const rateIncreases = [0.01, 0.02, 0.03]; // +100, +200, +300 bps
  for (const increase of rateIncreases) {
    const stressedRate = interestRate + increase;
    const stressedDebtService = loanAmount * stressedRate;
    const stressedDSCR = noi / stressedDebtService;

    tests.push({
      scenario: `Rate +${increase * 100}bps`,
      stressedRate,
      stressedDSCR,
      passesMinDSCR: stressedDSCR >= constraints.minDSCR,
      passesBreakeven: stressedDSCR >= 1.0
    });
  }

  // Test 3: Value decline (affects LTV covenant)
  const valueDeclines = [0.15, 0.25, 0.35]; // 15%, 25%, 35% decline
  for (const decline of valueDeclines) {
    const stressedValue = value * (1 - decline);
    const stressedLTV = loanAmount / stressedValue;

    tests.push({
      scenario: `Value -${decline * 100}%`,
      stressedValue,
      stressedLTV,
      breachesLTV: stressedLTV > 1.0, // Over 100% LTV
      inDefaultTerritory: stressedLTV > 0.90
    });
  }

  // Calculate breakeven metrics
  const breakeven = {
    noiBreakeven: loanAmount * interestRate, // Minimum NOI to cover debt service
    noiDeclineToBreakeven: (noi - loanAmount * interestRate) / noi,
    maxRateIncrease: (noi / loanAmount) - 1, // Rate where DSCR = 1.0
    valueDeclineToBreachLTV: 1 - (loanAmount / value) / constraints.maxLTV
  };

  return {
    tests,
    breakeven,
    summary: {
      worstCaseDSCR: Math.min(...tests.filter(t => t.stressedDSCR).map(t => t.stressedDSCR)),
      passesAllStress: tests.every(t => t.passesBreakeven !== false && !t.breachesLTV)
    }
  };
}

/**
 * Generate sizing scenarios at different constraint levels
 */
function generateSizingScenarios(noi, value, interestRate, amortization, ioPeriod) {
  const debtConstant = calculateDebtConstant(interestRate, amortization, ioPeriod);

  const scenarios = [];

  // LTV scenarios
  [0.55, 0.60, 0.65, 0.70, 0.75, 0.80].forEach(ltv => {
    const loan = value * ltv;
    const debtService = loan * debtConstant;
    scenarios.push({
      scenario: `${(ltv * 100).toFixed(0)}% LTV`,
      loan,
      ltv,
      dscr: noi / debtService,
      debtYield: noi / loan
    });
  });

  // DSCR scenarios
  [1.15, 1.20, 1.25, 1.30, 1.35, 1.40].forEach(dscr => {
    const loan = noi / (dscr * debtConstant);
    scenarios.push({
      scenario: `${dscr.toFixed(2)}x DSCR`,
      loan,
      ltv: loan / value,
      dscr,
      debtYield: noi / loan
    });
  });

  // Debt yield scenarios
  [0.07, 0.08, 0.09, 0.10, 0.11, 0.12].forEach(dy => {
    const loan = noi / dy;
    const debtService = loan * debtConstant;
    scenarios.push({
      scenario: `${(dy * 100).toFixed(0)}% DY`,
      loan,
      ltv: loan / value,
      dscr: noi / debtService,
      debtYield: dy
    });
  });

  return scenarios;
}

/**
 * Compare debt sizing across multiple lender profiles
 */
export function compareLenderProfiles(params) {
  const profiles = Object.keys(LENDER_PROFILES);
  const results = [];

  for (const profileKey of profiles) {
    const profile = LENDER_PROFILES[profileKey];

    // Check eligibility
    if (params.propertyType && profile.eligibility.propertyTypes !== 'ALL') {
      if (!profile.eligibility.propertyTypes.includes(params.propertyType)) {
        results.push({
          profile: profile.name,
          eligible: false,
          reason: 'Property type not eligible'
        });
        continue;
      }
    }

    const sizing = calculateDebtSizing({
      ...params,
      lenderProfile: profileKey
    });

    if (sizing.error) {
      results.push({
        profile: profile.name,
        eligible: false,
        reason: sizing.error
      });
      continue;
    }

    results.push({
      profile: profile.name,
      eligible: true,
      maxProceeds: sizing.maxProceeds,
      bindingConstraint: sizing.binding.constraint,
      ltv: sizing.finalMetrics.ltv,
      dscr: sizing.finalMetrics.dscr,
      debtYield: sizing.finalMetrics.debtYield,
      equityRequired: sizing.finalMetrics.equityRequired,
      description: profile.description
    });
  }

  // Sort by max proceeds (highest first)
  results.sort((a, b) => (b.maxProceeds || 0) - (a.maxProceeds || 0));

  return {
    results,
    recommended: results.find(r => r.eligible),
    maxProceeds: Math.max(...results.filter(r => r.eligible).map(r => r.maxProceeds))
  };
}

/**
 * Calculate optimal capital stack with multiple tranches
 */
export function calculateCapitalStack(params) {
  const {
    purchasePrice,
    noi,
    targetLeverage = 0.75, // Total leverage target
    seniorMaxLTV = 0.65,
    mezzRate = 0.12,
    preferredRate = 0.10,
    interestRate = 0.065
  } = params;

  // Senior debt (constrained by LTV and DSCR)
  const seniorSizing = calculateDebtSizing({
    ...params,
    lenderProfile: 'BANK'
  });

  const seniorAmount = Math.min(
    seniorSizing.maxProceeds,
    purchasePrice * seniorMaxLTV
  );

  // Remaining capital need
  const equityGap = purchasePrice - seniorAmount;
  const targetMezzAmount = Math.max(0, purchasePrice * targetLeverage - seniorAmount);

  // Mezzanine debt
  const mezzAmount = Math.min(targetMezzAmount, equityGap * 0.5);

  // Preferred equity
  const preferredAmount = Math.min(
    (equityGap - mezzAmount) * 0.5,
    purchasePrice * 0.10
  );

  // Common equity
  const commonEquity = purchasePrice - seniorAmount - mezzAmount - preferredAmount;

  // Calculate blended cost
  const seniorCost = seniorAmount * interestRate;
  const mezzCost = mezzAmount * mezzRate;
  const totalDebtCost = seniorCost + mezzCost;
  const blendedDebtCost = (seniorAmount + mezzAmount) > 0
    ? totalDebtCost / (seniorAmount + mezzAmount)
    : 0;

  // Cash flow waterfall
  const cashAfterSenior = noi - seniorCost;
  const cashAfterMezz = cashAfterSenior - mezzCost;
  const cashAfterPref = cashAfterMezz - (preferredAmount * preferredRate);
  const cashToCommon = Math.max(0, cashAfterPref);

  return {
    stack: {
      senior: {
        amount: seniorAmount,
        percent: seniorAmount / purchasePrice,
        rate: interestRate,
        annualCost: seniorCost
      },
      mezzanine: {
        amount: mezzAmount,
        percent: mezzAmount / purchasePrice,
        rate: mezzRate,
        annualCost: mezzCost
      },
      preferred: {
        amount: preferredAmount,
        percent: preferredAmount / purchasePrice,
        rate: preferredRate,
        annualCost: preferredAmount * preferredRate
      },
      common: {
        amount: commonEquity,
        percent: commonEquity / purchasePrice,
        residualCash: cashToCommon,
        impliedYield: commonEquity > 0 ? cashToCommon / commonEquity : 0
      }
    },
    totals: {
      purchasePrice,
      totalDebt: seniorAmount + mezzAmount,
      totalEquity: preferredAmount + commonEquity,
      leverage: (seniorAmount + mezzAmount) / purchasePrice,
      blendedDebtCost,
      allInDSCR: noi / totalDebtCost
    },
    cashFlow: {
      noi,
      cashAfterSenior,
      cashAfterMezz,
      cashAfterPref,
      cashToCommon
    }
  };
}

// Helper function
function formatCurrency(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

export default {
  calculateDebtSizing,
  compareLenderProfiles,
  calculateCapitalStack,
  LENDER_PROFILES
};
