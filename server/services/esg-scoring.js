/**
 * ESG Scoring & Sustainability Metrics
 *
 * Calculates ESG (Environmental, Social, Governance) scores for real estate assets
 * aligned with industry frameworks:
 * - GRESB (Global Real Estate Sustainability Benchmark)
 * - ENERGY STAR
 * - LEED, WELL, BREEAM certifications
 * - EU Taxonomy / CSRD requirements
 * - NYC LL97, Denver BPS, and other building performance standards
 *
 * Based on 2025 GRESB Real Estate Assessment methodology
 */

/**
 * ESG Category Weights (aligned with GRESB 2025)
 */
export const ESG_WEIGHTS = {
  environmental: 0.60, // 60% weight
  social: 0.25, // 25% weight
  governance: 0.15  // 15% weight
};

/**
 * Environmental Metric Benchmarks by Property Type
 */
export const ENVIRONMENTAL_BENCHMARKS = {
  OFFICE: {
    energyIntensity: { // kWh/m² annually
      excellent: 120,
      good: 160,
      average: 200,
      poor: 250
    },
    carbonIntensity: { // kgCO2e/m² annually
      excellent: 30,
      good: 44,
      average: 55,
      poor: 70
    },
    waterIntensity: { // liters/m² annually
      excellent: 300,
      good: 500,
      average: 700,
      poor: 1000
    }
  },
  RETAIL: {
    energyIntensity: {
      excellent: 150,
      good: 214,
      average: 280,
      poor: 350
    },
    carbonIntensity: {
      excellent: 40,
      good: 58,
      average: 75,
      poor: 95
    },
    waterIntensity: {
      excellent: 400,
      good: 600,
      average: 850,
      poor: 1100
    }
  },
  MULTIFAMILY: {
    energyIntensity: {
      excellent: 80,
      good: 110,
      average: 140,
      poor: 180
    },
    carbonIntensity: {
      excellent: 15,
      good: 25,
      average: 35,
      poor: 50
    },
    waterIntensity: {
      excellent: 200,
      good: 350,
      average: 500,
      poor: 700
    }
  },
  INDUSTRIAL: {
    energyIntensity: {
      excellent: 60,
      good: 85,
      average: 110,
      poor: 150
    },
    carbonIntensity: {
      excellent: 20,
      good: 30,
      average: 40,
      poor: 55
    },
    waterIntensity: {
      excellent: 150,
      good: 250,
      average: 400,
      poor: 600
    }
  },
  DATA_CENTER: {
    pue: { // Power Usage Effectiveness
      excellent: 1.2,
      good: 1.4,
      average: 1.56,
      poor: 1.8
    },
    wue: { // Water Usage Effectiveness (L/kWh)
      excellent: 0.5,
      good: 1.0,
      average: 1.5,
      poor: 2.0
    },
    renewableEnergy: { // % renewable
      excellent: 0.80,
      good: 0.50,
      average: 0.25,
      poor: 0.10
    }
  },
  HOTEL: {
    energyIntensity: { // per occupied room night
      excellent: 100,
      good: 150,
      average: 200,
      poor: 280
    },
    waterIntensity: { // liters per occupied room night
      excellent: 300,
      good: 500,
      average: 700,
      poor: 1000
    }
  }
};

/**
 * Certification Scores
 */
export const CERTIFICATION_SCORES = {
  leed: {
    platinum: 25,
    gold: 20,
    silver: 15,
    certified: 10,
    none: 0
  },
  energyStar: {
    certified: 15, // ENERGY STAR certification
    score90Plus: 12,
    score75Plus: 8,
    below75: 0
  },
  well: {
    platinum: 20,
    gold: 15,
    silver: 10,
    certified: 5,
    none: 0
  },
  breeam: {
    outstanding: 25,
    excellent: 20,
    veryGood: 15,
    good: 10,
    pass: 5,
    none: 0
  },
  fitwel: {
    threeStars: 15,
    twoStars: 10,
    oneStar: 5,
    none: 0
  }
};

/**
 * Calculate comprehensive ESG score for a property
 *
 * @param {Object} params - Property ESG data
 * @returns {Object} - ESG scores and analysis
 */
