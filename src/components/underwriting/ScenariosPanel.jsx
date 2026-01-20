import React, { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Plus,
  Star,
  Trash2,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3
} from 'lucide-react';

export default function ScenariosPanel({ dealId, scenarios, baseModel, onUpdate }) {
  const [showCreate, setShowCreate] = useState(false);

  // Fetch scenario comparison
  const { data: comparisonData } = useQuery({
    queryKey: ['scenarios-compare', dealId],
    queryFn: () => bff.underwriting.compareScenarios(dealId),
    enabled: !!dealId && scenarios.length > 0
  });

  const createMutation = useMutation({
    mutationFn: (payload) => bff.underwriting.createScenario(dealId, payload),
    onSuccess: () => {
      setShowCreate(false);
      onUpdate();
      toast({ title: 'Scenario created' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create scenario', description: error.message, variant: 'destructive' });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (scenarioId) => bff.underwriting.deleteScenario(dealId, scenarioId),
    onSuccess: () => {
      onUpdate();
      toast({ title: 'Scenario deleted' });
    },
    onError: (error) => {
      toast({ title: 'Failed to delete scenario', description: error.message, variant: 'destructive' });
    }
  });

  const comparison = comparisonData?.comparison || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-[#171717]">
            Sensitivity Analysis
          </h3>
          <p className="text-xs text-[#737373]">
            Compare scenarios with different assumptions
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          New Scenario
        </Button>
      </div>

      {/* Scenario cards grid */}
      {scenarios.length > 0 ? (
        <div className="grid grid-cols-3 gap-4">
          {scenarios.map(scenario => (
            <ScenarioCard
              key={scenario.id}
              scenario={scenario}
              baseModel={baseModel}
              onDelete={() => deleteMutation.mutate(scenario.id)}
              isDeleting={deleteMutation.isPending}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <BarChart3 className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[#171717] mb-2">No Scenarios Yet</h3>
            <p className="text-sm text-[#737373] mb-4">
              Create scenarios to test different assumptions and see how they affect returns.
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create First Scenario
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Comparison table */}
      {comparison.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Scenario Comparison</CardTitle>
          </CardHeader>
          <CardContent>
            <ComparisonTable scenarios={comparison} />
          </CardContent>
        </Card>
      )}

      {/* Create scenario modal */}
      {showCreate && (
        <CreateScenarioModal
          onClose={() => setShowCreate(false)}
          onCreate={(data) => createMutation.mutate(data)}
          isCreating={createMutation.isPending}
          baseModel={baseModel}
        />
      )}
    </div>
  );
}

function ScenarioCard({ scenario, baseModel, onDelete, isDeleting }) {
  const results = scenario.results
    ? (typeof scenario.results === 'string' ? JSON.parse(scenario.results) : scenario.results)
    : null;

  const assumptions = scenario.assumptions
    ? (typeof scenario.assumptions === 'string' ? JSON.parse(scenario.assumptions) : scenario.assumptions)
    : {};

  const baseIRR = baseModel?.irr;
  const scenarioIRR = results?.irr;
  const irrDiff = baseIRR && scenarioIRR ? scenarioIRR - baseIRR : null;

  return (
    <Card className={cn(
      "relative",
      scenario.isBaseCase && "border-blue-300 bg-blue-50/30"
    )}>
      {scenario.isBaseCase && (
        <div className="absolute -top-2 -right-2">
          <Badge className="bg-blue-600">
            <Star className="w-3 h-3 mr-1" />
            Base Case
          </Badge>
        </div>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <CardTitle className="text-base">{scenario.name}</CardTitle>
          {!scenario.isBaseCase && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onDelete}
              disabled={isDeleting}
              className="h-8 w-8 p-0 text-[#737373] hover:text-red-600"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
        {scenario.description && (
          <p className="text-xs text-[#737373]">{scenario.description}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key returns */}
        <div className="grid grid-cols-2 gap-3">
          <MetricBox
            label="IRR"
            value={results?.irr}
            type="percentage"
            diff={irrDiff}
          />
          <MetricBox
            label="Equity Multiple"
            value={results?.equityMultiple}
            type="multiple"
          />
          <MetricBox
            label="Cash-on-Cash"
            value={results?.cashOnCash}
            type="percentage"
          />
          <MetricBox
            label="DSCR"
            value={results?.dscr}
            type="ratio"
          />
        </div>

        {/* Assumption changes */}
        {Object.keys(assumptions).length > 0 && (
          <div className="pt-2 border-t border-[#E5E5E5]">
            <div className="text-xs text-[#737373] mb-2">Assumptions changed:</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(assumptions).map(([key, value]) => (
                <Badge key={key} variant="secondary" className="text-xs">
                  {humanizeField(key)}: {formatAssumption(key, value)}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricBox({ label, value, type, diff }) {
  const TrendIcon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const trendColor = diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-[#737373]';

  return (
    <div className="p-2 bg-[#FAFAFA] rounded-lg">
      <div className="text-xs text-[#737373]">{label}</div>
      <div className="flex items-center gap-1">
        <span className="text-sm font-semibold">
          {formatMetric(value, type)}
        </span>
        {diff !== null && (
          <TrendIcon className={cn("w-3 h-3", trendColor)} />
        )}
      </div>
    </div>
  );
}

function ComparisonTable({ scenarios }) {
  const metrics = ['irr', 'equityMultiple', 'cashOnCash', 'dscr'];
  const metricLabels = {
    irr: 'IRR',
    equityMultiple: 'Equity Multiple',
    cashOnCash: 'Cash-on-Cash',
    dscr: 'DSCR'
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E5E5E5]">
            <th className="text-left py-2 pr-4 font-medium text-[#737373]">Metric</th>
            {scenarios.map(s => (
              <th key={s.name} className="text-right py-2 px-4 font-medium text-[#171717]">
                {s.name}
                {s.isBaseCase && <Star className="w-3 h-3 inline ml-1 text-blue-500" />}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {metrics.map(metric => (
            <tr key={metric} className="border-b border-[#F5F5F5]">
              <td className="py-2 pr-4 text-[#737373]">{metricLabels[metric]}</td>
              {scenarios.map(s => {
                const results = s.results
                  ? (typeof s.results === 'string' ? JSON.parse(s.results) : s.results)
                  : {};
                const value = results[metric];
                const type = metric === 'equityMultiple' ? 'multiple' :
                  metric === 'dscr' ? 'ratio' : 'percentage';
                return (
                  <td key={s.name} className="text-right py-2 px-4 font-medium">
                    {formatMetric(value, type)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CreateScenarioModal({ onClose, onCreate, isCreating, baseModel }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [assumptions, setAssumptions] = useState({
    exitCapRate: baseModel?.exitCapRate || 0.055,
    rentGrowth: baseModel?.rentGrowth || 0.03,
    expenseGrowth: baseModel?.expenseGrowth || 0.02,
    holdPeriod: baseModel?.holdPeriod || 5
  });

  const handleSubmit = () => {
    onCreate({
      name,
      description,
      assumptions
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
        <h2 className="text-lg font-semibold mb-4">Create Scenario</h2>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium text-[#171717]">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Downside Case, Value-Add Achieved"
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#171717]">Description</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of this scenario..."
              className="mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-[#171717] mb-2 block">
              Assumptions
            </label>
            <div className="space-y-3 bg-[#FAFAFA] p-3 rounded-lg">
              <AssumptionInput
                label="Exit Cap Rate"
                value={assumptions.exitCapRate}
                onChange={(v) => setAssumptions(a => ({ ...a, exitCapRate: v }))}
                type="percentage"
              />
              <AssumptionInput
                label="Rent Growth"
                value={assumptions.rentGrowth}
                onChange={(v) => setAssumptions(a => ({ ...a, rentGrowth: v }))}
                type="percentage"
              />
              <AssumptionInput
                label="Expense Growth"
                value={assumptions.expenseGrowth}
                onChange={(v) => setAssumptions(a => ({ ...a, expenseGrowth: v }))}
                type="percentage"
              />
              <AssumptionInput
                label="Hold Period"
                value={assumptions.holdPeriod}
                onChange={(v) => setAssumptions(a => ({ ...a, holdPeriod: v }))}
                type="years"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!name || isCreating}>
            {isCreating ? 'Creating...' : 'Create Scenario'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssumptionInput({ label, value, onChange, type }) {
  const displayValue = type === 'percentage' ? (value * 100).toFixed(1) : value;

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-[#737373]">{label}</span>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          value={displayValue}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(type === 'percentage' ? v / 100 : v);
          }}
          className="w-20 h-8 text-right text-sm"
          step={type === 'percentage' ? 0.1 : 1}
        />
        <span className="text-sm text-[#737373] w-8">
          {type === 'percentage' ? '%' : type === 'years' ? 'yrs' : ''}
        </span>
      </div>
    </div>
  );
}

// Helpers
function formatMetric(value, type) {
  if (value === null || value === undefined) return '—';

  switch (type) {
    case 'percentage':
      return `${(value * 100).toFixed(1)}%`;
    case 'multiple':
      return `${value.toFixed(2)}x`;
    case 'ratio':
      return `${value.toFixed(2)}x`;
    default:
      return value.toLocaleString();
  }
}

function formatAssumption(key, value) {
  if (key.includes('Rate') || key.includes('Growth')) {
    return `${(value * 100).toFixed(1)}%`;
  }
  if (key === 'holdPeriod') {
    return `${value} yrs`;
  }
  return value;
}

function humanizeField(key) {
  const labels = {
    exitCapRate: 'Exit Cap',
    rentGrowth: 'Rent Growth',
    expenseGrowth: 'Exp Growth',
    holdPeriod: 'Hold'
  };
  return labels[key] || key;
}
