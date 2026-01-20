import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from '@/lib/utils';
import {
  Sparkles,
  AlertTriangle,
  AlertCircle,
  CheckCircle,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  DollarSign,
  Building2,
  BarChart3,
  Shield,
  Loader2
} from 'lucide-react';

/**
 * InsightsPanel - Displays AI-generated insights for a deal
 *
 * Features:
 * - Auto-generated insights grouped by category
 * - Severity-based styling (CRITICAL, WARNING, INFO, POSITIVE)
 * - Expandable/collapsible sections
 * - Refresh capability
 * - Summary with blockers indicator
 */
export default function InsightsPanel({ dealId }) {
  const [expandedCategories, setExpandedCategories] = useState(new Set(['CRITICAL', 'WARNING']));

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['deal-insights', dealId],
    queryFn: () => bff.dealAI.getInsights(dealId),
    enabled: !!dealId,
    staleTime: 60000 // Cache for 1 minute
  });

  const insights = data?.insights || [];
  const summary = data?.summary || { total: 0, critical: 0, warnings: 0, info: 0, positive: 0, hasBlockers: false };

  // Group insights by category
  const groupedInsights = insights.reduce((acc, insight) => {
    const category = insight.category || 'OTHER';
    if (!acc[category]) acc[category] = [];
    acc[category].push(insight);
    return acc;
  }, {});

  // Sort categories by severity (most critical first)
  const categoryOrder = ['DEBT', 'VALUATION', 'OPERATIONS', 'RETURNS', 'MARKET', 'RISK', 'STRUCTURE', 'OTHER'];
  const sortedCategories = Object.keys(groupedInsights).sort((a, b) => {
    const aIndex = categoryOrder.indexOf(a);
    const bIndex = categoryOrder.indexOf(b);
    return (aIndex === -1 ? 999 : aIndex) - (bIndex === -1 ? 999 : bIndex);
  });

  const toggleCategory = (category) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'DEBT':
        return DollarSign;
      case 'VALUATION':
        return BarChart3;
      case 'OPERATIONS':
        return Building2;
      case 'RETURNS':
        return TrendingUp;
      case 'MARKET':
        return BarChart3;
      case 'RISK':
        return Shield;
      default:
        return Info;
    }
  };

  const getSeverityConfig = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return {
          icon: AlertCircle,
          color: 'text-red-600',
          bg: 'bg-red-50',
          border: 'border-red-200',
          badge: 'destructive'
        };
      case 'WARNING':
        return {
          icon: AlertTriangle,
          color: 'text-amber-600',
          bg: 'bg-amber-50',
          border: 'border-amber-200',
          badge: 'warning'
        };
      case 'POSITIVE':
        return {
          icon: CheckCircle,
          color: 'text-green-600',
          bg: 'bg-green-50',
          border: 'border-green-200',
          badge: 'success'
        };
      case 'INFO':
      default:
        return {
          icon: Info,
          color: 'text-blue-600',
          bg: 'bg-blue-50',
          border: 'border-blue-200',
          badge: 'secondary'
        };
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-red-600 mb-2">Failed to load insights</p>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-purple-600" />
            AI Insights
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
          </Button>
        </div>

        {/* Summary badges */}
        <div className="flex flex-wrap gap-2 mt-2">
          {summary.critical > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertCircle className="w-3 h-3" />
              {summary.critical} Critical
            </Badge>
          )}
          {summary.warnings > 0 && (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1">
              <AlertTriangle className="w-3 h-3" />
              {summary.warnings} Warnings
            </Badge>
          )}
          {summary.positive > 0 && (
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100 gap-1">
              <CheckCircle className="w-3 h-3" />
              {summary.positive} Positive
            </Badge>
          )}
          {summary.info > 0 && (
            <Badge variant="secondary" className="gap-1">
              <Info className="w-3 h-3" />
              {summary.info} Info
            </Badge>
          )}
        </div>

        {/* Blockers indicator */}
        {summary.hasBlockers && (
          <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-md flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600" />
            <span className="text-sm text-red-800 font-medium">
              This deal has potential blockers that need review
            </span>
          </div>
        )}
      </CardHeader>

      <CardContent>
        {insights.length === 0 ? (
          <div className="text-center py-8 text-[#737373]">
            <Info className="w-8 h-8 mx-auto mb-2 text-[#A3A3A3]" />
            <p className="text-sm">No insights generated yet</p>
            <p className="text-xs mt-1">Add underwriting data to see AI-generated insights</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[500px]">
            <div className="space-y-3">
              {sortedCategories.map((category) => {
                const categoryInsights = groupedInsights[category];
                const CategoryIcon = getCategoryIcon(category);
                const isExpanded = expandedCategories.has(category);

                // Check if category has critical/warning items
                const hasCritical = categoryInsights.some(i => i.severity === 'CRITICAL');
                const hasWarning = categoryInsights.some(i => i.severity === 'WARNING');

                return (
                  <Collapsible
                    key={category}
                    open={isExpanded}
                    onOpenChange={() => toggleCategory(category)}
                  >
                    <CollapsibleTrigger asChild>
                      <button className={cn(
                        "w-full flex items-center justify-between p-2 rounded-md transition-colors",
                        "hover:bg-[#F5F5F5]",
                        hasCritical && "bg-red-50 hover:bg-red-100",
                        !hasCritical && hasWarning && "bg-amber-50 hover:bg-amber-100"
                      )}>
                        <div className="flex items-center gap-2">
                          {isExpanded ? (
                            <ChevronDown className="w-4 h-4 text-[#737373]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[#737373]" />
                          )}
                          <CategoryIcon className="w-4 h-4 text-[#525252]" />
                          <span className="text-sm font-medium text-[#171717]">
                            {formatCategoryName(category)}
                          </span>
                        </div>
                        <Badge variant="secondary" className="text-xs">
                          {categoryInsights.length}
                        </Badge>
                      </button>
                    </CollapsibleTrigger>

                    <CollapsibleContent>
                      <div className="ml-6 mt-1 space-y-2">
                        {categoryInsights.map((insight, idx) => {
                          const config = getSeverityConfig(insight.severity);
                          const Icon = config.icon;

                          return (
                            <div
                              key={idx}
                              className={cn(
                                "p-3 rounded-md border",
                                config.bg,
                                config.border
                              )}
                            >
                              <div className="flex items-start gap-2">
                                <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", config.color)} />
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-[#171717]">{insight.message}</p>

                                  {insight.recommendation && (
                                    <p className="text-xs text-[#525252] mt-1 flex items-center gap-1">
                                      <TrendingUp className="w-3 h-3" />
                                      {insight.recommendation}
                                    </p>
                                  )}

                                  {insight.metric && insight.threshold && (
                                    <div className="mt-2 flex items-center gap-2 text-xs text-[#737373]">
                                      <span>{insight.metric}:</span>
                                      <code className="px-1 bg-white rounded">
                                        {formatMetricValue(insight.metric, insight.value)}
                                      </code>
                                      <span>vs threshold</span>
                                      <code className="px-1 bg-white rounded">
                                        {formatMetricValue(insight.metric, insight.threshold)}
                                      </code>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function formatCategoryName(category) {
  const names = {
    DEBT: 'Debt & Coverage',
    VALUATION: 'Valuation',
    OPERATIONS: 'Operations',
    RETURNS: 'Returns',
    MARKET: 'Market',
    RISK: 'Risk Factors',
    STRUCTURE: 'Deal Structure',
    OTHER: 'Other'
  };
  return names[category] || category;
}

function formatMetricValue(metric, value) {
  if (value == null) return 'N/A';

  // Percentage metrics
  if (['irr', 'cashOnCash', 'goingInCapRate', 'exitCapRate', 'ltv', 'debtYield', 'vacancyRate', 'expenseRatio'].includes(metric)) {
    return `${(value * 100).toFixed(1)}%`;
  }

  // Multiple metrics
  if (['equityMultiple', 'dscr'].includes(metric)) {
    return `${value.toFixed(2)}x`;
  }

  // Currency
  if (['noi', 'debtService', 'purchasePrice', 'loanAmount'].includes(metric)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  }

  return value.toString();
}
