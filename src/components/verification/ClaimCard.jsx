import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  FileSpreadsheet,
  Bot,
  Edit2
} from 'lucide-react';

const CONFIDENCE_COLORS = {
  high: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
  medium: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
  low: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' }
};

const DOC_TYPE_ICONS = {
  RENT_ROLL: FileSpreadsheet,
  T12: FileSpreadsheet,
  OPERATING_STATEMENT: FileText,
  LOI: FileText,
  LOAN_TERM_SHEET: FileText,
  EXCEL_IMPORT: FileSpreadsheet,
  DEFAULT: FileText
};

const FIELD_LABELS = {
  purchasePrice: 'Purchase Price',
  noi: 'Net Operating Income',
  grossPotentialRent: 'Gross Potential Rent',
  effectiveGrossIncome: 'Effective Gross Income',
  operatingExpenses: 'Operating Expenses',
  goingInCapRate: 'Going-In Cap Rate',
  exitCapRate: 'Exit Cap Rate',
  holdPeriod: 'Hold Period',
  loanAmount: 'Loan Amount',
  interestRate: 'Interest Rate',
  loanTermYears: 'Loan Term',
  amortizationYears: 'Amortization Period',
  totalUnits: 'Total Units',
  grossSF: 'Gross Square Feet',
  vacancyRate: 'Vacancy Rate',
  managementFee: 'Management Fee',
  propertyTaxes: 'Property Taxes',
  insurance: 'Insurance',
  utilities: 'Utilities',
  repairs: 'Repairs & Maintenance'
};

