import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  DollarSign,
  Calendar,
  TrendingUp,
  Building2
} from 'lucide-react';
import ProvenancePopover from './ProvenancePopover';

const FIELD_GROUPS = {
  revenue: {
    label: 'Revenue',
    icon: DollarSign,
    color: 'emerald',
    fields: [
      { key: 'grossPotentialRent', label: 'Gross Potential Rent', type: 'currency' },
      { key: 'vacancyRate', label: 'Vacancy Rate', type: 'percentage' },
      { key: 'effectiveGrossIncome', label: 'Effective Gross Income', type: 'currency', computed: true },
      { key: 'otherIncome', label: 'Other Income', type: 'currency' }
    ]
  },
  expenses: {
    label: 'Expenses',
    icon: Building2,
    color: 'red',
    fields: [
      { key: 'operatingExpenses', label: 'Operating Expenses', type: 'currency' },
      { key: 'taxes', label: 'Real Estate Taxes', type: 'currency' },
      { key: 'insurance', label: 'Insurance', type: 'currency' },
      { key: 'management', label: 'Management Fee', type: 'currency' },
      { key: 'reserves', label: 'Reserves', type: 'currency' }
    ]
  },
  noi: {
    label: 'Net Operating Income',
    icon: TrendingUp,
    color: 'blue',
    fields: [
      { key: 'netOperatingIncome', label: 'NOI', type: 'currency', computed: true }
    ]
  },
  debt: {
    label: 'Debt Structure',
    icon: Building2,
    color: 'violet',
    fields: [
      { key: 'loanAmount', label: 'Loan Amount', type: 'currency' },
      { key: 'interestRate', label: 'Interest Rate', type: 'percentage' },
      { key: 'amortization', label: 'Amortization', type: 'years' },
      { key: 'loanTerm', label: 'Loan Term', type: 'years' },
      { key: 'annualDebtService', label: 'Annual Debt Service', type: 'currency', computed: true }
    ]
  },
  assumptions: {
    label: 'Assumptions',
    icon: Calendar,
    color: 'amber',
    fields: [
      { key: 'holdPeriod', label: 'Hold Period', type: 'years' },
      { key: 'exitCapRate', label: 'Exit Cap Rate', type: 'percentage' },
      { key: 'rentGrowth', label: 'Rent Growth', type: 'percentage' },
      { key: 'expenseGrowth', label: 'Expense Growth', type: 'percentage' }
    ]
  },
  returns: {
    label: 'Returns',
    icon: TrendingUp,
    color: 'green',
    fields: [
      { key: 'goingInCapRate', label: 'Going-In Cap Rate', type: 'percentage', computed: true },
      { key: 'cashOnCash', label: 'Cash-on-Cash', type: 'percentage', computed: true },
      { key: 'dscr', label: 'DSCR', type: 'ratio', computed: true },
      { key: 'irr', label: 'IRR', type: 'percentage', computed: true },
      { key: 'equityMultiple', label: 'Equity Multiple', type: 'multiple', computed: true }
    ]
  }
};

