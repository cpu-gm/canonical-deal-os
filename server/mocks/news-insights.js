/**
 * Mock News Insights Data
 *
 * Used for initial development of the AI-powered news feed feature.
 * Each insight has role-specific interpretations for GP, Lender, and Legal counsel.
 */

export const MOCK_NEWS_INSIGHTS = [
  {
    id: 'mock-news-001',
    headline: 'Fed Signals Potential Rate Cut in Q2 2026',
    summary: 'Federal Reserve officials indicated openness to rate cuts following softer inflation data. Markets are now pricing in a 75% probability of a 25 basis point cut by June, which could significantly impact commercial real estate financing costs.',
    source: 'Reuters',
    sourceUrl: 'https://reuters.com/markets/fed-signals-rate-cut',
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2 hours ago
    relevance: {
      portfolioWide: true,
      dealIds: [],
      topics: ['interest-rates', 'financing', 'monetary-policy']
    },
    impact: 'positive',
    roleSpecificInsights: {
      GP: 'Lower rates could reduce refinancing costs across your portfolio. Consider evaluating deals with floating-rate debt for potential savings. This may also improve buyer appetite for acquisitions.',
      LENDER: 'Rate cuts may increase prepayment risk on fixed-rate loans. Review prepayment penalty structures and consider hedging strategies for floating-rate exposure.',
      LEGAL: 'Review loan documents for rate adjustment clauses, refinancing provisions, and any covenants tied to interest rate benchmarks that may be triggered.',
      LP: 'Lower financing costs typically improve cash-on-cash returns. Existing investments with floating rate debt may see improved distributions.'
    }
  },
  {
    id: 'mock-news-002',
    headline: 'Multifamily Vacancy Rates Rise in Sun Belt Markets',
    summary: 'New construction completions are pushing vacancy rates higher in Phoenix, Austin, and Dallas metros. Average vacancy now at 6.8% versus 5.2% a year ago, with rent growth decelerating to 1.2% annually.',
    source: 'CoStar',
    sourceUrl: 'https://costar.com/research/sunbelt-vacancy',
    publishedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(), // 5 hours ago
    relevance: {
      portfolioWide: false,
      dealIds: [],
      topics: ['multifamily', 'vacancy', 'sun-belt', 'rent-growth']
    },
    impact: 'negative',
    roleSpecificInsights: {
      GP: 'Your Sun Belt multifamily assets may face increased competition. Consider reviewing concession strategies, marketing budgets, and renewal incentives. Proactive tenant retention will be critical.',
      LENDER: 'Higher vacancy may impact NOI and debt service coverage ratios. Flag affected properties for enhanced monitoring and review covenant compliance projections.',
      LEGAL: 'Review lease terms for any provisions related to competitive market conditions. Consider implications for ongoing lease-up guarantees or completion guarantees.',
      LP: 'Sun Belt multifamily investments may see near-term pressure on distributions. This is typically cyclical as new supply is absorbed over 12-18 months.'
    }
  },
  {
    id: 'mock-news-003',
    headline: 'Industrial Demand Remains Strong Despite E-Commerce Slowdown',
    summary: 'Warehouse and logistics facilities continue to see robust leasing activity, with net absorption remaining positive nationally. Supply chain reshoring and nearshoring trends are driving demand in secondary markets.',
    source: 'CBRE Research',
    sourceUrl: 'https://cbre.com/research/industrial-outlook',
    publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(), // 8 hours ago
    relevance: {
      portfolioWide: false,
      dealIds: [],
      topics: ['industrial', 'logistics', 'supply-chain']
    },
    impact: 'positive',
    roleSpecificInsights: {
      GP: 'Industrial fundamentals remain strong. Consider opportunities in secondary markets benefiting from reshoring trends. Existing industrial assets should see stable or improving occupancy.',
      LENDER: 'Industrial sector continues to exhibit strong credit metrics. Favorable for new originations and existing loan performance.',
      LEGAL: 'Manufacturing and logistics tenants may have specific requirements around environmental compliance, utility infrastructure, and expansion rights worth reviewing.',
      LP: 'Industrial investments continue to outperform other sectors. Strong fundamentals support stable income and potential appreciation.'
    }
  },
  {
    id: 'mock-news-004',
    headline: 'New ESG Disclosure Requirements for Commercial Properties',
    summary: 'SEC finalizes rules requiring enhanced climate risk disclosures for commercial real estate portfolios. Compliance required for fiscal year 2027, with energy benchmarking and emissions reporting becoming mandatory for properties over 50,000 SF.',
    source: 'National Law Review',
    sourceUrl: 'https://natlawreview.com/esg-cre-disclosure',
    publishedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    relevance: {
      portfolioWide: true,
      dealIds: [],
      topics: ['esg', 'regulation', 'compliance', 'sustainability']
    },
    impact: 'neutral',
    roleSpecificInsights: {
      GP: 'Begin preparing for enhanced ESG reporting requirements. Consider engaging sustainability consultants and implementing energy management systems. Early compliance may provide competitive advantage with ESG-focused investors.',
      LENDER: 'New disclosure requirements may impact borrower compliance costs. Consider incorporating ESG metrics into underwriting criteria and loan documentation.',
      LEGAL: 'Review current disclosure practices against new requirements. Prepare updated representations and warranties for transaction documents. Consider implications for existing loan covenants.',
      LP: 'ESG compliance will become increasingly important for institutional allocations. Sponsors with strong ESG practices may have fundraising advantages.'
    }
  },
  {
    id: 'mock-news-005',
    headline: 'Office-to-Residential Conversions Gain Momentum',
    summary: 'Cities are streamlining approval processes for office-to-residential conversions as remote work persists. New York, Chicago, and San Francisco have approved expedited permitting and tax incentives for qualifying projects.',
    source: 'Wall Street Journal',
    sourceUrl: 'https://wsj.com/real-estate/office-conversion',
    publishedAt: new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString(), // 1.5 days ago
    relevance: {
      portfolioWide: false,
      dealIds: [],
      topics: ['office', 'residential', 'conversion', 'adaptive-reuse']
    },
    impact: 'positive',
    roleSpecificInsights: {
      GP: 'Office conversion programs may create opportunities for distressed office acquisitions. Evaluate portfolio office assets for conversion potential. Early-mover advantage may be significant.',
      LENDER: 'Conversion projects present both opportunities and risks. Construction financing for conversions requires specialized underwriting. Existing office loans may benefit from conversion as exit strategy.',
      LEGAL: 'Conversion projects involve complex zoning, building code, and land use issues. Tax incentive programs have specific compliance requirements. Consider implications for existing lease terminations.',
      LP: 'Office conversions represent a potential value-add strategy in a challenged sector. Higher risk but potentially attractive returns for successful executions.'
    }
  }
];