export function calculateESGScore(params) {
  const {
    // Property info
    propertyType = 'OFFICE',
    totalSF,
    buildingAge,

    // Environmental metrics
    annualEnergyKWh,
    annualCarbonKgCO2e,
    annualWaterLiters,
    renewableEnergyPercent = 0,
    onSiteRenewableKW = 0,
    evChargingStations = 0,
    wasteRecyclingRate = 0,
    hasGreenRoof = false,
    hasSolarPanels = false,
    hasEnergyManagement = false,

    // Data Center specific
    pue,
    wue,

    // Certifications
    leedLevel = 'none',
    energyStarScore,
    wellLevel = 'none',
    breeamLevel = 'none',
    fitwelLevel = 'none',

    // Social metrics
    accessibilityCompliant = false,
    transitScore,
    walkScore,
    bikeScore,
    amenityScore = 0, // 0-100
    indoorAirQuality = 'standard', // 'excellent', 'good', 'standard', 'poor'
    lightingQuality = 'standard',
    hasWellnessAmenities = false,
    employeeSatisfaction, // Survey score 0-100

    // Governance
    hasESGPolicy = false,
    hasClimateRiskAssessment = false,
    reportsToGRESB = false,
    hasGreenLeases = false,
    greenLeasePercent = 0,
    tenantEngagementProgram = false,
    hasNetZeroTarget = false,
    netZeroTargetYear,

    // Regulatory
    regulatoryCompliance = 'compliant', // 'exceeds', 'compliant', 'at-risk', 'non-compliant'
    ll97Status, // NYC Local Law 97
    bpsStatus  // Building Performance Standards
  } = params;

  const scores = {
    environmental: 0,
    social: 0,
    governance: 0,
    total: 0,
    details: {},
    recommendations: []
  };

  // ===== ENVIRONMENTAL (60 points max) =====
  const envDetails = {};
  let envScore = 0;

  // Energy performance (15 points)
  if (annualEnergyKWh && totalSF) {
    const energyIntensity = annualEnergyKWh / (totalSF * 0.0929); // Convert SF to m²
    const benchmark = ENVIRONMENTAL_BENCHMARKS[propertyType]?.energyIntensity ||
      ENVIRONMENTAL_BENCHMARKS.OFFICE.energyIntensity;

    if (energyIntensity <= benchmark.excellent) {
      envScore += 15;
      envDetails.energyRating = 'Excellent';
    } else if (energyIntensity <= benchmark.good) {
      envScore += 12;
      envDetails.energyRating = 'Good';
    } else if (energyIntensity <= benchmark.average) {
      envScore += 8;
      envDetails.energyRating = 'Average';
    } else {
      envScore += 4;
      envDetails.energyRating = 'Below Average';
      scores.recommendations.push('Implement energy efficiency measures to reduce consumption');
    }
    envDetails.energyIntensity = energyIntensity.toFixed(1) + ' kWh/m²';
  }

  // Carbon performance (15 points)
  if (annualCarbonKgCO2e && totalSF) {
    const carbonIntensity = annualCarbonKgCO2e / (totalSF * 0.0929);
    const benchmark = ENVIRONMENTAL_BENCHMARKS[propertyType]?.carbonIntensity ||
      ENVIRONMENTAL_BENCHMARKS.OFFICE.carbonIntensity;

    if (carbonIntensity <= benchmark.excellent) {
      envScore += 15;
      envDetails.carbonRating = 'Excellent';
    } else if (carbonIntensity <= benchmark.good) {
      envScore += 12;
      envDetails.carbonRating = 'Good';
    } else if (carbonIntensity <= benchmark.average) {
      envScore += 8;
      envDetails.carbonRating = 'Average';
    } else {
      envScore += 4;
      envDetails.carbonRating = 'Below Average';
      scores.recommendations.push('Develop decarbonization strategy');
    }
    envDetails.carbonIntensity = carbonIntensity.toFixed(1) + ' kgCO2e/m²';
  }

  // Renewable energy (10 points)
  if (renewableEnergyPercent >= 0.80) {
    envScore += 10;
    envDetails.renewableRating = 'Excellent - 80%+ renewable';
  } else if (renewableEnergyPercent >= 0.50) {
    envScore += 7;
    envDetails.renewableRating = 'Good - 50%+ renewable';
  } else if (renewableEnergyPercent >= 0.25) {
    envScore += 4;
    envDetails.renewableRating = 'Moderate';
  } else {
    envScore += 1;
    scores.recommendations.push('Increase renewable energy procurement');
  }

  if (hasSolarPanels) envScore += 2;
  if (onSiteRenewableKW > 0) envScore += 2;

  // Water performance (5 points)
  if (annualWaterLiters && totalSF) {
    const waterIntensity = annualWaterLiters / (totalSF * 0.0929);
    const benchmark = ENVIRONMENTAL_BENCHMARKS[propertyType]?.waterIntensity ||
      ENVIRONMENTAL_BENCHMARKS.OFFICE.waterIntensity;

    if (waterIntensity <= benchmark.excellent) {
      envScore += 5;
    } else if (waterIntensity <= benchmark.good) {
      envScore += 4;
    } else if (waterIntensity <= benchmark.average) {
      envScore += 2;
    }
    envDetails.waterIntensity = waterIntensity.toFixed(0) + ' L/m²';
  }

  // Waste management (5 points)
  if (wasteRecyclingRate >= 0.75) {
    envScore += 5;
  } else if (wasteRecyclingRate >= 0.50) {
    envScore += 3;
  } else if (wasteRecyclingRate >= 0.25) {
    envScore += 1;
  }
  envDetails.recyclingRate = (wasteRecyclingRate * 100).toFixed(0) + '%';

  // Additional environmental features (5 points)
  if (hasGreenRoof) envScore += 2;
  if (hasEnergyManagement) envScore += 2;
  if (evChargingStations > 0) envScore += 1;

  // Data center specific (PUE)
  if (propertyType === 'DATA_CENTER' && pue) {
    envDetails.pue = pue.toFixed(2);
    if (pue <= 1.2) {
      envScore += 10;
    } else if (pue <= 1.4) {
      envScore += 7;
    } else if (pue <= 1.56) {
      envScore += 4;
    }
  }

  scores.environmental = Math.min(60, envScore);
  scores.details.environmental = envDetails;

  // ===== SOCIAL (25 points max) =====
  const socialDetails = {};
  let socialScore = 0;

  // Accessibility (5 points)
  if (accessibilityCompliant) {
    socialScore += 5;
    socialDetails.accessibility = 'ADA Compliant';
  }

  // Location/Transit (5 points)
  if (transitScore >= 80) {
    socialScore += 5;
  } else if (transitScore >= 60) {
    socialScore += 3;
  } else if (transitScore >= 40) {
    socialScore += 1;
  }

  if (walkScore) socialDetails.walkScore = walkScore;
  if (transitScore) socialDetails.transitScore = transitScore;

  // Indoor environment (5 points)
  const iaqScores = { excellent: 5, good: 4, standard: 2, poor: 0 };
  socialScore += iaqScores[indoorAirQuality] || 2;
  socialDetails.indoorAirQuality = indoorAirQuality;

  // Wellness & amenities (5 points)
  if (hasWellnessAmenities) {
    socialScore += 2;
    socialDetails.wellness = 'Wellness amenities available';
  }
  socialScore += Math.min(3, amenityScore / 33);

  // Certifications (5 points)
  socialScore += (CERTIFICATION_SCORES.well[wellLevel] || 0) / 4;
  socialScore += (CERTIFICATION_SCORES.fitwel[fitwelLevel] || 0) / 3;

  scores.social = Math.min(25, socialScore);
  scores.details.social = socialDetails;

  // ===== GOVERNANCE (15 points max) =====
  const govDetails = {};
  let govScore = 0;

  // ESG Policy & Reporting (5 points)
  if (hasESGPolicy) {
    govScore += 2;
    govDetails.esgPolicy = 'Yes';
  }
  if (reportsToGRESB) {
    govScore += 3;
    govDetails.gresbReporting = 'Yes';
  }

  // Climate risk (3 points)
  if (hasClimateRiskAssessment) {
    govScore += 3;
    govDetails.climateRisk = 'Assessed';
  } else {
    scores.recommendations.push('Conduct climate risk assessment');
  }

  // Green leases (4 points)
  if (hasGreenLeases) {
    govScore += Math.min(4, greenLeasePercent * 4);
    govDetails.greenLeases = (greenLeasePercent * 100).toFixed(0) + '% of leases';
  }

  // Net zero commitment (3 points)
  if (hasNetZeroTarget) {
    govScore += 3;
    govDetails.netZero = `Target year: ${netZeroTargetYear || 'Set'}`;
  }

  // Regulatory compliance
  const complianceScores = { exceeds: 2, compliant: 1, 'at-risk': 0, 'non-compliant': -2 };
  govScore += complianceScores[regulatoryCompliance] || 0;
  govDetails.regulatory = regulatoryCompliance;

  scores.governance = Math.min(15, govScore);
  scores.details.governance = govDetails;

  // ===== CERTIFICATION BONUS =====
  let certBonus = 0;
  certBonus += CERTIFICATION_SCORES.leed[leedLevel] || 0;
  certBonus += getEnergyStarScore(energyStarScore);
  certBonus += CERTIFICATION_SCORES.breeam[breeamLevel] || 0;

  scores.certificationBonus = certBonus;
  scores.details.certifications = {
    leed: leedLevel !== 'none' ? leedLevel : null,
    energyStar: energyStarScore,
    well: wellLevel !== 'none' ? wellLevel : null,
    breeam: breeamLevel !== 'none' ? breeamLevel : null,
    fitwel: fitwelLevel !== 'none' ? fitwelLevel : null
  };

  // ===== CALCULATE TOTAL =====
  scores.total = Math.round(
    scores.environmental +
    scores.social +
    scores.governance
  );

  // Add rating
  scores.rating = getESGRating(scores.total);

  // GRESB-style score (0-100)
  scores.gresbScore = Math.round((scores.total / 100) * 100);

  // Add market comparison
  scores.marketComparison = getMarketComparison(scores.gresbScore, propertyType);

  // Climate risk summary
  scores.climateRisk = assessClimateRisk(params);

  return scores;
}

