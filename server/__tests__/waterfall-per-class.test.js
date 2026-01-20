/**
 * Per-Class Waterfall Calculator Tests
 *
 * Tests the per-class waterfall calculation functionality where different
 * share classes can have different preferred returns and payment priorities.
 */

import {
  calculateWaterfall,
  groupLPsByClassPriority,
  calculateClassPreferred,
  allocateWithinClass,
  getSortedClassPriorities,
  getEffectivePreferredReturn,
  DEFAULT_WATERFALL_STRUCTURE
} from '../services/waterfall-calculator.js';

describe('Per-Class Waterfall Calculator', () => {
  // ============================================================================
  // HELPER FUNCTION TESTS
  // ============================================================================

  describe('groupLPsByClassPriority', () => {
    test('groups LPs by share class priority', () => {
      const lpOwnership = [
        {
          lpActorId: 'lp1',
          entityName: 'LP One',
          ownershipPct: 40,
          commitment: 4000000,
          shareClass: { id: 'c1', code: 'A', name: 'Class A', preferredReturn: 0.08, priority: 2 }
        },
        {
          lpActorId: 'lp2',
          entityName: 'LP Two',
          ownershipPct: 30,
          commitment: 3000000,
          shareClass: { id: 'c2', code: 'P', name: 'Preferred', preferredReturn: 0.10, priority: 1 }
        },
        {
          lpActorId: 'lp3',
          entityName: 'LP Three',
          ownershipPct: 30,
          commitment: 3000000,
          shareClass: { id: 'c1', code: 'A', name: 'Class A', preferredReturn: 0.08, priority: 2 }
        }
      ];

      const result = groupLPsByClassPriority(lpOwnership);

      expect(result.size).toBe(2);

      // Priority 1 (Preferred) should have 1 LP
      const prefClass = result.get(1);
      expect(prefClass.class.code).toBe('P');
      expect(prefClass.lps.length).toBe(1);
      expect(prefClass.totalCapital).toBe(3000000);

      // Priority 2 (Class A) should have 2 LPs
      const classA = result.get(2);
      expect(classA.class.code).toBe('A');
      expect(classA.lps.length).toBe(2);
      expect(classA.totalCapital).toBe(7000000);
    });

    test('handles LPs without share class', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 50, commitment: 5000000, shareClass: null },
        { lpActorId: 'lp2', ownershipPct: 50, commitment: 5000000 } // undefined shareClass
      ];

      const result = groupLPsByClassPriority(lpOwnership);

      // Both should be in priority 999 (no class)
      expect(result.size).toBe(1);
      expect(result.has(999)).toBe(true);
      expect(result.get(999).lps.length).toBe(2);
      expect(result.get(999).class.code).toBe('NONE');
    });

    test('returns empty map for empty input', () => {
      const result = groupLPsByClassPriority([]);
      expect(result.size).toBe(0);
    });
  });

  describe('calculateClassPreferred', () => {
    test('calculates preferred return correctly', () => {
      const classConfig = { code: 'A', preferredReturn: 0.08 };
      const result = calculateClassPreferred(classConfig, 1000000, 0, 1, 0);

      expect(result.accrued).toBe(80000); // 1M * 8% * 1 year
      expect(result.owed).toBe(80000);
      expect(result.paid).toBe(0);
    });

    test('accounts for capital returned', () => {
      const classConfig = { code: 'A', preferredReturn: 0.08 };
      // Half capital returned, so pref accrues on remaining $500k
      const result = calculateClassPreferred(classConfig, 1000000, 500000, 1, 0);

      expect(result.accrued).toBe(40000); // 500k * 8% * 1 year
      expect(result.owed).toBe(40000);
    });

    test('accounts for pref already paid', () => {
      const classConfig = { code: 'A', preferredReturn: 0.08 };
      const result = calculateClassPreferred(classConfig, 1000000, 0, 2, 100000);

      expect(result.accrued).toBe(160000); // 1M * 8% * 2 years
      expect(result.paid).toBe(100000);
      expect(result.owed).toBe(60000); // 160k - 100k
    });

    test('handles zero preferred return', () => {
      const classConfig = { code: 'B', preferredReturn: 0 };
      const result = calculateClassPreferred(classConfig, 1000000, 0, 1, 0);

      expect(result.accrued).toBe(0);
      expect(result.owed).toBe(0);
    });
  });

  describe('allocateWithinClass', () => {
    test('allocates pro-rata based on ownership', () => {
      const lps = [
        { lpActorId: 'lp1', ownershipPct: 60 },
        { lpActorId: 'lp2', ownershipPct: 40 }
      ];

      const result = allocateWithinClass(lps, 100000, 100);

      expect(result.get('lp1')).toBe(60000);
      expect(result.get('lp2')).toBe(40000);
    });

    test('handles rounding correctly', () => {
      const lps = [
        { lpActorId: 'lp1', ownershipPct: 33.33 },
        { lpActorId: 'lp2', ownershipPct: 33.33 },
        { lpActorId: 'lp3', ownershipPct: 33.34 }
      ];

      const result = allocateWithinClass(lps, 100000, 100);

      // Sum should equal total amount (rounding adjustment to largest holder)
      const total = result.get('lp1') + result.get('lp2') + result.get('lp3');
      expect(total).toBe(100000);
    });

    test('splits evenly when no ownership data', () => {
      const lps = [
        { lpActorId: 'lp1', ownershipPct: 0 },
        { lpActorId: 'lp2', ownershipPct: 0 }
      ];

      const result = allocateWithinClass(lps, 100000, 0);

      expect(result.get('lp1')).toBe(50000);
      expect(result.get('lp2')).toBe(50000);
    });

    test('returns empty map for zero amount', () => {
      const lps = [{ lpActorId: 'lp1', ownershipPct: 100 }];
      const result = allocateWithinClass(lps, 0, 100);
      expect(result.size).toBe(0);
    });
  });

  describe('getSortedClassPriorities', () => {
    test('sorts by priority ascending', () => {
      const classMap = new Map([
        [3, { class: { code: 'C' } }],
        [1, { class: { code: 'P' } }],
        [2, { class: { code: 'A' } }]
      ]);

      const sorted = getSortedClassPriorities(classMap);

      expect(sorted[0][0]).toBe(1);
      expect(sorted[0][1].class.code).toBe('P');
      expect(sorted[1][0]).toBe(2);
      expect(sorted[1][1].class.code).toBe('A');
      expect(sorted[2][0]).toBe(3);
      expect(sorted[2][1].class.code).toBe('C');
    });
  });

  describe('getEffectivePreferredReturn', () => {
    test('uses class pref when defined', () => {
      const classConfig = { code: 'P', preferredReturn: 0.10 };
      const result = getEffectivePreferredReturn(classConfig, 0.08);
      expect(result).toBe(0.10);
    });

    test('falls back to deal-level pref when class has no pref', () => {
      const classConfig = { code: 'A', preferredReturn: null };
      const result = getEffectivePreferredReturn(classConfig, 0.08);
      expect(result).toBe(0.08);
    });

    test('handles zero as valid class pref', () => {
      const classConfig = { code: 'B', preferredReturn: 0 };
      const result = getEffectivePreferredReturn(classConfig, 0.08);
      expect(result).toBe(0);
    });
  });

  // ============================================================================
  // BACKWARD COMPATIBILITY TESTS
  // ============================================================================

  describe('Backward Compatibility', () => {
    const standardStructure = {
      lpEquity: 9000000,
      gpEquity: 1000000,
      preferredReturn: 0.08,
      promoteTiers: [
        { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
        { hurdle: Infinity, lpSplit: 0.70, gpSplit: 0.30 }
      ],
      gpCatchUp: true,
      catchUpPercent: 1.0
    };

    const cashFlows = [500000, 600000, 700000, 800000, 12000000]; // 5-year hold

    test('calculateWaterfall without options unchanged', () => {
      const result = calculateWaterfall(cashFlows, standardStructure);

      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.summary.lpIRR).toBeDefined();
      expect(result.summary.gpIRR).toBeDefined();
      expect(result.summary.lpTotalReturn).toBeGreaterThan(0);
      expect(result.summary.gpTotalReturn).toBeGreaterThan(0);
    });

    test('with useClassTerms=false unchanged', () => {
      const result = calculateWaterfall(cashFlows, standardStructure, {
        useClassTerms: false
      });

      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.byClass).toBeUndefined(); // No per-class breakdown
    });

    test('with perClassConfig but useClassTerms=false uses standard calc', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 100, commitment: 9000000, shareClass: { code: 'A', preferredReturn: 0.08, priority: 1 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const result = calculateWaterfall(cashFlows, standardStructure, {
        useClassTerms: false,
        perClassConfig
      });

      expect(result.error).toBeUndefined();
      expect(result.byClass).toBeUndefined(); // Standard calc, no per-class
    });
  });

  // ============================================================================
  // PER-CLASS WATERFALL TESTS
  // ============================================================================

  describe('Per-Class Waterfall - Single Class', () => {
    test('single class should return valid results', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 60, commitment: 5400000, shareClass: { code: 'A', preferredReturn: 0.08, priority: 1 } },
        { lpActorId: 'lp2', ownershipPct: 40, commitment: 3600000, shareClass: { code: 'A', preferredReturn: 0.08, priority: 1 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [
          { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
          { hurdle: Infinity, lpSplit: 0.70, gpSplit: 0.30 }
        ],
        gpCatchUp: true,
        catchUpPercent: 1.0
      };

      const cashFlows = [500000, 600000, 700000, 800000, 12000000];

      const result = calculateWaterfall(cashFlows, structure, {
        useClassTerms: true,
        perClassConfig
      });

      expect(result.error).toBeUndefined();
      expect(result.summary).toBeDefined();
      expect(result.byClass).toBeDefined();
      expect(result.byClass.A).toBeDefined();
      expect(result.byClass.A.totalDistributed).toBeGreaterThan(0);
    });
  });

  describe('Per-Class Waterfall - Multiple Classes', () => {
    const createMultiClassConfig = () => {
      const lpOwnership = [
        // Preferred class (10% pref, priority 1) - $2M
        { lpActorId: 'pref1', ownershipPct: 20, commitment: 2000000, shareClass: { code: 'P', name: 'Preferred', preferredReturn: 0.10, priority: 1 } },
        // Class A (8% pref, priority 2) - $5M
        { lpActorId: 'classA1', ownershipPct: 30, commitment: 3000000, shareClass: { code: 'A', name: 'Class A', preferredReturn: 0.08, priority: 2 } },
        { lpActorId: 'classA2', ownershipPct: 20, commitment: 2000000, shareClass: { code: 'A', name: 'Class A', preferredReturn: 0.08, priority: 2 } },
        // Class B (6% pref, priority 3) - $2M
        { lpActorId: 'classB1', ownershipPct: 20, commitment: 2000000, shareClass: { code: 'B', name: 'Class B', preferredReturn: 0.06, priority: 3 } }
      ];
      return groupLPsByClassPriority(lpOwnership);
    };

    const multiClassStructure = {
      lpEquity: 9000000,
      gpEquity: 1000000,
      preferredReturn: 0.08,
      promoteTiers: [
        { hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 },
        { hurdle: Infinity, lpSplit: 0.70, gpSplit: 0.30 }
      ],
      gpCatchUp: true,
      catchUpPercent: 1.0
    };

    test('should have per-class breakdown in results', () => {
      const perClassConfig = createMultiClassConfig();
      const cashFlows = [500000, 600000, 700000, 800000, 12000000];

      const result = calculateWaterfall(cashFlows, multiClassStructure, {
        useClassTerms: true,
        perClassConfig
      });

      expect(result.byClass).toBeDefined();
      expect(result.byClass.P).toBeDefined();
      expect(result.byClass.A).toBeDefined();
      expect(result.byClass.B).toBeDefined();
    });

    test('different classes should have different effective pref rates', () => {
      const perClassConfig = createMultiClassConfig();
      const cashFlows = [500000, 600000, 700000, 800000, 12000000];

      const result = calculateWaterfall(cashFlows, multiClassStructure, {
        useClassTerms: true,
        perClassConfig
      });

      // Preferred class should show 10% effective pref
      expect(result.byClass.P.effectivePref).toBe(0.10);
      // Class A should show 8% effective pref
      expect(result.byClass.A.effectivePref).toBe(0.08);
      // Class B should show 6% effective pref
      expect(result.byClass.B.effectivePref).toBe(0.06);
    });

    test('priority 1 class (Preferred) should receive distributions first', () => {
      const perClassConfig = createMultiClassConfig();
      // Small cash flow that only covers part of capital return
      const cashFlows = [1000000]; // Only $1M to distribute

      const result = calculateWaterfall(cashFlows, multiClassStructure, {
        useClassTerms: true,
        perClassConfig
      });

      // Year 1 distributions - Preferred (priority 1) gets capital first
      const year1 = result.yearlyDistributions[0];

      // Preferred class ($2M capital) should get full $1M first if priority works
      // Since total LP capital is $9M and cash is $1M, Preferred ($2M) should get it first
      expect(year1.byClass.P.capitalReturn).toBeGreaterThan(0);
    });

    test('total distributions should equal total cash flows', () => {
      const perClassConfig = createMultiClassConfig();
      const cashFlows = [500000, 600000, 700000, 800000, 12000000];
      const totalCash = cashFlows.reduce((sum, cf) => sum + cf, 0);

      const result = calculateWaterfall(cashFlows, multiClassStructure, {
        useClassTerms: true,
        perClassConfig
      });

      const lpTotal = result.summary.lpTotalReturn;
      const gpTotal = result.summary.gpTotalReturn;

      // Allow small floating point tolerance
      expect(Math.abs(lpTotal + gpTotal - totalCash)).toBeLessThan(1);
    });

    test('structure.perClassTerms should contain all class terms', () => {
      const perClassConfig = createMultiClassConfig();
      const cashFlows = [500000, 600000, 700000, 800000, 12000000];

      const result = calculateWaterfall(cashFlows, multiClassStructure, {
        useClassTerms: true,
        perClassConfig
      });

      expect(result.structure.perClassTerms).toBeDefined();
      expect(result.structure.perClassTerms.P).toBeDefined();
      expect(result.structure.perClassTerms.P.preferredReturn).toBe(0.10);
      expect(result.structure.perClassTerms.A.preferredReturn).toBe(0.08);
      expect(result.structure.perClassTerms.B.preferredReturn).toBe(0.06);
    });
  });

  describe('Per-Class Waterfall - Priority Ordering', () => {
    test('senior class fully paid before junior in limited cash scenario', () => {
      // Create scenario where cash is limited
      const lpOwnership = [
        // Senior class (priority 1) - $3M commitment
        { lpActorId: 'senior1', ownershipPct: 30, commitment: 3000000, shareClass: { code: 'S', name: 'Senior', preferredReturn: 0.10, priority: 1 } },
        // Junior class (priority 2) - $6M commitment
        { lpActorId: 'junior1', ownershipPct: 60, commitment: 6000000, shareClass: { code: 'J', name: 'Junior', preferredReturn: 0.08, priority: 2 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [{ hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }],
        gpCatchUp: false
      };

      // Cash only covers Senior capital + some pref
      const cashFlows = [3500000]; // $3.5M

      const result = calculateWaterfall(cashFlows, structure, {
        useClassTerms: true,
        perClassConfig
      });

      // Senior ($3M capital) should be fully returned
      expect(result.byClass.S.capitalReturned).toBe(3000000);

      // Junior should get remaining $500k toward their $6M capital
      expect(result.byClass.J.capitalReturned).toBe(500000);
    });
  });

  describe('Per-Class Waterfall - GP Catch-up', () => {
    test('GP catch-up only after ALL classes pref paid', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 50, commitment: 4500000, shareClass: { code: 'A', preferredReturn: 0.08, priority: 1 } },
        { lpActorId: 'lp2', ownershipPct: 50, commitment: 4500000, shareClass: { code: 'B', preferredReturn: 0.06, priority: 2 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [{ hurdle: 0.12, lpSplit: 0.80, gpSplit: 0.20 }],
        gpCatchUp: true,
        catchUpPercent: 1.0
      };

      // Enough cash to cover capital + pref + some promote
      const cashFlows = [2000000, 2000000, 2000000, 2000000, 15000000];

      const result = calculateWaterfall(cashFlows, structure, {
        useClassTerms: true,
        perClassConfig
      });

      // Both classes should have their pref paid
      expect(result.byClass.A.prefPaid).toBeGreaterThan(0);
      expect(result.byClass.B.prefPaid).toBeGreaterThan(0);

      // GP should have received catch-up
      expect(result.summary.gpCatchUpPaid).toBeGreaterThan(0);
    });
  });

  describe('Per-Class Waterfall - Edge Cases', () => {
    test('handles class with zero preferred return', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 100, commitment: 9000000, shareClass: { code: 'Z', preferredReturn: 0, priority: 1 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [{ hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }],
        gpCatchUp: false
      };

      const cashFlows = [500000, 12000000];

      const result = calculateWaterfall(cashFlows, structure, {
        useClassTerms: true,
        perClassConfig
      });

      expect(result.error).toBeUndefined();
      expect(result.byClass.Z.effectivePref).toBe(0);
      expect(result.byClass.Z.prefPaid).toBe(0);
    });

    test('handles single-year cash flow', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 100, commitment: 9000000, shareClass: { code: 'A', preferredReturn: 0.08, priority: 1 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [{ hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }],
        gpCatchUp: false
      };

      const cashFlows = [12000000]; // Single exit

      const result = calculateWaterfall(cashFlows, structure, {
        useClassTerms: true,
        perClassConfig
      });

      expect(result.error).toBeUndefined();
      expect(result.yearlyDistributions.length).toBe(1);
    });

    test('handles very small cash flow', () => {
      const lpOwnership = [
        { lpActorId: 'lp1', ownershipPct: 100, commitment: 9000000, shareClass: { code: 'A', preferredReturn: 0.08, priority: 1 } }
      ];
      const perClassConfig = groupLPsByClassPriority(lpOwnership);

      const structure = {
        lpEquity: 9000000,
        gpEquity: 1000000,
        preferredReturn: 0.08,
        promoteTiers: [{ hurdle: Infinity, lpSplit: 0.80, gpSplit: 0.20 }],
        gpCatchUp: false
      };

      const cashFlows = [100]; // Very small

      const result = calculateWaterfall(cashFlows, structure, {
        useClassTerms: true,
        perClassConfig
      });

      expect(result.error).toBeUndefined();
      expect(result.summary.lpTotalReturn + result.summary.gpTotalReturn).toBe(100);
    });
  });
});