export default function ClaimCard({ claim, dealId, isSelected, onSelect, onAction }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showCorrection, setShowCorrection] = useState(false);
  const [correctedValue, setCorrectedValue] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectForm, setShowRejectForm] = useState(false);

  const confidenceLevel =
    claim.extraction.confidence >= 0.9 ? 'high' :
    claim.extraction.confidence >= 0.7 ? 'medium' : 'low';

  const confidenceColors = CONFIDENCE_COLORS[confidenceLevel];
  const DocIcon = DOC_TYPE_ICONS[claim.source.documentType] || DOC_TYPE_ICONS.DEFAULT;

  // Verify mutation
  const verifyMutation = useMutation({
    mutationFn: (data) => bff.verificationQueue.verifyClaim(claim.id, data),
    onSuccess: () => {
      toast({
        title: 'Claim Verified',
        description: `${FIELD_LABELS[claim.fieldPath] || claim.fieldPath} has been verified.`
      });
      onAction();
    },
    onError: (error) => {
      toast({
        title: 'Verification Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: (reason) => bff.verificationQueue.rejectClaim(claim.id, { reason }),
    onSuccess: () => {
      toast({
        title: 'Claim Rejected',
        description: `${FIELD_LABELS[claim.fieldPath] || claim.fieldPath} has been rejected.`
      });
      onAction();
    },
    onError: (error) => {
      toast({
        title: 'Rejection Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const handleVerify = () => {
    if (showCorrection && correctedValue.trim()) {
      // Parse the corrected value
      let parsedValue = correctedValue;
      const numericValue = parseFloat(correctedValue.replace(/[$,%]/g, ''));
      if (!isNaN(numericValue)) {
        // Handle percentages
        if (correctedValue.includes('%') || isPercentageField(claim.fieldPath)) {
          parsedValue = numericValue / 100;
        } else {
          parsedValue = numericValue;
        }
      }
      verifyMutation.mutate({ correctedValue: parsedValue });
    } else {
      verifyMutation.mutate({});
    }
  };

  const handleReject = () => {
    if (!rejectReason.trim()) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason for rejection.',
        variant: 'destructive'
      });
      return;
    }
    rejectMutation.mutate(rejectReason);
  };

  const isPercentageField = (fieldPath) => {
    return ['vacancyRate', 'interestRate', 'goingInCapRate', 'exitCapRate', 'managementFee'].includes(fieldPath);
  };

  const formatValue = (value, fieldPath) => {
    if (value === null || value === undefined) return '—';

    if (isPercentageField(fieldPath)) {
      return `${(value * 100).toFixed(2)}%`;
    }

    const isCurrency = ['purchasePrice', 'noi', 'grossPotentialRent', 'effectiveGrossIncome',
      'operatingExpenses', 'loanAmount', 'propertyTaxes', 'insurance', 'utilities', 'repairs'].includes(fieldPath);

    if (isCurrency) {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    }

    if (typeof value === 'number') {
      return value.toLocaleString();
    }

    return String(value);
  };

  const isPending = verifyMutation.isPending || rejectMutation.isPending;

  return (
    <Card className={cn(
      "transition-all",
      isSelected && "ring-2 ring-blue-400 bg-blue-50/30"
    )}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          {/* Selection checkbox */}
          <Checkbox
            checked={isSelected}
            onCheckedChange={onSelect}
            className="mt-1"
          />

          <div className="flex-1 min-w-0">
            {/* Header row */}
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <DocIcon className="w-4 h-4 text-[#737373]" />
                <span className="font-medium text-[#171717]">
                  {FIELD_LABELS[claim.fieldPath] || claim.fieldPath}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-xs", confidenceColors.bg, confidenceColors.text, confidenceColors.border)}
                >
                  {Math.round(claim.extraction.confidence * 100)}% confidence
                </Badge>
              </div>

              {/* Quick actions */}
              <div className="flex items-center gap-2">
                {!showRejectForm && !showCorrection && (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setShowCorrection(true)}
                      disabled={isPending}
                      className="text-xs h-7"
                    >
                      <Edit2 className="w-3 h-3 mr-1" />
                      Correct
                    </Button>
                    <Button
                      size="sm"
                      onClick={handleVerify}
                      disabled={isPending}
                      className="bg-green-600 hover:bg-green-700 h-7 text-xs"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Verify
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowRejectForm(true)}
                      disabled={isPending}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50 h-7 text-xs"
                    >
                      <XCircle className="w-3 h-3 mr-1" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Value display */}
            <div className="flex items-center gap-4 mb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-violet-500" />
                <span className="text-lg font-bold text-[#171717]">
                  {formatValue(claim.claimedValue, claim.fieldPath)}
                </span>
              </div>
              <div className="text-xs text-[#737373]">
                Extracted by {claim.extraction.aiModel || 'AI'}
              </div>
            </div>

            {/* Source info */}
            <div className="flex items-center gap-3 text-xs text-[#737373]">
              <span className="flex items-center gap-1">
                <FileText className="w-3 h-3" />
                {claim.source.documentName}
              </span>
              {claim.source.pageNumber && (
                <span>Page {claim.source.pageNumber}</span>
              )}
              {claim.source.cellReference && (
                <span className="font-mono bg-[#F5F5F5] px-1 rounded">
                  {claim.source.cellReference}
                </span>
              )}
            </div>

            {/* Correction form */}
            {showCorrection && (
              <div className="mt-3 p-3 bg-[#FAFAFA] rounded-lg border border-[#E5E5E5]">
                <label className="text-sm font-medium text-[#171717] block mb-2">
                  Corrected Value
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    value={correctedValue}
                    onChange={(e) => setCorrectedValue(e.target.value)}
                    placeholder={formatValue(claim.claimedValue, claim.fieldPath)}
                    className="max-w-xs"
                  />
                  <Button
                    size="sm"
                    onClick={handleVerify}
                    disabled={isPending}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <CheckCircle2 className="w-4 h-4 mr-1" />
                    Verify with Correction
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowCorrection(false);
                      setCorrectedValue('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Reject form */}
            {showRejectForm && (
              <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
                <label className="text-sm font-medium text-red-700 block mb-2">
                  Rejection Reason
                </label>
                <Textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why is this extraction incorrect?"
                  className="mb-2 bg-white"
                  rows={2}
                />
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleReject}
                    disabled={isPending || !rejectReason.trim()}
                  >
                    <XCircle className="w-4 h-4 mr-1" />
                    Confirm Rejection
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowRejectForm(false);
                      setRejectReason('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Expandable details */}
            <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-[#737373] hover:text-[#171717] mt-2">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
                {isExpanded ? 'Hide details' : 'Show details'}
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="p-3 bg-[#FAFAFA] rounded-lg text-sm space-y-2">
                  {claim.source.textSnippet && (
                    <div>
                      <span className="font-medium text-[#171717]">Source text:</span>
                      <p className="text-[#737373] mt-1 font-mono text-xs bg-white p-2 rounded border">
                        "{claim.source.textSnippet}"
                      </p>
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-[#737373]">Document Type:</span>
                      <span className="ml-1 text-[#171717]">{claim.source.documentType}</span>
                    </div>
                    <div>
                      <span className="text-[#737373]">Extraction ID:</span>
                      <span className="ml-1 text-[#171717] font-mono">{claim.extraction.id?.slice(0, 8)}...</span>
                    </div>
                    <div>
                      <span className="text-[#737373]">Extracted at:</span>
                      <span className="ml-1 text-[#171717]">
                        {new Date(claim.extraction.extractedAt).toLocaleString()}
                      </span>
                    </div>
                    {claim.source.boundingBox && (
                      <div>
                        <span className="text-[#737373]">Bounding box:</span>
                        <span className="ml-1 text-[#171717] font-mono">
                          {JSON.stringify(claim.source.boundingBox)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