/**
 * Get ENERGY STAR certification score
 */
function getEnergyStarScore(score) {
  if (!score) return 0;
  if (score >= 75) return CERTIFICATION_SCORES.energyStar.certified;
  if (score >= 90) return CERTIFICATION_SCORES.energyStar.score90Plus;
  if (score >= 75) return CERTIFICATION_SCORES.energyStar.score75Plus;
  return 0;
}

/**
 * Get ESG rating based on total score
 */
function getESGRating(score) {
  if (score >= 85) return { rating: 'A', description: 'Leader' };
  if (score >= 70) return { rating: 'B', description: 'Above Average' };
  if (score >= 55) return { rating: 'C', description: 'Average' };
  if (score >= 40) return { rating: 'D', description: 'Below Average' };
  return { rating: 'F', description: 'Non-Compliant' };
}

/**
 * Compare to market average
 */
function getMarketComparison(score, propertyType) {
  // 2025 GRESB averages by sector
  const marketAverages = {
    OFFICE: 72,
    RETAIL: 65,
    MULTIFAMILY: 68,
    INDUSTRIAL: 62,
    DATA_CENTER: 70,
    HOTEL: 58,
    SENIORS_HOUSING: 55,
    STUDENT_HOUSING: 60
  };

  const average = marketAverages[propertyType] || 65;
  const difference = score - average;

  return {
    marketAverage: average,
    difference: difference,
    percentile: calculatePercentile(score),
    assessment: difference > 10 ? 'Significantly Above Market' :
      difference > 0 ? 'Above Market' :
        difference > -10 ? 'Near Market' : 'Below Market'
  };
}

