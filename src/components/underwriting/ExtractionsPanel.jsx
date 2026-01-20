import React from 'react';
import { useMutation } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  FileSpreadsheet,
  FileText,
  Building2,
  DollarSign,
  CheckCircle2,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Home,
  Percent,
  Users
} from 'lucide-react';

const DOC_TYPE_CONFIG = {
  RENT_ROLL: {
    label: 'Rent Roll',
    icon: Users,
    color: 'blue',
    summaryFields: ['totalUnits', 'occupiedUnits', 'avgRentPerUnit', 'occupancyRate']
  },
  T12: {
    label: 'T12 / Operating Statement',
    icon: DollarSign,
    color: 'green',
    summaryFields: ['grossPotentialRent', 'effectiveGrossIncome', 'totalExpenses', 'noi']
  },
  LOAN_TERMS: {
    label: 'Loan Terms',
    icon: Building2,
    color: 'violet',
    summaryFields: ['loanAmount', 'interestRate', 'term', 'amortization']
  },
  APPRAISAL: {
    label: 'Appraisal',
    icon: Home,
    color: 'amber',
    summaryFields: ['appraiserName', 'appraisedValue', 'capRate']
  }
};

export default function ExtractionsPanel({ dealId, extractions, onApply }) {
  const [expandedId, setExpandedId] = React.useState(null);

  const applyMutation = useMutation({
    mutationFn: (extractionId) => bff.underwriting.applyExtraction(dealId, extractionId),
    onSuccess: (data) => {
      onApply();
      toast({
        title: 'Extraction applied',
        description: `${data.applied?.length || 0} fields applied to model.`
      });
    },
    onError: (error) => {
      toast({ title: 'Apply failed', description: error.message, variant: 'destructive' });
    }
  });

  if (extractions.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileSpreadsheet className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">No Extractions Yet</h3>
          <p className="text-sm text-[#737373] mb-4">
            Upload documents to extract structured data automatically.
          </p>
          <Button variant="outline">
            <FileSpreadsheet className="w-4 h-4 mr-2" />
            Upload Document
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#737373]">
          {extractions.length} document{extractions.length !== 1 ? 's' : ''} extracted
        </p>
      </div>

      <div className="grid gap-4">
        {extractions.map((extraction) => (
          <ExtractionCard
            key={extraction.id}
            extraction={extraction}
            isExpanded={expandedId === extraction.id}
            onToggle={() => setExpandedId(expandedId === extraction.id ? null : extraction.id)}
            onApply={() => applyMutation.mutate(extraction.id)}
            isApplying={applyMutation.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function ExtractionCard({ extraction, isExpanded, onToggle, onApply, isApplying }) {
  const config = DOC_TYPE_CONFIG[extraction.documentType] || {
    label: extraction.documentType,
    icon: FileText,
    color: 'slate'
  };
  const Icon = config.icon;

  const colorMap = {
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    violet: 'bg-violet-50 border-violet-200 text-violet-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-700',
    slate: 'bg-slate-50 border-slate-200 text-slate-700'
  };

  const data = typeof extraction.extractedData === 'string'
    ? JSON.parse(extraction.extractedData)
    : extraction.extractedData;

  const isApplied = extraction.status === 'APPLIED';

  return (
    <Card className={cn("transition-all", isApplied && "border-green-200")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", colorMap[config.color])}>
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base">{config.label}</CardTitle>
              <p className="text-xs text-[#737373] mt-0.5">
                Extracted {new Date(extraction.extractedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isApplied ? (
              <Badge className="bg-green-100 text-green-700 border-green-200">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Applied
              </Badge>
            ) : (
              <Button
                size="sm"
                onClick={onApply}
                disabled={isApplying}
                className="gap-1"
              >
                Apply to Model
                <ArrowRight className="w-3 h-3" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggle}
              className="px-2"
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {/* Summary row */}
      <CardContent className="pt-0">
        <div className="flex items-center gap-4 py-2 border-t border-b border-[#F5F5F5]">
          {getSummaryItems(extraction.documentType, data).map((item, i) => (
            <div key={i} className="flex-1">
              <div className="text-xs text-[#737373]">{item.label}</div>
              <div className="text-sm font-medium">{item.value}</div>
            </div>
          ))}
          <div className="flex items-center gap-1">
            <Percent className="w-3 h-3 text-[#737373]" />
            <span className="text-sm text-[#737373]">
              {Math.round((extraction.confidence || 0.8) * 100)}% confidence
            </span>
          </div>
        </div>

        {/* Expanded details */}
        {isExpanded && (
          <div className="mt-4 space-y-4">
            <h4 className="text-sm font-medium text-[#171717]">Extracted Data</h4>
            <div className="bg-[#FAFAFA] rounded-lg p-4 overflow-auto max-h-64">
              <pre className="text-xs text-[#525252]">
                {JSON.stringify(data, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getSummaryItems(docType, data) {
  const formatCurrency = (v) => v ? `$${v.toLocaleString()}` : '—';
  const formatPercent = (v) => v ? `${(v * 100).toFixed(1)}%` : '—';
  const formatNumber = (v) => v ? v.toLocaleString() : '—';

  switch (docType) {
    case 'RENT_ROLL':
      return [
        { label: 'Units', value: formatNumber(data?.summary?.totalUnits) },
        { label: 'Occupied', value: formatNumber(data?.summary?.occupiedUnits) },
        { label: 'Avg Rent', value: formatCurrency(data?.summary?.avgRentPerUnit) },
        { label: 'Occupancy', value: formatPercent(data?.summary?.occupancyRate) }
      ];
    case 'T12':
      return [
        { label: 'GPR', value: formatCurrency(data?.revenue?.grossPotentialRent) },
        { label: 'EGI', value: formatCurrency(data?.revenue?.effectiveGrossIncome) },
        { label: 'Expenses', value: formatCurrency(data?.expenses?.totalExpenses) },
        { label: 'NOI', value: formatCurrency(data?.noi) }
      ];
    case 'LOAN_TERMS':
      return [
        { label: 'Loan', value: formatCurrency(data?.loanAmount) },
        { label: 'Rate', value: formatPercent(data?.interestRate) },
        { label: 'Term', value: data?.term ? `${data.term}yr` : '—' },
        { label: 'Amort', value: data?.amortization ? `${data.amortization}yr` : '—' }
      ];
    default:
      return [
        { label: 'Fields', value: Object.keys(data || {}).length }
      ];
  }
}
