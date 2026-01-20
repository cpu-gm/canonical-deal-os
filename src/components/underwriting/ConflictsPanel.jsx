import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  CheckCircle2,
  XCircle,
  MessageSquare,
  FileText,
  FileSpreadsheet,
  User,
  Info
} from 'lucide-react';

const SEVERITY_CONFIG = {
  ERROR: {
    label: 'Error',
    icon: XCircle,
    color: 'red',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-700'
  },
  WARNING: {
    label: 'Warning',
    icon: AlertTriangle,
    color: 'amber',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    textColor: 'text-amber-700'
  },
  INFO: {
    label: 'Info',
    icon: Info,
    color: 'blue',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    textColor: 'text-blue-700'
  }
};

const SOURCE_LABELS = {
  RENT_ROLL: 'Rent Roll',
  T12: 'T12',
  LOAN_TERMS: 'Loan Terms',
  EXCEL_IMPORT: 'Excel Import',
  MANUAL: 'Manual Entry',
  BENCHMARK: 'Industry Benchmark'
};

export default function ConflictsPanel({ dealId, conflicts, onResolve }) {
  const openConflicts = conflicts.filter(c => c.status === 'OPEN');
  const resolvedConflicts = conflicts.filter(c => c.status === 'RESOLVED');

  if (conflicts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">No Conflicts</h3>
          <p className="text-sm text-[#737373]">
            All data sources are in agreement. Your model is consistent.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {openConflicts.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium text-[#171717]">
              Open Conflicts ({openConflicts.length})
            </h3>
            <Badge variant="destructive">{openConflicts.length} need resolution</Badge>
          </div>
          {openConflicts.map(conflict => (
            <ConflictCard
              key={conflict.id}
              conflict={conflict}
              dealId={dealId}
              onResolve={onResolve}
            />
          ))}
        </div>
      )}

      {resolvedConflicts.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-[#737373]">
            Resolved ({resolvedConflicts.length})
          </h3>
          {resolvedConflicts.map(conflict => (
            <ResolvedConflictCard key={conflict.id} conflict={conflict} />
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictCard({ conflict, dealId, onResolve }) {
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState('');
  const [selectedResolution, setSelectedResolution] = useState(null);

  const severity = SEVERITY_CONFIG[conflict.severity] || SEVERITY_CONFIG.WARNING;
  const Icon = severity.icon;

  const resolveMutation = useMutation({
    mutationFn: ({ resolution, resolutionNote }) =>
      bff.underwriting.resolveConflict(dealId, conflict.id, { resolution, resolutionNote }),
    onSuccess: () => {
      onResolve();
      toast({ title: 'Conflict resolved', description: 'Model updated with selected value.' });
    },
    onError: (error) => {
      toast({ title: 'Resolution failed', description: error.message, variant: 'destructive' });
    }
  });

  const handleResolve = (source) => {
    if (showNote) {
      resolveMutation.mutate({ resolution: source, resolutionNote: note });
    } else {
      setSelectedResolution(source);
      setShowNote(true);
    }
  };

  const handleConfirmResolve = () => {
    resolveMutation.mutate({ resolution: selectedResolution, resolutionNote: note });
  };

  const valueA = typeof conflict.valueA === 'string' ? JSON.parse(conflict.valueA) : conflict.valueA;
  const valueB = typeof conflict.valueB === 'string' ? JSON.parse(conflict.valueB) : conflict.valueB;

  return (
    <Card className={cn("border-l-4", severity.borderColor)}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className={cn("p-1.5 rounded", severity.bgColor)}>
              <Icon className={cn("w-4 h-4", severity.textColor)} />
            </div>
            <div>
              <CardTitle className="text-base">
                {humanizeFieldPath(conflict.fieldPath)}
              </CardTitle>
              <p className="text-xs text-[#737373]">{conflict.conflictType}</p>
            </div>
          </div>
          <Badge className={cn(severity.bgColor, severity.textColor, "border", severity.borderColor)}>
            {severity.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Conflicting values */}
        <div className="grid grid-cols-2 gap-4">
          <ValueCard
            source={conflict.sourceA}
            value={valueA}
            fieldPath={conflict.fieldPath}
            isSelected={selectedResolution === conflict.sourceA}
            onSelect={() => handleResolve(conflict.sourceA)}
            disabled={resolveMutation.isPending}
          />
          <ValueCard
            source={conflict.sourceB}
            value={valueB}
            fieldPath={conflict.fieldPath}
            isSelected={selectedResolution === conflict.sourceB}
            onSelect={() => handleResolve(conflict.sourceB)}
            disabled={resolveMutation.isPending}
          />
        </div>

        {/* Difference indicator */}
        {conflict.percentDiff !== null && (
          <div className="flex items-center justify-center gap-2 text-sm text-[#737373]">
            <span>Difference:</span>
            <span className={cn(
              "font-medium",
              conflict.percentDiff > 0.1 ? "text-red-600" : "text-amber-600"
            )}>
              {(conflict.percentDiff * 100).toFixed(1)}%
            </span>
            {conflict.difference && (
              <span className="text-[#A3A3A3]">
                ({formatValue(Math.abs(conflict.difference), conflict.fieldPath)})
              </span>
            )}
          </div>
        )}

        {/* Resolution note input */}
        {showNote && (
          <div className="space-y-3 pt-2 border-t border-[#E5E5E5]">
            <label className="text-sm font-medium text-[#171717]">
              Add a note (optional)
            </label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why did you choose this value?"
              className="min-h-[80px]"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowNote(false);
                  setSelectedResolution(null);
                  setNote('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleConfirmResolve}
                disabled={resolveMutation.isPending}
              >
                Confirm Resolution
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ValueCard({ source, value, fieldPath, isSelected, onSelect, disabled }) {
  const SourceIcon = source.includes('EXCEL') ? FileSpreadsheet :
    source === 'MANUAL' ? User :
      source === 'BENCHMARK' ? Info : FileText;

  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "p-4 rounded-lg border text-left transition-all",
        isSelected
          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
          : "border-[#E5E5E5] hover:border-[#A3A3A3] hover:bg-[#FAFAFA]"
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <SourceIcon className="w-4 h-4 text-[#737373]" />
        <span className="text-sm font-medium text-[#171717]">
          {SOURCE_LABELS[source] || source}
        </span>
      </div>
      <div className="text-xl font-bold text-[#171717]">
        {formatValue(value, fieldPath)}
      </div>
      <div className="text-xs text-[#737373] mt-1">
        Click to use this value
      </div>
    </button>
  );
}

function ResolvedConflictCard({ conflict }) {
  const severity = SEVERITY_CONFIG[conflict.severity] || SEVERITY_CONFIG.WARNING;

  return (
    <Card className="opacity-60">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <div>
              <div className="text-sm font-medium text-[#171717]">
                {humanizeFieldPath(conflict.fieldPath)}
              </div>
              <div className="text-xs text-[#737373]">
                Resolved using {SOURCE_LABELS[conflict.resolution] || conflict.resolution}
                {conflict.resolvedByName && ` by ${conflict.resolvedByName}`}
              </div>
            </div>
          </div>
          {conflict.resolutionNote && (
            <div className="flex items-center gap-1 text-xs text-[#737373]">
              <MessageSquare className="w-3 h-3" />
              {conflict.resolutionNote.slice(0, 50)}
              {conflict.resolutionNote.length > 50 && '...'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// Helpers
function humanizeFieldPath(path) {
  const labels = {
    grossPotentialRent: 'Gross Potential Rent',
    vacancyRate: 'Vacancy Rate',
    effectiveGrossIncome: 'Effective Gross Income',
    netOperatingIncome: 'Net Operating Income',
    operatingExpenses: 'Operating Expenses',
    taxes: 'Real Estate Taxes',
    insurance: 'Insurance',
    management: 'Management Fee',
    reserves: 'Reserves',
    loanAmount: 'Loan Amount',
    interestRate: 'Interest Rate',
    expenseRatio: 'Expense Ratio',
    unitCount: 'Unit Count'
  };
  return labels[path] || path;
}

function formatValue(value, fieldPath) {
  if (value === null || value === undefined) return '—';

  const isPercentage = ['vacancyRate', 'interestRate', 'expenseRatio', 'exitCapRate', 'goingInCapRate'].includes(fieldPath);
  const isCurrency = ['grossPotentialRent', 'effectiveGrossIncome', 'netOperatingIncome', 'operatingExpenses', 'loanAmount', 'taxes', 'insurance', 'management', 'reserves'].includes(fieldPath);

  if (isPercentage) {
    return `${(value * 100).toFixed(2)}%`;
  }
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
}