/**
 * Get mock news filtered and tailored for a specific role
 */
export function getMockNewsForRole(role) {
  return MOCK_NEWS_INSIGHTS.map(insight => ({
    id: insight.id,
    headline: insight.headline,
    summary: insight.summary,
    source: insight.source,
    sourceUrl: insight.sourceUrl,
    publishedAt: insight.publishedAt,
    relevance: insight.relevance,
    impact: insight.impact,
    roleSpecificInsight: insight.roleSpecificInsights[role] || insight.roleSpecificInsights.GP
  }));
}

/**
 * Get mock news for a specific deal (filters by deal-relevant topics)
 */
export function getMockNewsForDeal(dealId, dealProfile = {}) {
  const assetType = dealProfile.asset_type?.toLowerCase() || '';
  const location = (dealProfile.asset_city + ' ' + dealProfile.asset_state).toLowerCase();

  return MOCK_NEWS_INSIGHTS.filter(insight => {
    const topics = insight.relevance.topics.join(' ').toLowerCase();

    // Check if news is portfolio-wide (always relevant)
    if (insight.relevance.portfolioWide) return true;

    // Check asset type match
    if (assetType.includes('multifamily') && topics.includes('multifamily')) return true;
    if (assetType.includes('industrial') && topics.includes('industrial')) return true;
    if (assetType.includes('office') && topics.includes('office')) return true;

    // Check location match
    if (location.includes('austin') && topics.includes('sun-belt')) return true;
    if (location.includes('phoenix') && topics.includes('sun-belt')) return true;
    if (location.includes('dallas') && topics.includes('sun-belt')) return true;

    return false;
  });
}

