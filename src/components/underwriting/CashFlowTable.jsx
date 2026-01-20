import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Download,
  TrendingUp,
  DollarSign,
  Building2,
  Printer,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export default function CashFlowTable({ dealId }) {
  const [holdYears, setHoldYears] = useState(5);
  const [expandedSections, setExpandedSections] = useState({
    revenue: true,
    expenses: true,
    debt: true,
    cashflow: true,
    exit: true
  });

  // Fetch cash flows
  const { data: cashFlowData, isLoading, error } = useQuery({
    queryKey: ['cash-flows', dealId, holdYears],
    queryFn: () => bff.underwriting.getCashFlows(dealId, holdYears),
    enabled: !!dealId
  });

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleExportCSV = () => {
    if (!cashFlowData?.cashFlows?.years) {
      toast({ title: 'No data to export', variant: 'destructive' });
      return;
    }

    const { years, exit, totals } = cashFlowData.cashFlows;
    const rows = [];

    // Header row
    rows.push(['', ...years.map(y => `Year ${y.year}`)].join(','));

    // Revenue section
    rows.push('REVENUE');
    rows.push(['Gross Potential Rent', ...years.map(y => y.revenue.grossPotentialRent)].join(','));
    rows.push(['Vacancy Loss', ...years.map(y => -y.revenue.vacancy)].join(','));
    rows.push(['Other Income', ...years.map(y => y.revenue.otherIncome)].join(','));
    rows.push(['Effective Gross Income', ...years.map(y => y.revenue.effectiveGrossIncome)].join(','));

    // Expenses section
    rows.push('');
    rows.push('EXPENSES');
    rows.push(['Operating Expenses', ...years.map(y => y.expenses.operating)].join(','));
    rows.push(['Real Estate Taxes', ...years.map(y => y.expenses.taxes)].join(','));
    rows.push(['Insurance', ...years.map(y => y.expenses.insurance)].join(','));
    rows.push(['Management', ...years.map(y => y.expenses.management)].join(','));
    rows.push(['Reserves', ...years.map(y => y.expenses.reserves)].join(','));
    rows.push(['Total Expenses', ...years.map(y => y.expenses.totalExpenses)].join(','));

    // NOI
    rows.push('');
    rows.push(['NET OPERATING INCOME', ...years.map(y => y.noi)].join(','));

    // Debt section
    rows.push('');
    rows.push('DEBT SERVICE');
    rows.push(['Interest Payment', ...years.map(y => y.debtService.interestPayment)].join(','));
    rows.push(['Principal Payment', ...years.map(y => y.debtService.principalPayment)].join(','));
    rows.push(['Total Debt Service', ...years.map(y => y.debtService.totalDebtService)].join(','));
    rows.push(['Ending Loan Balance', ...years.map(y => y.debtService.endingBalance)].join(','));

    // Cash flow
    rows.push('');
    rows.push(['BEFORE-TAX CASH FLOW', ...years.map(y => y.beforeTaxCashFlow)].join(','));
    rows.push(['Cumulative Cash Flow', ...years.map(y => y.cumulativeCashFlow)].join(','));

    // Exit
    if (exit) {
      rows.push('');
      rows.push('EXIT ANALYSIS');
      rows.push(['Exit NOI', exit.exitNOI].join(','));
      rows.push(['Exit Cap Rate', exit.exitCapRate].join(','));
      rows.push(['Gross Sale Price', exit.grossSalePrice].join(','));
      rows.push(['Selling Costs', exit.sellingCosts].join(','));
      rows.push(['Net Sale Proceeds', exit.netSaleProceeds].join(','));
      rows.push(['Loan Payoff', exit.loanPayoff].join(','));
      rows.push(['Net Equity Proceeds', exit.netEquityProceeds].join(','));
    }

    // Totals
    if (totals) {
      rows.push('');
      rows.push('RETURNS SUMMARY');
      rows.push(['Total Cash Distributed', totals.totalCashDistributed].join(','));
      rows.push(['Equity Invested', totals.equityInvested].join(','));
      rows.push(['IRR', totals.irr].join(','));
      rows.push(['Equity Multiple', totals.equityMultiple].join(','));
    }

    const csv = rows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cash-flows-${dealId}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({ title: 'Exported to CSV', description: 'Cash flow data downloaded.' });
  };

  const handlePrint = () => {
    window.print();
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-slate-100 rounded w-1/4"></div>
            <div className="h-64 bg-slate-100 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-red-600">Failed to load cash flows: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  const { years, exit, totals, assumptions } = cashFlowData?.cashFlows || {};

  if (!years || years.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Building2 className="w-12 h-12 mx-auto text-slate-300 mb-4" />
          <p className="text-slate-500">No cash flow data available</p>
          <p className="text-sm text-slate-400 mt-2">
            Add underwriting inputs to generate cash flow projections
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 print:space-y-4">
      {/* Header with controls */}
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h3 className="text-lg font-semibold text-[#171717]">Year-by-Year Cash Flows</h3>
          <p className="text-sm text-[#737373]">
            Detailed annual projection with {assumptions?.holdPeriod || holdYears}-year hold
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={holdYears.toString()} onValueChange={(v) => setHoldYears(parseInt(v))}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Hold Period" />
            </SelectTrigger>
            <SelectContent>
              {[3, 5, 7, 10].map(y => (
                <SelectItem key={y} value={y.toString()}>{y} Years</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2">
            <Printer className="w-4 h-4" />
            Print
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4 print:grid-cols-4">
        <SummaryCard
          label="Total NOI"
          value={years.reduce((sum, y) => sum + y.noi, 0)}
          type="currency"
          icon={TrendingUp}
          color="green"
        />
        <SummaryCard
          label="Avg Cash-on-Cash"
          value={totals?.avgCashOnCash}
          type="percentage"
          icon={DollarSign}
          color="blue"
        />
        <SummaryCard
          label="Levered IRR"
          value={totals?.irr}
          type="percentage"
          icon={TrendingUp}
          color="emerald"
        />
        <SummaryCard
          label="Equity Multiple"
          value={totals?.equityMultiple}
          type="multiple"
          icon={TrendingUp}
          color="violet"
        />
      </div>

      {/* Main cash flow table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left p-3 font-medium text-[#737373] min-w-[200px]"></th>
                  {years.map(y => (
                    <th key={y.year} className="text-right p-3 font-medium text-[#737373] min-w-[100px]">
                      Year {y.year}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {/* Revenue Section */}
                <SectionHeader
                  label="REVENUE"
                  isExpanded={expandedSections.revenue}
                  onToggle={() => toggleSection('revenue')}
                  color="emerald"
                />
                {expandedSections.revenue && (
                  <>
                    <DataRow label="Gross Potential Rent" values={years.map(y => y.revenue.grossPotentialRent)} type="currency" />
                    <DataRow label="Vacancy Loss" values={years.map(y => -y.revenue.vacancy)} type="currency" isNegative />
                    <DataRow label="Other Income" values={years.map(y => y.revenue.otherIncome)} type="currency" />
                  </>
                )}
                <TotalRow label="Effective Gross Income" values={years.map(y => y.revenue.effectiveGrossIncome)} type="currency" color="emerald" />

                {/* Expenses Section */}
                <SectionHeader
                  label="EXPENSES"
                  isExpanded={expandedSections.expenses}
                  onToggle={() => toggleSection('expenses')}
                  color="red"
                />
                {expandedSections.expenses && (
                  <>
                    <DataRow label="Operating Expenses" values={years.map(y => y.expenses.operating)} type="currency" />
                    <DataRow label="Real Estate Taxes" values={years.map(y => y.expenses.taxes)} type="currency" />
                    <DataRow label="Insurance" values={years.map(y => y.expenses.insurance)} type="currency" />
                    <DataRow label="Management" values={years.map(y => y.expenses.management)} type="currency" />
                    <DataRow label="Reserves" values={years.map(y => y.expenses.reserves)} type="currency" />
                  </>
                )}
                <TotalRow label="Total Operating Expenses" values={years.map(y => y.expenses.totalExpenses)} type="currency" color="red" />

                {/* NOI */}
                <tr className="bg-blue-50 border-t-2 border-b-2 border-blue-200">
                  <td className="p-3 font-bold text-blue-800">NET OPERATING INCOME</td>
                  {years.map((y, i) => (
                    <td key={i} className="p-3 text-right font-bold text-blue-800">
                      {formatCurrency(y.noi)}
                    </td>
                  ))}
                </tr>

                {/* Debt Service Section */}
                <SectionHeader
                  label="DEBT SERVICE"
                  isExpanded={expandedSections.debt}
                  onToggle={() => toggleSection('debt')}
                  color="violet"
                />
                {expandedSections.debt && (
                  <>
                    <DataRow label="Interest Payment" values={years.map(y => y.debtService.interestPayment)} type="currency" />
                    <DataRow label="Principal Payment" values={years.map(y => y.debtService.principalPayment)} type="currency" />
                  </>
                )}
                <TotalRow label="Total Debt Service" values={years.map(y => y.debtService.totalDebtService)} type="currency" color="violet" />
                <DataRow label="Ending Loan Balance" values={years.map(y => y.debtService.endingBalance)} type="currency" isSubtle />

                {/* Cash Flow Section */}
                <SectionHeader
                  label="CASH FLOW"
                  isExpanded={expandedSections.cashflow}
                  onToggle={() => toggleSection('cashflow')}
                  color="green"
                />
                {expandedSections.cashflow && (
                  <>
                    <tr className="bg-green-50 border-t border-green-200">
                      <td className="p-3 font-semibold text-green-800">Before-Tax Cash Flow</td>
                      {years.map((y, i) => (
                        <td key={i} className={cn(
                          "p-3 text-right font-semibold",
                          y.beforeTaxCashFlow >= 0 ? "text-green-700" : "text-red-600"
                        )}>
                          {formatCurrency(y.beforeTaxCashFlow)}
                        </td>
                      ))}
                    </tr>
                    <DataRow label="Cumulative Cash Flow" values={years.map(y => y.cumulativeCashFlow)} type="currency" highlightNegative />
                    <DataRow label="Cash-on-Cash Return" values={years.map(y => y.cashOnCash)} type="percentage" />
                    <DataRow label="DSCR" values={years.map(y => y.dscr)} type="ratio" />
                  </>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Exit Analysis */}
      {exit && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4" />
              Exit Analysis (Year {assumptions?.holdPeriod || holdYears})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-3">
                <h4 className="font-medium text-[#737373] text-sm">Sale Proceeds</h4>
                <ExitRow label="Exit NOI" value={exit.exitNOI} type="currency" />
                <ExitRow label="Exit Cap Rate" value={exit.exitCapRate} type="percentage" />
                <ExitRow label="Gross Sale Price" value={exit.grossSalePrice} type="currency" highlight />
                <ExitRow label="Selling Costs (2%)" value={exit.sellingCosts} type="currency" isNegative />
                <ExitRow label="Net Sale Proceeds" value={exit.netSaleProceeds} type="currency" />
              </div>
              <div className="space-y-3">
                <h4 className="font-medium text-[#737373] text-sm">Net Equity Proceeds</h4>
                <ExitRow label="Net Sale Proceeds" value={exit.netSaleProceeds} type="currency" />
                <ExitRow label="Loan Payoff" value={exit.loanPayoff} type="currency" isNegative />
                <div className="border-t pt-2 mt-2">
                  <ExitRow label="Net to Equity" value={exit.netEquityProceeds} type="currency" highlight />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Returns Summary */}
      {totals && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-green-800">
              <TrendingUp className="w-4 h-4" />
              Investment Returns Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <ReturnBox label="Total Cash Distributed" value={totals.totalCashDistributed} type="currency" />
              <ReturnBox label="Equity Invested" value={totals.equityInvested} type="currency" />
              <ReturnBox label="Levered IRR" value={totals.irr} type="percentage" highlight />
              <ReturnBox label="Equity Multiple" value={totals.equityMultiple} type="multiple" highlight />
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-green-200">
              <ReturnBox label="Average Cash-on-Cash" value={totals.avgCashOnCash} type="percentage" />
              <ReturnBox label="Average DSCR" value={totals.avgDSCR} type="ratio" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Helper Components

function SummaryCard({ label, value, type, icon: Icon, color }) {
  const colorMap = {
    green: 'bg-green-50 text-green-600 border-green-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    emerald: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100'
  };

  return (
    <div className={cn("p-4 rounded-xl border", colorMap[color])}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="w-4 h-4" />
        <span className="text-sm opacity-75">{label}</span>
      </div>
      <div className="text-xl font-semibold">
        {formatValue(value, type)}
      </div>
    </div>
  );
}

function SectionHeader({ label, isExpanded, onToggle, color }) {
  const colorMap = {
    emerald: 'bg-emerald-100 text-emerald-800',
    red: 'bg-red-100 text-red-800',
    violet: 'bg-violet-100 text-violet-800',
    green: 'bg-green-100 text-green-800'
  };

  return (
    <tr
      className={cn("cursor-pointer hover:opacity-80 transition-opacity", colorMap[color])}
      onClick={onToggle}
    >
      <td colSpan={100} className="p-2 font-semibold text-xs tracking-wide">
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {label}
        </div>
      </td>
    </tr>
  );
}

function DataRow({ label, values, type, isNegative, isSubtle, highlightNegative }) {
  return (
    <tr className={cn("border-b border-slate-100", isSubtle && "text-[#737373]")}>
      <td className={cn("p-3 pl-6", isSubtle ? "text-xs" : "text-sm")}>{label}</td>
      {values.map((v, i) => (
        <td
          key={i}
          className={cn(
            "p-3 text-right",
            isSubtle ? "text-xs" : "text-sm",
            isNegative && "text-red-600",
            highlightNegative && v < 0 && "text-red-600"
          )}
        >
          {formatValue(v, type)}
        </td>
      ))}
    </tr>
  );
}

function TotalRow({ label, values, type, color }) {
  const colorMap = {
    emerald: 'bg-emerald-50 text-emerald-800 border-emerald-200',
    red: 'bg-red-50 text-red-800 border-red-200',
    violet: 'bg-violet-50 text-violet-800 border-violet-200',
    green: 'bg-green-50 text-green-800 border-green-200'
  };

  return (
    <tr className={cn("border-t border-b", colorMap[color])}>
      <td className="p-3 pl-6 font-medium text-sm">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="p-3 text-right font-medium text-sm">
          {formatValue(v, type)}
        </td>
      ))}
    </tr>
  );
}

function ExitRow({ label, value, type, highlight, isNegative }) {
  return (
    <div className={cn(
      "flex items-center justify-between py-1",
      highlight && "font-semibold text-[#171717]"
    )}>
      <span className={cn("text-sm", !highlight && "text-[#737373]")}>{label}</span>
      <span className={cn(
        "text-sm",
        highlight && "text-lg",
        isNegative && "text-red-600"
      )}>
        {isNegative && value > 0 ? '-' : ''}{formatValue(Math.abs(value), type)}
      </span>
    </div>
  );
}

function ReturnBox({ label, value, type, highlight }) {
  return (
    <div className={cn(
      "p-3 rounded-lg",
      highlight ? "bg-white border-2 border-green-200" : "bg-white/50"
    )}>
      <div className="text-xs text-[#737373] mb-1">{label}</div>
      <div className={cn(
        "font-semibold",
        highlight ? "text-xl text-green-700" : "text-lg text-[#171717]"
      )}>
        {formatValue(value, type)}
      </div>
    </div>
  );
}

// Formatting helpers
function formatValue(value, type) {
  if (value === null || value === undefined) return '—';

  switch (type) {
    case 'currency':
      return formatCurrency(value);
    case 'percentage':
      return `${(value * 100).toFixed(2)}%`;
    case 'ratio':
      return `${value.toFixed(2)}x`;
    case 'multiple':
      return `${value.toFixed(2)}x`;
    default:
      return value.toLocaleString();
  }
}

function formatCurrency(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}