/**
 * Calculate approximate percentile
 */
function calculatePercentile(score) {
  // Approximation based on GRESB distribution
  if (score >= 90) return 95;
  if (score >= 80) return 85;
  if (score >= 70) return 70;
  if (score >= 60) return 50;
  if (score >= 50) return 30;
  return 15;
}

/**
 * Assess climate risk exposure
 */
function assessClimateRisk(params) {
  const risks = [];

  // Physical risks
  if (params.floodZone === 'high') {
    risks.push({ type: 'Flood', severity: 'High', mitigation: 'Required' });
  }
  if (params.coastalExposure) {
    risks.push({ type: 'Sea Level Rise', severity: 'Medium', mitigation: 'Monitoring' });
  }
  if (params.heatDays > 30) {
    risks.push({ type: 'Extreme Heat', severity: 'Medium', mitigation: 'HVAC capacity' });
  }

  // Transition risks
  if (params.carbonIntensity > 50) {
    risks.push({ type: 'Carbon Pricing', severity: 'High', mitigation: 'Decarbonization plan' });
  }
  if (params.buildingAge > 20 && !params.hasEnergyManagement) {
    risks.push({ type: 'Stranded Asset', severity: 'Medium', mitigation: 'Deep retrofit' });
  }

  // Regulatory risks
  if (params.ll97Status === 'at-risk' || params.bpsStatus === 'at-risk') {
    risks.push({ type: 'Regulatory Fine', severity: 'High', mitigation: 'Immediate action' });
  }

  return {
    risks,
    overallRisk: risks.some(r => r.severity === 'High') ? 'High' :
      risks.length > 0 ? 'Medium' : 'Low',
    count: risks.length
  };
}