/**
 * Generate a mock follow-up answer based on the insight and question
 */
export function getMockFollowupAnswer(insightId, question, role = 'GP', portfolioContext = {}) {
  const insight = MOCK_NEWS_INSIGHTS.find(n => n.id === insightId);
  if (!insight) {
    return {
      answer: "I couldn't find that news item. Please try again.",
      sources: []
    };
  }

  // Template-based responses for mock phase
  const questionLower = question.toLowerCase();

  if (insightId === 'mock-news-001') {
    // Fed rate cut insight
    if (questionLower.includes('austin') || questionLower.includes('specific')) {
      return {
        answer: "Based on your Austin portfolio, a 25bps rate cut could reduce annual interest expense by approximately $45,000 across floating-rate loans. The Austin Tower deal has a rate cap expiring in Q3, making refinancing timing favorable. Consider initiating lender conversations now to lock in favorable terms.",
        sources: [
          { type: 'portfolio_data', reference: 'Austin Tower loan terms' },
          { type: 'external', reference: 'Fed minutes January 2026' }
        ]
      };
    }
    if (questionLower.includes('refinanc')) {
      return {
        answer: "A rate cut environment typically improves refinancing conditions. Across your portfolio, 3 loans are approaching maturity in the next 18 months. Current spread compression suggests refinancing could reduce all-in rates by 40-60 basis points compared to origination.",
        sources: [
          { type: 'portfolio_data', reference: 'Loan maturity schedule' },
          { type: 'market_data', reference: 'CMBS spread tracker' }
        ]
      };
    }
  }

  if (insightId === 'mock-news-002') {
    // Sun Belt vacancy insight
    if (questionLower.includes('strategy') || questionLower.includes('what should')) {
      return {
        answer: "Key strategies for managing increased vacancy pressure: 1) Accelerate renewal discussions 6 months before expiry with competitive but not market-leading rates, 2) Increase marketing spend by 15-20% focusing on digital channels, 3) Consider short-term concessions (1-2 months free) to maintain occupancy above 92%, 4) Focus on tenant retention through enhanced amenities and service quality.",
        sources: [
          { type: 'industry_benchmark', reference: 'NMHC retention best practices' },
          { type: 'portfolio_data', reference: 'Historical lease renewal rates' }
        ]
      };
    }
  }

  if (insightId === 'mock-news-004') {
    // ESG disclosure insight
    if (questionLower.includes('cost') || questionLower.includes('how much')) {
      return {
        answer: "Initial ESG compliance costs are estimated at $15,000-25,000 per property for baseline assessments and $5,000-10,000 annually for ongoing reporting. However, energy efficiency improvements often generate 10-20% utility cost savings. Several properties in your portfolio may qualify for green financing incentives that could offset compliance costs.",
        sources: [
          { type: 'industry_estimate', reference: 'USGBC compliance cost study' },
          { type: 'portfolio_data', reference: 'Current utility expenses' }
        ]
      };
    }
  }

  // Default response
  return {
    answer: `Based on "${insight.headline}", ${insight.roleSpecificInsights[role] || insight.roleSpecificInsights.GP} Would you like me to analyze a specific aspect of this development in more detail?`,
    sources: [
      { type: 'external', reference: insight.source }
    ]
  };
}