export default function ModelInputsPanel({ dealId, model, onUpdate }) {
  const [editingField, setEditingField] = useState(null);
  const [editValue, setEditValue] = useState('');

  const updateMutation = useMutation({
    mutationFn: ({ field, value, rationale }) =>
      bff.underwriting.updateModel(dealId, { [field]: value, rationale }),
    onSuccess: () => {
      setEditingField(null);
      setEditValue('');
      onUpdate();
      toast({ title: 'Input updated', description: 'Value saved with provenance.' });
    },
    onError: (error) => {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    }
  });

  const startEditing = (fieldKey, currentValue) => {
    setEditingField(fieldKey);
    setEditValue(formatForEdit(currentValue, getFieldType(fieldKey)));
  };

  const saveEdit = (fieldKey) => {
    const fieldType = getFieldType(fieldKey);
    const parsedValue = parseFromEdit(editValue, fieldType);
    updateMutation.mutate({ field: fieldKey, value: parsedValue });
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue('');
  };

  const getFieldType = (fieldKey) => {
    for (const group of Object.values(FIELD_GROUPS)) {
      const field = group.fields.find(f => f.key === fieldKey);
      if (field) return field.type;
    }
    return 'number';
  };

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Left column: Inputs */}
      <div className="space-y-6">
        {['revenue', 'expenses', 'debt', 'assumptions'].map(groupKey => {
          const group = FIELD_GROUPS[groupKey];
          const Icon = group.icon;
          return (
            <Card key={groupKey}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="w-4 h-4" />
                  {group.label}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {group.fields.map(field => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={model?.[field.key]}
                    dealId={dealId}
                    isEditing={editingField === field.key}
                    editValue={editValue}
                    onEditValueChange={setEditValue}
                    onStartEdit={() => startEditing(field.key, model?.[field.key])}
                    onSave={() => saveEdit(field.key)}
                    onCancel={cancelEdit}
                    isSaving={updateMutation.isPending && editingField === field.key}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Right column: Calculated Returns */}
      <div className="space-y-6">
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-green-800">
              <TrendingUp className="w-4 h-4" />
              Calculated Returns
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              {FIELD_GROUPS.returns.fields.map(field => (
                <ReturnMetric
                  key={field.key}
                  label={field.label}
                  value={model?.[field.key]}
                  type={field.type}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="w-4 h-4" />
              Net Operating Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#171717]">
              {formatValue(model?.netOperatingIncome, 'currency')}
            </div>
            <div className="text-sm text-[#737373] mt-1">
              {model?.grossPotentialRent && model?.netOperatingIncome
                ? `${((model.netOperatingIncome / model.grossPotentialRent) * 100).toFixed(1)}% margin`
                : 'Margin not calculated'}
            </div>
          </CardContent>
        </Card>

        {/* Model status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Model Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#737373]">Status</span>
              <Badge variant={model?.status === 'READY' ? 'default' : 'secondary'}>
                {model?.status || 'DRAFT'}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#737373]">Last Calculated</span>
              <span className="text-sm">
                {model?.lastCalculatedAt
                  ? new Date(model.lastCalculatedAt).toLocaleString()
                  : 'Never'}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  dealId,
  isEditing,
  editValue,
  onEditValueChange,
  onStartEdit,
  onSave,
  onCancel,
  isSaving
}) {
  if (field.computed) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-[#737373]">{field.label}</span>
        <span className="text-sm font-medium text-[#171717]">
          {formatValue(value, field.type)}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-1 group">
      <div className="flex items-center gap-2">
        <span className="text-sm text-[#737373]">{field.label}</span>
        <ProvenancePopover dealId={dealId} fieldPath={field.key} />
      </div>
      {isEditing ? (
        <div className="flex items-center gap-2">
          <Input
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            className="w-32 h-8 text-right text-sm"
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave();
              if (e.key === 'Escape') onCancel();
            }}
            autoFocus
          />
          <Button size="sm" variant="ghost" onClick={onCancel} className="h-8 px-2">
            Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving} className="h-8 px-2">
            Save
          </Button>
        </div>
      ) : (
        <button
          onClick={onStartEdit}
          className="text-sm font-medium text-[#171717] hover:bg-slate-100 px-2 py-1 rounded transition-colors"
        >
          {formatValue(value, field.type)}
        </button>
      )}
    </div>
  );
}

function ReturnMetric({ label, value, type }) {
  const isPositive = typeof value === 'number' && value > 0;

  return (
    <div className="p-3 bg-white rounded-lg border border-green-100">
      <div className="text-xs text-[#737373] mb-1">{label}</div>
      <div className={cn(
        "text-lg font-semibold",
        type === 'percentage' && isPositive ? 'text-green-600' : 'text-[#171717]'
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
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    case 'percentage':
      return `${(value * 100).toFixed(2)}%`;
    case 'ratio':
      return `${value.toFixed(2)}x`;
    case 'multiple':
      return `${value.toFixed(2)}x`;
    case 'years':
      return `${value} yrs`;
    default:
      return value.toLocaleString();
  }
}

function formatForEdit(value, type) {
  if (value === null || value === undefined) return '';

  switch (type) {
    case 'currency':
      return value.toString();
    case 'percentage':
      return (value * 100).toString();
    case 'ratio':
    case 'multiple':
      return value.toString();
    case 'years':
      return value.toString();
    default:
      return value.toString();
  }
}

function parseFromEdit(value, type) {
  const num = parseFloat(value.replace(/[^0-9.-]/g, ''));
  if (isNaN(num)) return null;

  switch (type) {
    case 'percentage':
      return num / 100;
    default:
      return num;
  }
}