/**
 * Calculate carbon reduction pathway
 */
export function calculateCarbonPathway(params) {
  const {
    currentCarbonKgCO2e,
    targetYear = 2050,
    netZeroTarget = true,
    currentYear = new Date().getFullYear(),
    totalSF
  } = params;

  if (!currentCarbonKgCO2e || !totalSF) {
    return { error: 'Carbon emissions and square footage required' };
  }

  const currentIntensity = currentCarbonKgCO2e / (totalSF * 0.0929); // kg/m²
  const yearsToTarget = targetYear - currentYear;
  const targetIntensity = netZeroTarget ? 0 : currentIntensity * 0.2; // 80% reduction if not net zero

  const annualReduction = (currentIntensity - targetIntensity) / yearsToTarget;
  const annualReductionPercent = annualReduction / currentIntensity;

  // Generate pathway
  const pathway = [];
  let intensity = currentIntensity;

  for (let year = currentYear; year <= targetYear; year++) {
    pathway.push({
      year,
      targetIntensity: Math.max(0, intensity).toFixed(1),
      absoluteEmissions: Math.round(Math.max(0, intensity) * (totalSF * 0.0929))
    });
    intensity -= annualReduction;
  }

  // Identify intervention points
  const interventions = [
    { year: currentYear + 2, action: 'LED lighting retrofit', impact: 0.15 },
    { year: currentYear + 4, action: 'HVAC optimization', impact: 0.20 },
    { year: currentYear + 6, action: 'Renewable energy procurement', impact: 0.30 },
    { year: currentYear + 8, action: 'Building envelope improvements', impact: 0.15 },
    { year: currentYear + 10, action: 'Electrification of remaining gas', impact: 0.20 }
  ];

  return {
    current: {
      intensity: currentIntensity.toFixed(1) + ' kgCO2e/m²',
      absolute: currentCarbonKgCO2e
    },
    target: {
      year: targetYear,
      intensity: targetIntensity.toFixed(1) + ' kgCO2e/m²',
      netZero: netZeroTarget
    },
    pathway,
    annualReductionRequired: (annualReductionPercent * 100).toFixed(1) + '%',
    interventions: interventions.filter(i => i.year <= targetYear)
  };
}

/**
 * Generate ESG improvement recommendations
 */
export function generateESGRecommendations(scores) {
  const recommendations = [];

  // Environmental improvements
  if (scores.environmental < 40) {
    recommendations.push({
      priority: 'High',
      category: 'Environmental',
      action: 'Conduct energy audit and implement efficiency measures',
      potentialImpact: '+10-15 points',
      estimatedCost: '$2-5/SF'
    });
  }

  if (!scores.details.certifications.leed) {
    recommendations.push({
      priority: 'Medium',
      category: 'Certification',
      action: 'Pursue LEED certification',
      potentialImpact: '+10-25 points',
      estimatedCost: '$5-15/SF for improvements'
    });
  }

  if (!scores.details.certifications.energyStar || scores.details.certifications.energyStar < 75) {
    recommendations.push({
      priority: 'Medium',
      category: 'Environmental',
      action: 'Improve ENERGY STAR score',
      potentialImpact: '+8-15 points',
      estimatedCost: 'Varies by improvement'
    });
  }

  // Social improvements
  if (scores.social < 15) {
    recommendations.push({
      priority: 'Medium',
      category: 'Social',
      action: 'Improve indoor environmental quality and wellness amenities',
      potentialImpact: '+5-10 points'
    });
  }

  // Governance improvements
  if (scores.governance < 10) {
    recommendations.push({
      priority: 'High',
      category: 'Governance',
      action: 'Develop ESG policy and report to GRESB',
      potentialImpact: '+5-8 points',
      estimatedCost: '$10,000-50,000/year'
    });
  }

  return recommendations;
}

export default {
  calculateESGScore,
  calculateCarbonPathway,
  generateESGRecommendations,
  ESG_WEIGHTS,
  ENVIRONMENTAL_BENCHMARKS,
  CERTIFICATION_SCORES
};
