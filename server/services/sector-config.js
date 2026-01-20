/**
 * Sector Configuration for Real Estate Underwriting
 *
 * Each sector has unique:
 * - Primary metrics (what matters most)
 * - Input fields (sector-specific data points)
 * - Benchmarks (typical ranges for key metrics)
 * - Risk factors (what to watch for)
 * - Lease structures (how tenants typically pay)
 *
 * Based on research from Adventures in CRE and industry sources.
 */

export const PROPERTY_SECTORS = {
  // ==================== CORE SECTORS ====================

  MULTIFAMILY: {
    code: 'MULTIFAMILY',
    name: 'Multifamily / Apartments',
    description: 'Residential rental properties with multiple units',
    subsectors: ['Garden', 'Mid-Rise', 'High-Rise', 'Student Housing', 'Seniors Housing', 'Affordable', 'Build-to-Rent'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'dscr', 'pricePerUnit', 'rentPerUnit'],

    uniqueInputs: {
      unitCount: { label: 'Total Units', type: 'number', required: true },
      avgUnitSize: { label: 'Avg Unit Size (SF)', type: 'number' },
      unitMix: { label: 'Unit Mix', type: 'unitMix', description: 'Studio, 1BR, 2BR, 3BR breakdown' },
      avgRentPerUnit: { label: 'Avg Rent/Unit', type: 'currency' },
      avgRentPerSF: { label: 'Avg Rent/SF', type: 'currency' },
      occupancyRate: { label: 'Occupancy Rate', type: 'percent', default: 0.95 },
      concessions: { label: 'Concessions', type: 'currency', description: 'Free rent, move-in specials' },
      turnoverRate: { label: 'Annual Turnover', type: 'percent', default: 0.50 },
      turnCost: { label: 'Cost Per Turn', type: 'currency', default: 2500 },
      lossToLease: { label: 'Loss to Lease', type: 'percent', description: 'Below-market existing rents' }
    },

    benchmarks: {
      capRate: { min: 0.04, max: 0.07, typical: 0.05 },
      occupancy: { min: 0.90, max: 0.98, typical: 0.95 },
      expenseRatio: { min: 0.30, max: 0.45, typical: 0.38 },
      dscr: { min: 1.20, max: 1.50, typical: 1.25 },
      pricePerUnit: { description: 'Varies widely by market - $100K-$500K+' }
    },

    riskFactors: [
      'Rent control/stabilization regulations',
      'Concession burn-off timing',
      'Turnover costs and lease-up velocity',
      'Utility passthrough limitations',
      'Age and deferred maintenance'
    ],

    leaseStructure: 'GROSS',
    typicalLeaseTerm: 12, // months

    calculations: {
      effectiveGrossIncome: 'grossPotentialRent * (1 - vacancyRate) - concessions + otherIncome',
      pricePerUnit: 'purchasePrice / unitCount',
      rentPerUnit: 'grossPotentialRent / unitCount / 12'
    }
  },

  OFFICE: {
    code: 'OFFICE',
    name: 'Office',
    description: 'Commercial office buildings for business tenants',
    subsectors: ['Class A CBD', 'Class A Suburban', 'Class B', 'Class C', 'Medical Office', 'Life Sciences'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'dscr', 'pricePerSF', 'rentPerSF', 'walt'],

    uniqueInputs: {
      rentableSF: { label: 'Rentable SF', type: 'number', required: true },
      usableSF: { label: 'Usable SF', type: 'number' },
      loadFactor: { label: 'Load Factor', type: 'percent', default: 0.15 },
      buildingClass: { label: 'Building Class', type: 'select', options: ['A', 'B', 'C'] },
      avgRentPerSF: { label: 'Avg Rent/SF (Annual)', type: 'currency' },
      parkingRatio: { label: 'Parking Ratio', type: 'number', description: 'Spaces per 1,000 SF' },
      tenantImprovements: { label: 'TI Allowance/SF', type: 'currency', description: 'New lease TI budget' },
      leasingCommissions: { label: 'Leasing Commissions', type: 'percent', default: 0.05 },
      freeRent: { label: 'Free Rent (months)', type: 'number', default: 3 },
      walt: { label: 'Weighted Avg Lease Term', type: 'number', description: 'Years remaining' },
      tenantConcentration: { label: 'Largest Tenant %', type: 'percent' }
    },

    benchmarks: {
      capRate: { min: 0.055, max: 0.09, typical: 0.07 },
      occupancy: { min: 0.80, max: 0.95, typical: 0.88 },
      expenseRatio: { min: 0.35, max: 0.50, typical: 0.42 },
      dscr: { min: 1.25, max: 1.50, typical: 1.30 },
      tiAllowance: { min: 30, max: 80, typical: 50, unit: '$/SF' },
      walt: { min: 3, max: 10, typical: 5, unit: 'years' }
    },

    riskFactors: [
      'Work from home / hybrid trends',
      'Tenant credit quality and concentration',
      'Lease rollover clustering',
      'TI/LC capital requirements',
      'Building obsolescence (tech infrastructure)',
      'ESG requirements and retrofits'
    ],

    leaseStructure: 'FULL_SERVICE_GROSS', // or MODIFIED_GROSS, NNN
    typicalLeaseTerm: 60, // months (5 years)

    calculations: {
      effectiveRent: 'baseRent - (tiAllowance + freeRent * monthlyRent) / leaseTerm',
      pricePerSF: 'purchasePrice / rentableSF'
    }
  },

  INDUSTRIAL: {
    code: 'INDUSTRIAL',
    name: 'Industrial',
    description: 'Warehouse, distribution, and manufacturing facilities',
    subsectors: ['Warehouse', 'Distribution', 'Last Mile', 'Cold Storage', 'Manufacturing', 'Flex', 'Data Center'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'dscr', 'pricePerSF', 'rentPerSF', 'clearHeight'],

    uniqueInputs: {
      totalSF: { label: 'Total SF', type: 'number', required: true },
      officeSF: { label: 'Office SF', type: 'number' },
      warehouseSF: { label: 'Warehouse SF', type: 'number' },
      clearHeight: { label: 'Clear Height (ft)', type: 'number', description: 'Ceiling height for racking' },
      dockDoors: { label: 'Dock Doors', type: 'number' },
      driveInDoors: { label: 'Drive-In Doors', type: 'number' },
      landToBuilding: { label: 'Land to Building Ratio', type: 'number' },
      trailerParking: { label: 'Trailer Parking Spaces', type: 'number' },
      avgRentPerSF: { label: 'Avg Rent/SF (Annual)', type: 'currency' },
      tenantImprovements: { label: 'TI Allowance/SF', type: 'currency' },
      powerCapacity: { label: 'Power (Amps)', type: 'number' },
      sprinklered: { label: 'Sprinklered', type: 'boolean' },
      esfr: { label: 'ESFR Sprinklers', type: 'boolean', description: 'Early Suppression Fast Response' }
    },

    benchmarks: {
      capRate: { min: 0.04, max: 0.065, typical: 0.05 },
      occupancy: { min: 0.92, max: 0.99, typical: 0.96 },
      expenseRatio: { min: 0.15, max: 0.25, typical: 0.18 },
      dscr: { min: 1.25, max: 1.50, typical: 1.35 },
      clearHeight: { min: 24, max: 40, typical: 32, unit: 'feet' }
    },

    riskFactors: [
      'E-commerce demand shifts',
      'Automation impact on space needs',
      'Clear height adequacy for modern logistics',
      'Loading and truck court configuration',
      'Power capacity for cold storage/data',
      'Environmental contamination history'
    ],

    leaseStructure: 'NNN',
    typicalLeaseTerm: 84, // months (7 years)

    calculations: {
      officeRatio: 'officeSF / totalSF',
      dockRatio: 'dockDoors / (totalSF / 10000)'
    }
  },

  RETAIL: {
    code: 'RETAIL',
    name: 'Retail',
    description: 'Shopping centers, strip centers, and standalone retail',
    subsectors: ['Regional Mall', 'Power Center', 'Neighborhood Center', 'Strip Center', 'Single Tenant', 'Grocery Anchored', 'Lifestyle Center'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'dscr', 'pricePerSF', 'rentPerSF', 'salesPerSF', 'occupancyCost'],

    uniqueInputs: {
      gla: { label: 'Gross Leasable Area (SF)', type: 'number', required: true },
      anchorSF: { label: 'Anchor Tenant SF', type: 'number' },
      inlineSF: { label: 'Inline Tenant SF', type: 'number' },
      anchorRent: { label: 'Anchor Rent/SF', type: 'currency' },
      inlineRent: { label: 'Inline Rent/SF', type: 'currency' },
      percentRent: { label: 'Percentage Rent', type: 'percent', description: '% of sales above breakpoint' },
      breakpoint: { label: 'Breakpoint Sales/SF', type: 'currency' },
      cam: { label: 'CAM/SF', type: 'currency' },
      tenantSales: { label: 'Tenant Sales/SF', type: 'currency' },
      occupancyCostRatio: { label: 'Occupancy Cost Ratio', type: 'percent' },
      coTenancy: { label: 'Co-Tenancy Clauses', type: 'boolean' },
      exclusives: { label: 'Exclusive Use Restrictions', type: 'text' },
      kickout: { label: 'Kickout Rights', type: 'boolean' }
    },

    benchmarks: {
      capRate: { min: 0.055, max: 0.085, typical: 0.07 },
      occupancy: { min: 0.85, max: 0.97, typical: 0.92 },
      expenseRatio: { min: 0.20, max: 0.35, typical: 0.25 },
      dscr: { min: 1.25, max: 1.50, typical: 1.30 },
      occupancyCostRatio: { min: 0.08, max: 0.15, typical: 0.10, description: 'Total rent / tenant sales' }
    },

    riskFactors: [
      'E-commerce competition',
      'Anchor tenant bankruptcy risk',
      'Co-tenancy clause exposure',
      'Percentage rent volatility',
      'Parking adequacy',
      'Trade area demographics shift'
    ],

    leaseStructure: 'NNN', // with percentage rent
    typicalLeaseTerm: 120, // months (10 years for anchors)

    calculations: {
      occupancyCost: '(baseRent + cam + taxes + insurance) / tenantSales',
      effectiveRent: 'baseRent + percentRent'
    }
  },

  HOTEL: {
    code: 'HOTEL',
    name: 'Hotel / Hospitality',
    description: 'Hotels, resorts, and hospitality properties',
    subsectors: ['Full Service', 'Select Service', 'Limited Service', 'Extended Stay', 'Resort', 'Boutique'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerKey', 'revpar', 'adr', 'occupancy', 'goppar'],

    uniqueInputs: {
      roomCount: { label: 'Room Count (Keys)', type: 'number', required: true },
      adr: { label: 'Average Daily Rate', type: 'currency' },
      occupancyRate: { label: 'Occupancy Rate', type: 'percent' },
      revpar: { label: 'RevPAR', type: 'currency', calculated: true },
      roomRevenue: { label: 'Room Revenue', type: 'currency' },
      fbRevenue: { label: 'F&B Revenue', type: 'currency' },
      otherRevenue: { label: 'Other Revenue', type: 'currency', description: 'Parking, spa, meeting rooms' },
      departmentalExpenses: { label: 'Departmental Expenses', type: 'currency' },
      undistributedExpenses: { label: 'Undistributed Expenses', type: 'currency' },
      managementFee: { label: 'Management Fee %', type: 'percent', default: 0.03 },
      franchiseFee: { label: 'Franchise Fee %', type: 'percent', default: 0.05 },
      ffAndE: { label: 'FF&E Reserve %', type: 'percent', default: 0.04 },
      goppar: { label: 'GOPPAR', type: 'currency', calculated: true },
      pip: { label: 'PIP Estimate', type: 'currency', description: 'Property Improvement Plan' },
      brand: { label: 'Brand/Flag', type: 'text' },
      starRating: { label: 'Star Rating', type: 'select', options: ['Economy', 'Midscale', 'Upper Midscale', 'Upscale', 'Upper Upscale', 'Luxury'] }
    },

    benchmarks: {
      capRate: { min: 0.065, max: 0.10, typical: 0.08 },
      occupancy: { min: 0.55, max: 0.80, typical: 0.68 },
      adr: { description: 'Highly market dependent' },
      gopMargin: { min: 0.30, max: 0.50, typical: 0.38 },
      ffAndEReserve: { min: 0.03, max: 0.05, typical: 0.04 }
    },

    riskFactors: [
      'Economic cycle sensitivity',
      'Seasonal demand patterns',
      'Brand/franchise requirements',
      'PIP capital requirements',
      'Competition from Airbnb/VRBO',
      'Group/convention demand',
      'Travel pattern changes'
    ],

    leaseStructure: 'OPERATING', // Not traditional lease
    managementStructure: true,

    calculations: {
      revpar: 'adr * occupancyRate',
      gop: 'totalRevenue - departmentalExpenses - undistributedExpenses - managementFee',
      goppar: 'gop / roomCount / 365',
      pricePerKey: 'purchasePrice / roomCount',
      noiMargin: 'noi / totalRevenue'
    }
  },

  // ==================== SPECIALTY SECTORS ====================

  DATA_CENTER: {
    code: 'DATA_CENTER',
    name: 'Data Center',
    description: 'Mission-critical facilities for IT infrastructure and cloud computing',
    subsectors: ['Hyperscale', 'Colocation', 'Enterprise', 'Edge', 'AI/GPU Cluster', 'Carrier Hotel'],

    primaryMetrics: ['irr', 'cashOnCash', 'pricePerKW', 'noiPerKW', 'pue', 'yieldOnCost', 'wue'],

    uniqueInputs: {
      // Power metrics
      itLoadKW: { label: 'IT Load (kW)', type: 'number', required: true, description: 'Critical IT power capacity' },
      totalMW: { label: 'Total Capacity (MW)', type: 'number' },
      contractedMW: { label: 'Contracted/Leased MW', type: 'number' },
      utilityPowerMW: { label: 'Utility Power Available (MW)', type: 'number' },

      // Efficiency metrics
      pue: { label: 'PUE', type: 'number', default: 1.4, description: 'Power Usage Effectiveness (industry avg 1.56, hyperscale 1.09)' },
      wue: { label: 'WUE', type: 'number', description: 'Water Usage Effectiveness (L/kWh)' },
      cue: { label: 'CUE', type: 'number', description: 'Carbon Usage Effectiveness' },
      renewablePercent: { label: 'Renewable Energy %', type: 'percent', description: 'Percentage from renewable sources' },

      // Physical specs
      totalSF: { label: 'Total Building SF', type: 'number' },
      whitespaceRatio: { label: 'White Space Ratio', type: 'percent', description: 'Raised floor / total SF' },
      raisedFloorHeight: { label: 'Raised Floor Height (inches)', type: 'number', default: 24 },
      clearHeight: { label: 'Clear Height (ft)', type: 'number' },

      // Infrastructure
      uptimeTier: { label: 'Uptime Tier', type: 'select', options: ['Tier I', 'Tier II', 'Tier III', 'Tier III+', 'Tier IV'] },
      redundancy: { label: 'Power Redundancy', type: 'select', options: ['N', 'N+1', '2N', '2N+1'] },
      coolingType: { label: 'Cooling Type', type: 'select', options: ['Air (CRAC)', 'In-Row', 'Liquid (DLC)', 'Immersion', 'Hybrid'] },
      generatorCount: { label: 'Diesel Generators', type: 'number' },
      generatorFuelDays: { label: 'Fuel Autonomy (Days)', type: 'number' },
      upsCapacityMinutes: { label: 'UPS Runtime (Minutes)', type: 'number' },

      // Connectivity
      fiberCarriers: { label: 'Fiber Carriers', type: 'number' },
      fiberDucts: { label: 'Fiber Duct Entry Points', type: 'number' },
      crossConnects: { label: 'Cross Connects Available', type: 'number' },
      meetMeRoom: { label: 'Meet-Me Room', type: 'boolean' },
      cloudOnRamps: { label: 'Cloud On-Ramps (AWS, Azure, GCP)', type: 'select', options: ['None', '1 Provider', '2 Providers', 'All 3 Major'] },

      // Revenue
      ratePerKW: { label: 'Rate per kW (Monthly)', type: 'currency', description: 'Typical $100-200/kW' },
      powerPassthrough: { label: 'Power Pass-Through', type: 'boolean', description: 'Customer pays power directly' },
      powerCost: { label: 'Utility Cost/kWh', type: 'currency' },
      crossConnectFee: { label: 'Cross Connect Fee (Monthly)', type: 'currency' },
      smartHandsFee: { label: 'Smart Hands Rate (Hourly)', type: 'currency' },

      // Tenancy
      tenantType: { label: 'Primary Tenant Type', type: 'select', options: ['Hyperscaler', 'Cloud Provider', 'Enterprise', 'Colo Multi-Tenant', 'Government'] },
      tenantCredit: { label: 'Investment Grade Tenant', type: 'boolean' },
      walt: { label: 'WALT (Years)', type: 'number', description: 'Weighted Average Lease Term' },
      rampSchedule: { label: 'Lease-Up Schedule (months)', type: 'number' },
      expansionRights: { label: 'Tenant Expansion Rights', type: 'boolean' },

      // AI/GPU specific
      aiGpuOptimized: { label: 'AI/GPU Optimized', type: 'boolean', description: 'High-density liquid cooling for AI' },
      rackDensityKW: { label: 'Max Rack Density (kW/rack)', type: 'number', description: 'Standard 10-15kW, AI 40-100kW+' }
    },

    benchmarks: {
      capRate: { min: 0.045, max: 0.075, typical: 0.055, description: 'Compressed vs traditional due to long-term hyperscaler contracts' },
      pue: { min: 1.09, max: 1.80, typical: 1.47, description: 'Industry avg 1.56, leading hyperscale 1.09 (best in class)' },
      wue: { min: 0.5, max: 2.0, typical: 1.0, description: 'Liters per kWh - lower is better' },
      ratePerKW: { min: 100, max: 250, typical: 150, unit: '$/kW/month', description: 'Varies by market and density' },
      yieldOnCost: { min: 0.08, max: 0.15, typical: 0.10 },
      pricePerKW: { min: 8000, max: 20000, typical: 12000, unit: '$/kW', description: 'Shell and core valuation metric' },
      constructionCostPerKW: { min: 6000, max: 15000, typical: 9000, unit: '$/kW' },
      downtimeCostPerMinute: { min: 5000, max: 10000, typical: 7500, description: 'Financial impact of outage' }
    },

    riskFactors: [
      'Power grid availability and expansion capacity',
      'Utility rate volatility and energy cost hedging',
      'Water availability for cooling (especially in arid regions)',
      'Technology obsolescence (power density requirements)',
      'Hyperscaler concentration risk (single tenant dependency)',
      'AI/GPU demand volatility and power density migration',
      'Fiber/network connectivity adequacy',
      'Environmental regulations (carbon, water)',
      'Local zoning and permitting for expansion',
      'Competition from new builds in market',
      'Skilled labor availability for operations',
      'Supply chain for critical equipment (generators, UPS, chillers)'
    ],

    marketDynamics: {
      aiDemandGrowth: 'Exponential - driving power density from 10kW to 100kW+ per rack',
      hyperscalerExpansion: 'Microsoft, Amazon, Google driving 50%+ of absorption',
      powerConstraints: 'Grid capacity becoming primary site selection factor',
      sustainabilityPressure: 'RECs, PPAs, carbon neutrality commitments required'
    },

    leaseStructure: 'NNN_POWER', // Power-based NNN
    typicalLeaseTerm: 120, // months (10+ years for hyperscale, 3-5 for colo)

    calculations: {
      totalPowerDraw: 'itLoadKW * pue',
      facilityCriticalPower: 'itLoadKW',
      annualPowerCost: 'totalPowerDraw * powerCost * 8760',
      revenuePerKW: 'ratePerKW * 12',
      noiPerKW: '(revenuePerKW - opexPerKW)',
      pricePerKW: 'purchasePrice / itLoadKW',
      powerDensity: '(itLoadKW * 1000) / totalSF', // Watts per SF
      coolingSummary: 'totalPowerDraw - itLoadKW' // Power consumed by cooling/overhead
    }
  },

  LIFE_SCIENCES: {
    code: 'LIFE_SCIENCES',
    name: 'Life Sciences / Lab',
    description: 'Laboratory and research facilities',
    subsectors: ['Wet Lab', 'Dry Lab', 'GMP Manufacturing', 'Vivarium', 'Cleanroom'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'rentPerSF', 'labToOfficeRatio'],

    uniqueInputs: {
      totalSF: { label: 'Total SF', type: 'number', required: true },
      labSF: { label: 'Lab SF', type: 'number' },
      officeSF: { label: 'Office SF', type: 'number' },
      labToOfficeRatio: { label: 'Lab to Office Ratio', type: 'percent', default: 0.60 },
      labRentPSF: { label: 'Lab Rent/SF', type: 'currency' },
      officeRentPSF: { label: 'Office Rent/SF', type: 'currency' },
      tenantImprovements: { label: 'TI Allowance/SF', type: 'currency', default: 150 },
      labTICost: { label: 'Lab TI Cost/SF', type: 'currency', description: 'Typically 3-4x office' },
      freeRent: { label: 'Free Rent (months)', type: 'number', default: 6 },
      tenantFundingRunway: { label: 'Funding Runway (months)', type: 'number' },
      backersQuality: { label: 'Backer Quality', type: 'select', options: ['Top VC', 'Mid-tier VC', 'Seed', 'Corporate', 'Academic'] },
      biosafety: { label: 'Biosafety Level', type: 'select', options: ['BSL-1', 'BSL-2', 'BSL-3', 'BSL-4'] },
      hvacRedundancy: { label: 'HVAC Redundancy', type: 'boolean' }
    },

    benchmarks: {
      capRate: { min: 0.05, max: 0.075, typical: 0.06 },
      occupancy: { min: 0.75, max: 0.95, typical: 0.85 },
      expenseRatio: { min: 0.35, max: 0.50, typical: 0.42 },
      tiAllowance: { min: 100, max: 200, typical: 150, unit: '$/SF' },
      securityDeposit: { min: 12, max: 24, typical: 18, unit: 'months rent' }
    },

    riskFactors: [
      'Tenant credit (many are pre-revenue startups)',
      'Funding environment (VC/biotech cycles)',
      'High TI exposure on default',
      'Specialized infrastructure maintenance',
      'Regulatory compliance costs',
      'Supply pipeline (overbuilding risk)'
    ],

    leaseStructure: 'NNN',
    typicalLeaseTerm: 84, // months (7 years)

    calculations: {
      blendedRent: '(labSF * labRentPSF + officeSF * officeRentPSF) / totalSF',
      tiExposure: 'tiAllowance * totalSF',
      effectiveRent: 'blendedRent - (tiExposure / leaseTerm)'
    }
  },

  SENIORS_HOUSING: {
    code: 'SENIORS_HOUSING',
    name: 'Seniors Housing',
    description: 'Age-restricted housing and care facilities',
    subsectors: ['Independent Living', 'Assisted Living', 'Memory Care', 'Skilled Nursing', 'CCRC'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerUnit', 'revenuePerUnit', 'noiMargin', 'occupancy'],

    uniqueInputs: {
      unitCount: { label: 'Total Units/Beds', type: 'number', required: true },
      ilUnits: { label: 'Independent Living Units', type: 'number' },
      alUnits: { label: 'Assisted Living Units', type: 'number' },
      mcUnits: { label: 'Memory Care Units', type: 'number' },
      snfBeds: { label: 'Skilled Nursing Beds', type: 'number' },
      avgMonthlyRate: { label: 'Avg Monthly Rate', type: 'currency' },
      careRevenue: { label: 'Care Revenue %', type: 'percent' },
      occupancyRate: { label: 'Occupancy Rate', type: 'percent', default: 0.88 },
      operatorExperience: { label: 'Operator Track Record', type: 'select', options: ['National', 'Regional', 'Local'] },
      rideaStructure: { label: 'RIDEA Structure', type: 'boolean', description: 'REIT operating participation' },
      managementFee: { label: 'Management Fee %', type: 'percent', default: 0.05 },
      incentiveFee: { label: 'Incentive Fee %', type: 'percent', default: 0.10 },
      licenseBeds: { label: 'Licensed Beds', type: 'number' },
      staffingRatio: { label: 'Staffing Ratio', type: 'number' },
      turnoverRate: { label: 'Annual Turnover', type: 'percent' }
    },

    benchmarks: {
      capRate: { min: 0.055, max: 0.08, typical: 0.065 },
      occupancy: { min: 0.82, max: 0.95, typical: 0.88 },
      noiMargin: { min: 0.25, max: 0.40, typical: 0.32 },
      pricePerUnit: { min: 150000, max: 400000, typical: 250000, unit: '$' }
    },

    riskFactors: [
      'Labor costs and availability',
      'Regulatory compliance (state licensing)',
      'Reimbursement rate changes (Medicaid/Medicare)',
      'Operator performance risk (RIDEA)',
      'Demographics and local supply',
      'Pandemic/health event exposure'
    ],

    leaseStructure: 'RIDEA', // or TRIPLE_NET
    operatorStructure: true,

    calculations: {
      revenuePerOccupiedUnit: 'totalRevenue / (unitCount * occupancyRate)',
      noiPerUnit: 'noi / unitCount',
      pricePerUnit: 'purchasePrice / unitCount'
    }
  },

  STUDENT_HOUSING: {
    code: 'STUDENT_HOUSING',
    name: 'Student Housing',
    description: 'Purpose-built housing near universities',
    subsectors: ['On-Campus', 'Off-Campus', 'Luxury', 'Affordable'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerBed', 'rentPerBed', 'preleaseRate'],

    uniqueInputs: {
      bedCount: { label: 'Total Beds', type: 'number', required: true },
      unitCount: { label: 'Total Units', type: 'number' },
      bedsPerUnit: { label: 'Avg Beds/Unit', type: 'number', calculated: true },
      avgRentPerBed: { label: 'Avg Rent/Bed (Monthly)', type: 'currency' },
      universityName: { label: 'University', type: 'text' },
      enrollment: { label: 'University Enrollment', type: 'number' },
      distanceToCampus: { label: 'Distance to Campus (miles)', type: 'number' },
      walkToCampus: { label: 'Walk to Campus', type: 'boolean' },
      preleaseRate: { label: 'Pre-Lease Rate', type: 'percent' },
      renewalRate: { label: 'Renewal Rate', type: 'percent' },
      turnCost: { label: 'Turn Cost/Bed', type: 'currency' },
      furniturePackage: { label: 'Furniture Included', type: 'boolean' },
      utilitiesIncluded: { label: 'Utilities Included', type: 'boolean' },
      powerConference: { label: 'Power Five School', type: 'boolean' }
    },

    benchmarks: {
      capRate: { min: 0.0475, max: 0.065, typical: 0.055 },
      occupancy: { min: 0.90, max: 0.99, typical: 0.95 },
      preleaseRate: { min: 0.60, max: 0.95, typical: 0.80 },
      pricePerBed: { min: 50000, max: 150000, typical: 100000, unit: '$' },
      distancePremium: { description: '<0.5 miles = 33% premium' }
    },

    riskFactors: [
      'University enrollment trends',
      'On-campus housing expansion',
      'Distance to campus (>1 mile = significant risk)',
      'Greek life and athletics impact',
      'Competition pipeline',
      'Lease-up velocity (Aug/Sept critical)'
    ],

    leaseStructure: 'BY_BED', // Per-bed leasing
    typicalLeaseTerm: 12, // Academic year

    calculations: {
      pricePerBed: 'purchasePrice / bedCount',
      rentPerBed: 'grossPotentialRent / bedCount / 12',
      bedsPerUnit: 'bedCount / unitCount'
    }
  },

  SELF_STORAGE: {
    code: 'SELF_STORAGE',
    name: 'Self Storage',
    description: 'Mini-warehouse and storage facilities',
    subsectors: ['Climate Controlled', 'Drive-Up', 'Multi-Story', 'Boat/RV'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'revenuePerSF', 'occupancy', 'ecri'],

    uniqueInputs: {
      netRentableSF: { label: 'Net Rentable SF', type: 'number', required: true },
      unitCount: { label: 'Total Units', type: 'number' },
      climateControlledSF: { label: 'Climate Controlled SF', type: 'number' },
      avgUnitSize: { label: 'Avg Unit Size (SF)', type: 'number' },
      avgRentPerSF: { label: 'Avg Rent/SF (Annual)', type: 'currency' },
      physicalOccupancy: { label: 'Physical Occupancy', type: 'percent' },
      economicOccupancy: { label: 'Economic Occupancy', type: 'percent' },
      streetRate: { label: 'Street Rate/SF', type: 'currency' },
      ecri: { label: 'ECRI (Existing Customer Rate Increase)', type: 'percent' },
      webEnabled: { label: 'Web-Enabled Rentals', type: 'boolean' },
      autoPayRate: { label: 'Auto-Pay Rate', type: 'percent' },
      ancillaryIncome: { label: 'Ancillary Income', type: 'currency', description: 'Insurance, boxes, etc.' }
    },

    benchmarks: {
      capRate: { min: 0.05, max: 0.07, typical: 0.055 },
      physicalOccupancy: { min: 0.85, max: 0.95, typical: 0.90 },
      economicOccupancy: { min: 0.80, max: 0.92, typical: 0.87 },
      expenseRatio: { min: 0.30, max: 0.40, typical: 0.35 },
      revenuePerSF: { min: 12, max: 20, typical: 15, unit: '$/SF/year' }
    },

    riskFactors: [
      'New supply in 3-mile radius',
      'Street rate vs. in-place rent gap',
      'Technology/automation needs',
      'Manager dependency',
      'Climate control premium sustainability'
    ],

    leaseStructure: 'MONTH_TO_MONTH',
    typicalLeaseTerm: 1, // Month-to-month

    calculations: {
      economicOccupancy: 'actualRevenue / (streetRate * netRentableSF)',
      revenuePerSF: 'totalRevenue / netRentableSF'
    }
  },

  MANUFACTURED_HOUSING: {
    code: 'MANUFACTURED_HOUSING',
    name: 'Manufactured Housing / MHP',
    description: 'Mobile home parks and manufactured housing communities',
    subsectors: ['All-Age', 'Age-Restricted (55+)', 'RV Parks'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerPad', 'lotRent', 'occupancy', 'pohRatio'],

    uniqueInputs: {
      totalPads: { label: 'Total Pads/Sites', type: 'number', required: true },
      occupiedPads: { label: 'Occupied Pads', type: 'number' },
      avgLotRent: { label: 'Avg Lot Rent (Monthly)', type: 'currency' },
      marketLotRent: { label: 'Market Lot Rent', type: 'currency' },
      parkOwnedHomes: { label: 'Park-Owned Homes', type: 'number' },
      pohRentPremium: { label: 'POH Rent Premium', type: 'currency' },
      utilityBillback: { label: 'Utility Billback', type: 'boolean' },
      cityWaterSewer: { label: 'City Water/Sewer', type: 'boolean' },
      privateUtilities: { label: 'Private Utilities', type: 'boolean' },
      expansionPads: { label: 'Expansion Pads', type: 'number' },
      ageRestricted: { label: 'Age Restricted (55+)', type: 'boolean' },
      homeAge: { label: 'Avg Home Age (years)', type: 'number' },
      homesPreHud: { label: 'Pre-HUD Homes (%)', type: 'percent', description: 'Before 1976' }
    },

    benchmarks: {
      capRate: { min: 0.04, max: 0.065, typical: 0.05 },
      occupancy: { min: 0.90, max: 0.98, typical: 0.94 },
      expenseRatio: { min: 0.30, max: 0.45, typical: 0.35 },
      pohRatio: { min: 0, max: 0.10, typical: 0.05, description: 'Lenders prefer <10%' },
      pricePerPad: { min: 40000, max: 150000, typical: 80000, unit: '$' }
    },

    riskFactors: [
      'Rent control/stabilization ordinances',
      'Park-owned home concentration',
      'Utility system age (private well/septic)',
      'Pre-HUD home concentrations',
      'Infill vs. expansion markets',
      'Resident demographics and turnover'
    ],

    leaseStructure: 'LOT_RENT',
    typicalLeaseTerm: 12, // Month-to-month common

    calculations: {
      pricePerPad: 'purchasePrice / totalPads',
      pohRatio: 'parkOwnedHomes / totalPads',
      lossToLease: '(marketLotRent - avgLotRent) * occupiedPads * 12'
    }
  },

  // ==================== SPECIALTY ASSET CLASSES ====================

  GROUND_LEASE: {
    code: 'GROUND_LEASE',
    name: 'Ground Lease',
    description: 'Long-term land leases where landowner retains fee ownership',
    subsectors: ['Credit Tenant', 'Multi-Tenant', 'Build-to-Suit', 'Subordinated', 'Unsubordinated'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'rentEscalation', 'remainingTerm', 'ffo', 'affo'],

    uniqueInputs: {
      landArea: { label: 'Land Area (SF)', type: 'number', required: true },
      landAreaAcres: { label: 'Land Area (Acres)', type: 'number' },
      baseRent: { label: 'Base Ground Rent (Annual)', type: 'currency', required: true },
      rentEscalation: { label: 'Rent Escalation Type', type: 'select', options: ['Fixed %', 'CPI', 'Fair Market Reset', 'None'] },
      escalationRate: { label: 'Escalation Rate', type: 'percent', default: 0.02 },
      escalationInterval: { label: 'Escalation Interval (Years)', type: 'number', default: 5 },
      remainingTerm: { label: 'Remaining Lease Term (Years)', type: 'number', required: true },
      originalTerm: { label: 'Original Lease Term', type: 'number' },
      extensionOptions: { label: 'Extension Options', type: 'text', description: 'e.g., 4x10 year extensions' },
      subordination: { label: 'Subordination Status', type: 'select', options: ['Unsubordinated', 'Subordinated', 'Partial'] },
      improvementValue: { label: 'Improvement Value', type: 'currency', description: 'Value of buildings on land' },
      reversion: { label: 'Reversion at Expiry', type: 'boolean', default: true },
      reversionValue: { label: 'Estimated Reversion Value', type: 'currency' },
      tenantCredit: { label: 'Tenant Credit Rating', type: 'select', options: ['Investment Grade', 'Sub-Investment Grade', 'Unrated'] },
      tenantName: { label: 'Tenant Name', type: 'text' },
      useType: { label: 'Property Use', type: 'select', options: ['Retail', 'Office', 'Industrial', 'Residential', 'Mixed-Use'] }
    },

    benchmarks: {
      capRate: { min: 0.03, max: 0.06, typical: 0.045, description: 'Credit tenant ground leases trade at low caps' },
      rentEscalation: { min: 0.015, max: 0.03, typical: 0.02, description: 'Annual escalation rate' },
      remainingTerm: { min: 30, max: 99, typical: 60, unit: 'years' },
      pricePerSF: { description: 'Highly location dependent' }
    },

    riskFactors: [
      'Tenant credit deterioration',
      'Subordination exposure (if subordinated)',
      'Below-market rent resets',
      'Improvement reversion timing mismatch',
      'Extension option exercise uncertainty',
      'Land use restriction changes',
      'Ground lease financing limitations'
    ],

    leaseStructure: 'GROUND_LEASE',
    typicalLeaseTerm: 792, // 66 years in months (common 99-year term)

    calculations: {
      capRate: 'baseRent / purchasePrice',
      pricePerSF: 'purchasePrice / landArea',
      rentPerSF: 'baseRent / landArea',
      effectiveYield: '(baseRent + escalationValue) / purchasePrice',
      totalRemainingRent: 'baseRent * remainingTerm * escalationFactor'
    }
  },

  NET_LEASE: {
    code: 'NET_LEASE',
    name: 'Net Lease / Single Tenant',
    description: 'Single-tenant properties with long-term NNN leases',
    subsectors: ['Investment Grade', 'Sub-Investment Grade', 'Sale-Leaseback', 'Build-to-Suit', 'Drug Store', 'QSR', 'Auto Service', 'Bank Branch', 'Dollar Store'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'walt', 'ffo', 'affo', 'spreadToTreasury'],

    uniqueInputs: {
      totalSF: { label: 'Total SF', type: 'number', required: true },
      baseRent: { label: 'Base Rent (Annual)', type: 'currency', required: true },
      rentPerSF: { label: 'Rent/SF', type: 'currency' },
      leaseStructure: { label: 'Lease Structure', type: 'select', options: ['NNN', 'NN', 'Modified Gross', 'Absolute NNN'] },
      tenantName: { label: 'Tenant Name', type: 'text', required: true },
      tenantCredit: { label: 'Tenant Credit Rating', type: 'select', options: ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'Unrated'] },
      guarantor: { label: 'Guarantor', type: 'select', options: ['Corporate', 'Franchisee', 'None'] },
      remainingTerm: { label: 'Remaining Lease Term (Years)', type: 'number', required: true },
      originalTerm: { label: 'Original Lease Term', type: 'number' },
      rentEscalations: { label: 'Rent Escalations', type: 'select', options: ['Annual %', 'Periodic Bumps', 'CPI', 'None'] },
      escalationRate: { label: 'Escalation Rate', type: 'percent' },
      escalationSchedule: { label: 'Escalation Schedule', type: 'text', description: 'e.g., 10% every 5 years' },
      extensionOptions: { label: 'Extension Options', type: 'text', description: 'e.g., 4x5 year options' },
      landlordResponsibilities: { label: 'Landlord Responsibilities', type: 'text', description: 'What landlord is responsible for' },
      roofWalls: { label: 'Roof/Walls Responsibility', type: 'select', options: ['Tenant', 'Landlord'] },
      capExReserve: { label: 'CapEx Reserve', type: 'currency' },
      saleLeaseback: { label: 'Sale-Leaseback', type: 'boolean' },
      eCommerceResistant: { label: 'E-Commerce Resistant', type: 'boolean' },
      franchiseAgreement: { label: 'Franchise Agreement Term', type: 'number', description: 'Years remaining' }
    },

    benchmarks: {
      capRate: { min: 0.045, max: 0.08, typical: 0.06, description: 'Varies by tenant credit and term' },
      occupancy: { min: 1.0, max: 1.0, typical: 1.0, description: 'Single tenant = 100% or 0%' },
      walt: { min: 5, max: 20, typical: 10, unit: 'years' },
      spreadToTreasury: { min: 0.02, max: 0.04, typical: 0.025, description: 'Spread over 10-year Treasury' }
    },

    riskFactors: [
      'Single tenant concentration (binary outcome)',
      'Tenant credit deterioration',
      'Dark store risk (tenant abandonment)',
      'Below-market rent at expiry',
      'Franchisee vs. corporate guarantee',
      'Building fungibility/re-tenanting costs',
      'E-commerce disruption to retail tenants',
      'Roof/structure maintenance exposure'
    ],

    leaseStructure: 'NNN',
    typicalLeaseTerm: 180, // 15 years in months

    calculations: {
      capRate: 'baseRent / purchasePrice',
      pricePerSF: 'purchasePrice / totalSF',
      rentPerSF: 'baseRent / totalSF',
      spreadToTreasury: 'capRate - treasury10Year',
      ffo: 'noi - (depreciation * 0)', // FFO adds back depreciation
      affo: 'ffo - capExReserve - leasingCosts'
    }
  },

  CONDOMINIUM: {
    code: 'CONDOMINIUM',
    name: 'Condominium Development',
    description: 'For-sale residential condominium development projects',
    subsectors: ['High-Rise', 'Mid-Rise', 'Low-Rise', 'Townhome', 'Luxury', 'Affordable', 'Conversion'],

    primaryMetrics: ['irr', 'equityMultiple', 'profitMargin', 'pricePerUnit', 'pricePerSF', 'absorptionRate', 'breakEvenSales'],

    uniqueInputs: {
      totalUnits: { label: 'Total Units', type: 'number', required: true },
      avgUnitSize: { label: 'Avg Unit Size (SF)', type: 'number' },
      totalSellableSF: { label: 'Total Sellable SF', type: 'number' },
      unitMix: { label: 'Unit Mix', type: 'unitMix', description: 'Studio, 1BR, 2BR, 3BR, PH' },
      avgSalePrice: { label: 'Avg Sale Price/Unit', type: 'currency', required: true },
      avgPricePerSF: { label: 'Avg Price/SF', type: 'currency' },
      presalesRequired: { label: 'Presales Required %', type: 'percent', default: 0.50 },
      currentPresales: { label: 'Current Presales', type: 'number' },
      depositAmount: { label: 'Deposit Amount %', type: 'percent', default: 0.10 },
      landCost: { label: 'Land Cost', type: 'currency', required: true },
      hardCosts: { label: 'Hard Costs', type: 'currency', required: true },
      hardCostPerSF: { label: 'Hard Cost/SF', type: 'currency' },
      softCosts: { label: 'Soft Costs', type: 'currency' },
      contingency: { label: 'Contingency %', type: 'percent', default: 0.05 },
      constructionLoan: { label: 'Construction Loan', type: 'currency' },
      constructionRate: { label: 'Construction Rate', type: 'percent' },
      constructionPeriod: { label: 'Construction Period (months)', type: 'number' },
      salesPeriod: { label: 'Sales Period (months)', type: 'number' },
      absorptionRate: { label: 'Absorption Rate (units/month)', type: 'number' },
      brokerCommission: { label: 'Broker Commission %', type: 'percent', default: 0.05 },
      closingCosts: { label: 'Closing Costs %', type: 'percent', default: 0.02 },
      marketingBudget: { label: 'Marketing Budget', type: 'currency' },
      warrantyReserve: { label: 'Warranty Reserve %', type: 'percent', default: 0.01 }
    },

    benchmarks: {
      profitMargin: { min: 0.15, max: 0.30, typical: 0.20, description: 'Target profit margin on total revenue' },
      absorptionRate: { min: 2, max: 10, typical: 4, unit: 'units/month' },
      presalesRequired: { min: 0.30, max: 0.70, typical: 0.50, description: 'Lender presale requirement' },
      hardCostPerSF: { description: 'Varies significantly by market and building type' },
      pricePerSF: { description: 'Highly market dependent' }
    },

    riskFactors: [
      'Absorption velocity uncertainty',
      'Construction cost escalation',
      'Presale cancellation risk',
      'Market timing (delivery vs. cycle)',
      'Financing availability/presale requirements',
      'HOA budget and reserve adequacy',
      'Defect liability and warranty claims',
      'Competing project supply',
      'Interest rate impact on buyer qualification'
    ],

    leaseStructure: 'FOR_SALE', // Not a lease structure - for sale
    salesStructure: true,

    calculations: {
      grossRevenue: 'totalUnits * avgSalePrice',
      totalCosts: 'landCost + hardCosts + softCosts + contingency + constructionInterest + salesCosts',
      grossProfit: 'grossRevenue - totalCosts',
      profitMargin: 'grossProfit / grossRevenue',
      pricePerUnit: 'grossRevenue / totalUnits',
      pricePerSF: 'grossRevenue / totalSellableSF',
      breakEvenSales: 'totalCosts / avgSalePrice',
      breakEvenPercent: 'breakEvenSales / totalUnits',
      constructionInterest: 'constructionLoan * constructionRate * (constructionPeriod / 12) * 0.5',
      salesCosts: 'grossRevenue * (brokerCommission + closingCosts + warrantyReserve)'
    }
  },

  // ==================== SPECIALIZED INDUSTRIAL ====================

  COLD_STORAGE: {
    code: 'COLD_STORAGE',
    name: 'Cold Storage / Refrigerated Warehouse',
    description: 'Temperature-controlled facilities for perishable goods storage and distribution',
    subsectors: ['Freezer (-20°F)', 'Cooler (32-55°F)', 'Multi-Temperature', 'Blast Freezer', 'Pharmaceutical Cold Chain'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'rentPerSF', 'clearHeight', 'temperatureZones'],

    uniqueInputs: {
      totalSF: { label: 'Total SF', type: 'number', required: true },
      freezerSF: { label: 'Freezer SF (-20°F)', type: 'number' },
      coolerSF: { label: 'Cooler SF (32-55°F)', type: 'number' },
      ambientSF: { label: 'Ambient/Dry SF', type: 'number' },
      clearHeight: { label: 'Clear Height (ft)', type: 'number', description: 'Can be 80-150ft for ASRS' },
      dockDoors: { label: 'Dock Doors', type: 'number' },
      avgRentPerSF: { label: 'Avg Rent/SF (Annual)', type: 'currency', description: 'Freezer $18-30/SF vs Dry $6-10/SF' },
      freezerRentPSF: { label: 'Freezer Rent/SF', type: 'currency' },
      coolerRentPSF: { label: 'Cooler Rent/SF', type: 'currency' },
      powerCapacity: { label: 'Power Capacity (Amps)', type: 'number' },
      refrigerationAge: { label: 'Refrigeration System Age (Years)', type: 'number' },
      refrigerationSystemType: { label: 'Refrigeration Type', type: 'select', options: ['Ammonia', 'Freon', 'CO2', 'Cascade'] },
      asrsInstalled: { label: 'ASRS Installed', type: 'boolean', description: 'Automated Storage Retrieval System' },
      railServed: { label: 'Rail Served', type: 'boolean' },
      blastFreezerCapacity: { label: 'Blast Freezer Capacity (lbs/hr)', type: 'number' },
      temperatureMonitoring: { label: '24/7 Temperature Monitoring', type: 'boolean' },
      backupGenerator: { label: 'Backup Generator', type: 'boolean' },
      foodSafetyCompliance: { label: 'Food Safety Compliance', type: 'select', options: ['SQF', 'BRC', 'FSSC 22000', 'None'] }
    },

    benchmarks: {
      capRate: { min: 0.055, max: 0.07, typical: 0.06, description: 'Compressed to near-ambient warehouse' },
      occupancy: { min: 0.92, max: 0.99, typical: 0.97, description: 'Sub-3% vacancy typical' },
      rentPremium: { min: 2.0, max: 4.0, typical: 3.0, description: 'Multiple over dry warehouse rent' },
      refrigerationAge: { min: 0, max: 25, typical: 10, description: 'Systems last 20-25 years' },
      clearHeight: { min: 30, max: 150, typical: 50, unit: 'feet' }
    },

    riskFactors: [
      'Refrigeration system age and maintenance costs',
      'Power reliability and backup requirements',
      'Ammonia regulations and safety compliance',
      'Single-tenant concentration risk',
      'Temperature-specific tenant requirements',
      'Insurance costs (spoilage coverage)',
      'Energy cost volatility',
      'Obsolescence from newer automated facilities'
    ],

    leaseStructure: 'NNN',
    typicalLeaseTerm: 120, // months (10 years)

    calculations: {
      pricePerSF: 'purchasePrice / totalSF',
      rentPerSF: 'totalRent / totalSF',
      blendedRent: '(freezerSF * freezerRentPSF + coolerSF * coolerRentPSF + ambientSF * ambientRentPSF) / totalSF',
      powerDensity: 'powerCapacity / totalSF',
      refrigerationReplacement: 'estimatedReplacementCost based on age and type'
    }
  },

  FLEX_RD: {
    code: 'FLEX_RD',
    name: 'Flex / R&D Industrial',
    description: 'Hybrid properties combining office, lab, light manufacturing, and warehouse space',
    subsectors: ['Tech Flex', 'R&D Lab', 'Light Manufacturing', 'Creative Office/Warehouse', 'Maker Space'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'rentPerSF', 'officeRatio', 'developmentSpread'],

    uniqueInputs: {
      totalSF: { label: 'Total SF', type: 'number', required: true },
      officeSF: { label: 'Office SF', type: 'number', required: true },
      warehouseSF: { label: 'Warehouse SF', type: 'number' },
      labSF: { label: 'Lab/R&D SF', type: 'number' },
      manufacturingSF: { label: 'Light Manufacturing SF', type: 'number' },
      officeRatio: { label: 'Office Buildout %', type: 'percent', description: 'Minimum 25% for Flex' },
      clearHeight: { label: 'Clear Height (ft)', type: 'number', default: 16 },
      avgRentPerSF: { label: 'Avg Rent/SF (Annual)', type: 'currency' },
      officeRentPSF: { label: 'Office Component Rent/SF', type: 'currency' },
      warehouseRentPSF: { label: 'Warehouse Component Rent/SF', type: 'currency' },
      tenantImprovements: { label: 'TI Allowance/SF', type: 'currency', description: '$5-20/SF typical' },
      loadingDoors: { label: 'Grade-Level Loading Doors', type: 'number' },
      dockDoors: { label: 'Dock-Height Doors', type: 'number' },
      powerCapacity: { label: 'Power (Amps)', type: 'number' },
      threePhase: { label: '3-Phase Power', type: 'boolean' },
      hvacType: { label: 'HVAC Type', type: 'select', options: ['Central', 'Rooftop Units', 'None in Warehouse'] },
      sprinklered: { label: 'Sprinklered', type: 'boolean' },
      innovationCluster: { label: 'Innovation Cluster Proximity', type: 'select', options: ['In Cluster', 'Adjacent', 'Remote'] }
    },

    benchmarks: {
      capRate: { min: 0.055, max: 0.08, typical: 0.065 },
      occupancy: { min: 0.88, max: 0.98, typical: 0.96, description: 'Sub-4% vacancy in strong markets' },
      officeRatio: { min: 0.25, max: 0.60, typical: 0.35, description: '25-60% office buildout' },
      expenseRatio: { min: 0.20, max: 0.35, typical: 0.25 },
      tiAllowance: { min: 5, max: 20, typical: 12, unit: '$/SF' },
      clearHeight: { min: 14, max: 24, typical: 16, unit: 'feet' }
    },

    riskFactors: [
      'Specialized buildout limits tenant flexibility',
      'Higher office ratio = higher TI/LC costs',
      'Tech sector cyclicality',
      'Competition from purpose-built lab space',
      'Innovation cluster proximity critical',
      'Power and infrastructure requirements',
      'Zoning restrictions on manufacturing use'
    ],

    leaseStructure: 'NNN', // or Modified Gross
    typicalLeaseTerm: 36, // months (3 years typical)

    calculations: {
      officeRatio: 'officeSF / totalSF',
      blendedRent: '(officeSF * officeRentPSF + warehouseSF * warehouseRentPSF) / totalSF',
      tiExposure: 'tiAllowance * totalSF / leaseTerm'
    }
  },

  MEDICAL_OFFICE: {
    code: 'MEDICAL_OFFICE',
    name: 'Medical Office Building (MOB)',
    description: 'Healthcare facilities for physician practices and outpatient services',
    subsectors: ['On-Campus', 'Off-Campus', 'Single Specialty', 'Multi-Specialty', 'ASC', 'Imaging Center', 'Dialysis'],

    primaryMetrics: ['irr', 'cashOnCash', 'capRate', 'pricePerSF', 'rentPerSF', 'walt', 'healthSystemAnchor'],

    uniqueInputs: {
      totalSF: { label: 'Total SF', type: 'number', required: true },
      campusType: { label: 'Campus Type', type: 'select', options: ['On-Campus', 'Off-Campus', 'Adjacent'], required: true },
      hospitalAffiliation: { label: 'Hospital/Health System Affiliation', type: 'text' },
      affiliationStrength: { label: 'Affiliation Strength', type: 'select', options: ['Owned by System', 'Master Lease', 'Affiliated Physicians', 'Independent'] },
      avgRentPerSF: { label: 'Avg Rent/SF (Annual)', type: 'currency' },
      walt: { label: 'Weighted Avg Lease Term (Years)', type: 'number' },
      tenantMix: { label: 'Tenant Mix', type: 'text', description: 'Primary care, specialty, imaging, etc.' },
      anchorTenantSF: { label: 'Anchor Tenant SF', type: 'number' },
      anchorTenantCredit: { label: 'Anchor Tenant Credit', type: 'select', options: ['Health System', 'Large Group Practice', 'Small Practice', 'Independent'] },
      hopd: { label: 'HOPD Designation', type: 'boolean', description: 'Hospital Outpatient Department' },
      conStatus: { label: 'Certificate of Need', type: 'select', options: ['CON State - Approved', 'CON State - Pending', 'Non-CON State'] },
      parkingRatio: { label: 'Parking Ratio', type: 'number', description: 'Spaces per 1,000 SF (medical needs 4-6)' },
      medicalBuildout: { label: 'Medical Buildout %', type: 'percent', description: '% of space with medical infrastructure' },
      tenantImprovements: { label: 'TI Allowance/SF', type: 'currency' },
      payorMix: { label: 'Dominant Payor', type: 'select', options: ['Commercial', 'Medicare', 'Medicaid', 'Mixed'] },
      serviceLineStrength: { label: 'Primary Service Lines', type: 'text', description: 'Cardiology, ortho, oncology, etc.' }
    },

    benchmarks: {
      capRate: { min: 0.055, max: 0.075, typical: 0.065, description: 'Lower than traditional office' },
      occupancy: { min: 0.90, max: 0.98, typical: 0.95 },
      walt: { min: 5, max: 12, typical: 7, unit: 'years' },
      parkingRatio: { min: 4, max: 6, typical: 5, description: 'Medical needs more parking' },
      tiAllowance: { min: 40, max: 100, typical: 60, unit: '$/SF', description: 'Higher than traditional office' }
    },

    riskFactors: [
      'Healthcare reimbursement changes',
      'Physician practice consolidation',
      'Health system financial stability',
      'Telehealth impact on space demand',
      'Certificate of Need requirements',
      'Specialized buildout limits reuse',
      'ADA and healthcare code compliance',
      'Parking adequacy for patient volume',
      'Proximity to hospital campus'
    ],

    leaseStructure: 'FULL_SERVICE_GROSS', // or NNN
    typicalLeaseTerm: 84, // months (7 years)

    calculations: {
      pricePerSF: 'purchasePrice / totalSF',
      anchorPercent: 'anchorTenantSF / totalSF',
      effectiveRent: 'baseRent - (tiAllowance / leaseTerm)'
    }
  },

  // ==================== DEVELOPMENT ====================

  DEVELOPMENT: {
    code: 'DEVELOPMENT',
    name: 'Ground-Up Development',
    description: 'New construction projects across all property types',
    subsectors: ['Speculative', 'Build-to-Suit', 'Pre-Leased'],

    primaryMetrics: ['yieldOnCost', 'developmentSpread', 'irr', 'equityMultiple', 'residualLandValue'],

    uniqueInputs: {
      landCost: { label: 'Land Cost', type: 'currency', required: true },
      hardCosts: { label: 'Hard Costs', type: 'currency', required: true },
      hardCostPSF: { label: 'Hard Cost/SF', type: 'currency' },
      softCosts: { label: 'Soft Costs', type: 'currency' },
      softCostPercent: { label: 'Soft Cost %', type: 'percent', default: 0.25 },
      contingency: { label: 'Contingency %', type: 'percent', default: 0.05 },
      constructionLoan: { label: 'Construction Loan', type: 'currency' },
      constructionRate: { label: 'Construction Rate', type: 'percent' },
      constructionPeriod: { label: 'Construction (months)', type: 'number' },
      leaseUpPeriod: { label: 'Lease-Up (months)', type: 'number' },
      stabilizationDate: { label: 'Stabilization Date', type: 'date' },
      preleased: { label: 'Pre-Leased %', type: 'percent' },
      entitlements: { label: 'Entitlements Status', type: 'select', options: ['In Process', 'Entitled', 'Permitted'] },
      totalBudget: { label: 'Total Project Cost', type: 'currency', calculated: true },
      stabilizedNOI: { label: 'Stabilized NOI', type: 'currency' },
      exitCapRate: { label: 'Exit Cap Rate', type: 'percent' }
    },

    benchmarks: {
      yieldOnCost: { min: 0.06, max: 0.10, typical: 0.075, description: 'Stabilized NOI / Total Cost' },
      developmentSpread: { min: 0.01, max: 0.03, typical: 0.015, description: 'YOC - Market Cap Rate' },
      contingency: { min: 0.03, max: 0.10, typical: 0.05 },
      softCostRatio: { min: 0.20, max: 0.35, typical: 0.25 }
    },

    riskFactors: [
      'Entitlement and permitting delays',
      'Construction cost escalation',
      'Interest rate movement during construction',
      'Lease-up velocity uncertainty',
      'Material and labor availability',
      'Subcontractor risk',
      'Market timing risk'
    ],

    calculations: {
      totalBudget: 'landCost + hardCosts + softCosts + contingency + constructionInterest',
      yieldOnCost: 'stabilizedNOI / totalBudget',
      developmentSpread: 'yieldOnCost - marketCapRate',
      residualLandValue: '(stabilizedNOI / targetYOC) - (hardCosts + softCosts)',
      constructionInterest: 'constructionLoan * constructionRate * (constructionPeriod / 12) * 0.5'
    }
  }
};

/**
 * Get sector configuration by code
 */
export function getSectorConfig(sectorCode) {
  return PROPERTY_SECTORS[sectorCode] || null;
}

/**
 * Get all available sectors
 */
export function getAllSectors() {
  return Object.entries(PROPERTY_SECTORS).map(([code, config]) => ({
    code,
    name: config.name,
    description: config.description,
    subsectors: config.subsectors
  }));
}

/**
 * Detect sector from deal data
 */
export function detectSector(dealProfile) {
  const propertyType = (dealProfile.property_type || '').toUpperCase();
  const assetType = (dealProfile.asset_type || '').toUpperCase();
  const combined = `${propertyType} ${assetType}`;

  // Check for specific lease structures first
  if (combined.includes('GROUND LEASE') || combined.includes('LAND LEASE')) return 'GROUND_LEASE';
  if (combined.includes('NET LEASE') || combined.includes('SINGLE TENANT') || combined.includes('NNN')) return 'NET_LEASE';
  if (combined.includes('CONDO') || combined.includes('CONDOMINIUM') || combined.includes('FOR-SALE')) return 'CONDOMINIUM';

  // Direct matches
  if (combined.includes('MULTIFAMILY') || combined.includes('APARTMENT')) return 'MULTIFAMILY';

  // Medical Office - check before generic office
  if (combined.includes('MEDICAL OFFICE') || combined.includes('MOB') || combined.includes('HEALTHCARE')) return 'MEDICAL_OFFICE';

  // Office types
  if (combined.includes('OFFICE')) {
    if (combined.includes('LAB') || combined.includes('LIFE SCIENCE')) return 'LIFE_SCIENCES';
    return 'OFFICE';
  }

  // Industrial variants - check specialized first
  if (combined.includes('COLD STORAGE') || combined.includes('REFRIGERATED') || combined.includes('FREEZER')) return 'COLD_STORAGE';
  if (combined.includes('FLEX') || combined.includes('R&D') || combined.includes('TECH INDUSTRIAL')) return 'FLEX_RD';
  if (combined.includes('DATA CENTER') || combined.includes('DATACENTER')) return 'DATA_CENTER';
  if (combined.includes('INDUSTRIAL') || combined.includes('WAREHOUSE') || combined.includes('DISTRIBUTION') || combined.includes('LOGISTICS')) {
    return 'INDUSTRIAL';
  }

  if (combined.includes('RETAIL') || combined.includes('SHOPPING')) return 'RETAIL';
  if (combined.includes('HOTEL') || combined.includes('HOSPITALITY')) return 'HOTEL';
  if (combined.includes('LIFE SCIENCE') || combined.includes('LAB') || combined.includes('BIOTECH')) return 'LIFE_SCIENCES';
  if (combined.includes('SENIOR') || combined.includes('ASSISTED') || combined.includes('MEMORY CARE') || combined.includes('SKILLED NURSING')) return 'SENIORS_HOUSING';
  if (combined.includes('STUDENT')) return 'STUDENT_HOUSING';
  if (combined.includes('SELF STORAGE') || combined.includes('MINI STORAGE') || combined.includes('SELF-STORAGE')) return 'SELF_STORAGE';
  if (combined.includes('MOBILE HOME') || combined.includes('MANUFACTURED') || combined.includes('MHP') || combined.includes('TRAILER PARK')) return 'MANUFACTURED_HOUSING';
  if (combined.includes('DEVELOPMENT') || combined.includes('GROUND-UP') || combined.includes('CONSTRUCTION')) return 'DEVELOPMENT';

  // Default to multifamily if residential-sounding
  if (combined.includes('RESIDENTIAL')) return 'MULTIFAMILY';

  return null; // Unknown sector
}

/**
 * Get required inputs for a sector
 */
export function getSectorRequiredInputs(sectorCode) {
  const config = getSectorConfig(sectorCode);
  if (!config) return [];

  return Object.entries(config.uniqueInputs)
    .filter(([_, def]) => def.required)
    .map(([key, def]) => ({
      key,
      ...def
    }));
}

/**
 * Get all inputs for a sector (required + optional)
 */
export function getSectorAllInputs(sectorCode) {
  const config = getSectorConfig(sectorCode);
  if (!config) return [];

  return Object.entries(config.uniqueInputs).map(([key, def]) => ({
    key,
    ...def
  }));
}

/**
 * Get benchmarks for a sector
 */
export function getSectorBenchmarks(sectorCode) {
  const config = getSectorConfig(sectorCode);
  return config?.benchmarks || {};
}

/**
 * Validate value against sector benchmarks
 */
export function validateAgainstBenchmark(sectorCode, metricKey, value) {
  const benchmarks = getSectorBenchmarks(sectorCode);
  const benchmark = benchmarks[metricKey];

  if (!benchmark) return { valid: true };

  const result = {
    valid: true,
    warning: null,
    benchmark
  };

  if (benchmark.min !== undefined && value < benchmark.min) {
    result.warning = `Below typical range (min: ${benchmark.min})`;
  }
  if (benchmark.max !== undefined && value > benchmark.max) {
    result.warning = `Above typical range (max: ${benchmark.max})`;
  }

  return result;
}

/**
 * Get risk factors for a sector
 */
export function getSectorRiskFactors(sectorCode) {
  const config = getSectorConfig(sectorCode);
  return config?.riskFactors || [];
}

/**
 * Get primary metrics for a sector
 */
export function getSectorPrimaryMetrics(sectorCode) {
  const config = getSectorConfig(sectorCode);
  return config?.primaryMetrics || ['irr', 'cashOnCash', 'capRate', 'dscr'];
}

export default PROPERTY_SECTORS;
