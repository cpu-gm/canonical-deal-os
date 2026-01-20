import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PerClassBreakdown } from './PerClassBreakdown';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Users,
  TrendingUp,
  Calculator,
  Settings2,
  RefreshCw,
  Plus,
  Trash2,
  DollarSign,
  Percent,
  AlertCircle
} from 'lucide-react';

export default function WaterfallPanel({ dealId }) {
  const queryClient = useQueryClient();
  const [showSetup, setShowSetup] = useState(false);
  const [editingStructure, setEditingStructure] = useState(null);

  // Fetch waterfall structure
  const { data: waterfallData, isLoading } = useQuery({
    queryKey: ['waterfall', dealId],
    queryFn: () => bff.underwriting.getWaterfall(dealId),
    enabled: !!dealId
  });

  // Fetch distributions
  const { data: distributionsData } = useQuery({
    queryKey: ['waterfall-distributions', dealId],
    queryFn: () => bff.underwriting.listWaterfallDistributions(dealId),
    enabled: !!dealId && waterfallData?.hasStructure
  });

  // Create waterfall mutation
  const createMutation = useMutation({
    mutationFn: (structure) => bff.underwriting.createWaterfall(dealId, structure),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waterfall', dealId] });
      setShowSetup(false);
      toast({ title: 'Waterfall created', description: 'Structure saved successfully.' });
    },
    onError: (error) => {
      toast({ title: 'Failed to create waterfall', description: error.message, variant: 'destructive' });
    }
  });

  // Calculate waterfall mutation
  const calculateMutation = useMutation({
    mutationFn: (scenarioId) => bff.underwriting.calculateWaterfall(dealId, scenarioId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waterfall-distributions', dealId] });
      toast({ title: 'Waterfall calculated', description: 'Distributions computed successfully.' });
    },
    onError: (error) => {
      toast({ title: 'Calculation failed', description: error.message, variant: 'destructive' });
    }
  });

  // Update waterfall mutation
  const updateMutation = useMutation({
    mutationFn: (updates) => bff.underwriting.updateWaterfall(dealId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waterfall', dealId] });
      setEditingStructure(null);
      toast({ title: 'Structure updated' });
    }
  });

  // Log per-class data if available (must be before early returns per React hooks rules)
  const latestDist = waterfallData?.latestDistribution;
  useEffect(() => {
    if (latestDist?.byClass) {
      console.log('[WaterfallPanel] Distribution has byClass data', {
        dealId,
        classCount: Object.keys(latestDist.byClass).length,
        classCodes: Object.keys(latestDist.byClass)
      });
    }
  }, [latestDist, dealId]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="animate-pulse space-y-4">
            <div className="h-4 bg-slate-100 rounded w-1/4"></div>
            <div className="h-32 bg-slate-100 rounded"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { structure, hasStructure, defaults, latestDistribution } = waterfallData || {};
  const distributions = distributionsData?.distributions || [];

  // If no structure, show setup wizard
  if (!hasStructure) {
    return (
      <Card>
        <CardContent className="py-12">
          <div className="text-center">
            <Users className="w-12 h-12 mx-auto text-slate-300 mb-4" />
            <h3 className="text-lg font-semibold text-[#171717] mb-2">Set Up Equity Waterfall</h3>
            <p className="text-sm text-[#737373] mb-6 max-w-md mx-auto">
              Define your LP/GP capital structure and promote tiers to calculate
              how returns are distributed between investors.
            </p>
            <Dialog open={showSetup} onOpenChange={setShowSetup}>
              <DialogTrigger asChild>
                <Button className="gap-2 bg-[#171717] hover:bg-[#262626]">
                  <Plus className="w-4 h-4" />
                  Create Waterfall Structure
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Waterfall Structure</DialogTitle>
                </DialogHeader>
                <WaterfallSetupForm
                  defaults={defaults}
                  onSubmit={(data) => createMutation.mutate(data)}
                  isPending={createMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#171717]">Equity Waterfall</h3>
          <p className="text-sm text-[#737373]">
            LP/GP distribution structure with promote tiers
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Dialog open={editingStructure !== null} onOpenChange={(open) => !open && setEditingStructure(null)}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setEditingStructure(structure)}>
                <Settings2 className="w-4 h-4" />
                Edit Structure
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Waterfall Structure</DialogTitle>
              </DialogHeader>
              {editingStructure && (
                <WaterfallSetupForm
                  defaults={editingStructure}
                  onSubmit={(data) => updateMutation.mutate(data)}
                  isPending={updateMutation.isPending}
                  isEdit
                />
              )}
            </DialogContent>
          </Dialog>
          <Button
            size="sm"
            onClick={() => calculateMutation.mutate(null)}
            disabled={calculateMutation.isPending}
            className="gap-2 bg-[#171717] hover:bg-[#262626]"
          >
            {calculateMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Calculator className="w-4 h-4" />
            )}
            Calculate
          </Button>
        </div>
      </div>

      {/* Structure Summary */}
      <div className="grid grid-cols-2 gap-6">
        {/* Capital Structure */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="w-4 h-4" />
              Capital Structure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="text-xs text-[#737373] mb-1">LP Equity</div>
                  <div className="text-lg font-semibold">{formatCurrency(structure.lpEquity)}</div>
                  <div className="text-xs text-[#737373]">
                    {((structure.lpEquity / (structure.lpEquity + structure.gpEquity)) * 100).toFixed(1)}%
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs text-[#737373] mb-1">GP Equity</div>
                  <div className="text-lg font-semibold">{formatCurrency(structure.gpEquity)}</div>
                  <div className="text-xs text-[#737373]">
                    {((structure.gpEquity / (structure.lpEquity + structure.gpEquity)) * 100).toFixed(1)}%
                  </div>
                </div>
              </div>
              <div className="pt-3 border-t">
                <div className="text-xs text-[#737373] mb-1">Total Equity</div>
                <div className="text-xl font-bold text-[#171717]">
                  {formatCurrency(structure.lpEquity + structure.gpEquity)}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Waterfall Terms */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Percent className="w-4 h-4" />
              Waterfall Terms
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#737373]">Preferred Return</span>
                <span className="text-sm font-medium">{(structure.preferredReturn * 100).toFixed(1)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#737373]">GP Catch-up</span>
                <Badge variant={structure.gpCatchUp ? 'default' : 'secondary'}>
                  {structure.gpCatchUp ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#737373]">Lookback</span>
                <Badge variant={structure.lookback ? 'default' : 'secondary'}>
                  {structure.lookback ? 'Yes' : 'No'}
                </Badge>
              </div>
              {/* Per-Class Status */}
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm text-[#737373]">Per-Class Waterfall</span>
                <div className="flex items-center gap-2">
                  <Badge variant={structure.usePerClassWaterfall ? 'default' : 'secondary'}>
                    {structure.usePerClassWaterfall ? 'Enabled' : 'Disabled'}
                  </Badge>
                  {structure.usePerClassWaterfall && (
                    <span className="text-xs text-green-600">✓ Class terms active</span>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Promote Tiers */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp className="w-4 h-4" />
            Promote Tiers
          </CardTitle>
          <CardDescription>
            Distribution splits at different IRR hurdles
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-4">
            {(structure.promoteTiers || []).map((tier, index) => (
              <PromoteTierCard key={index} tier={tier} index={index} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Distribution Results */}
      {latestDistribution && (
        <Card className="border-green-200 bg-green-50/30">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base text-green-800">
              <TrendingUp className="w-4 h-4" />
              Distribution Summary (Base Case)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4 mb-6">
              <ReturnBox label="LP IRR" value={latestDistribution.lpIRR} type="percentage" highlight />
              <ReturnBox label="GP IRR" value={latestDistribution.gpIRR} type="percentage" />
              <ReturnBox label="LP Multiple" value={latestDistribution.lpEquityMultiple} type="multiple" />
              <ReturnBox label="GP Multiple" value={latestDistribution.gpEquityMultiple} type="multiple" />
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-green-200">
              <ReturnBox label="LP Total Return" value={latestDistribution.lpTotalReturn} type="currency" />
              <ReturnBox label="GP Total Return" value={latestDistribution.gpTotalReturn} type="currency" />
              <ReturnBox label="Total Promote" value={latestDistribution.totalPromote} type="currency" />
            </div>

            {/* Distribution Table */}
            {latestDistribution.yearlyDistributions && latestDistribution.yearlyDistributions.length > 0 && (
              <div className="mt-6 pt-4 border-t border-green-200">
                <h4 className="text-sm font-medium text-green-800 mb-3">Year-by-Year Distributions</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-green-200">
                        <th className="text-left p-2 font-medium text-green-700">Year</th>
                        <th className="text-right p-2 font-medium text-green-700">Cash Flow</th>
                        <th className="text-right p-2 font-medium text-green-700">LP Share</th>
                        <th className="text-right p-2 font-medium text-green-700">GP Share</th>
                        <th className="text-right p-2 font-medium text-green-700">Cumulative LP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestDistribution.yearlyDistributions.map((d, i) => (
                        <tr key={i} className="border-b border-green-100">
                          <td className="p-2">Year {d.year}</td>
                          <td className="p-2 text-right">{formatCurrency(d.cashFlow)}</td>
                          <td className="p-2 text-right text-green-700">{formatCurrency(d.lpShare)}</td>
                          <td className="p-2 text-right text-violet-700">{formatCurrency(d.gpShare)}</td>
                          <td className="p-2 text-right font-medium">{formatCurrency(d.cumulativeLp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Per-Class Breakdown - only show if multiple classes */}
            {latestDistribution.byClass && Object.keys(latestDistribution.byClass).length > 1 && (
              <div className="mt-6 pt-4 border-t border-green-200">
                <PerClassBreakdown
                  byClass={latestDistribution.byClass}
                  totalAmount={latestDistribution.lpTotalReturn}
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* No distributions yet */}
      {!latestDistribution && (
        <Card>
          <CardContent className="py-8 text-center">
            <Calculator className="w-12 h-12 mx-auto text-slate-300 mb-3" />
            <p className="text-sm text-[#737373]">
              Click "Calculate" to compute waterfall distributions based on your cash flow projections.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Waterfall Setup Form Component
function WaterfallSetupForm({ defaults, onSubmit, isPending, isEdit = false }) {
  const [formData, setFormData] = useState({
    lpEquity: defaults?.lpEquity || 0,
    gpEquity: defaults?.gpEquity || 0,
    preferredReturn: (defaults?.preferredReturn || 0.08) * 100,
    gpCatchUp: defaults?.gpCatchUp !== false,
    catchUpPercent: (defaults?.catchUpPercent || 1.0) * 100,
    lookback: defaults?.lookback || false,
    usePerClassWaterfall: defaults?.usePerClassWaterfall || false,
    promoteTiers: defaults?.promoteTiers || [
      { hurdle: 12, lpSplit: 80, gpSplit: 20 },
      { hurdle: 15, lpSplit: 70, gpSplit: 30 },
      { hurdle: 20, lpSplit: 60, gpSplit: 40 },
      { hurdle: null, lpSplit: 50, gpSplit: 50 }
    ]
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    console.log('[WaterfallPanel] Submitting waterfall', {
      usePerClassWaterfall: formData.usePerClassWaterfall
    });
    onSubmit({
      lpEquity: parseFloat(formData.lpEquity),
      gpEquity: parseFloat(formData.gpEquity),
      preferredReturn: formData.preferredReturn / 100,
      gpCatchUp: formData.gpCatchUp,
      catchUpPercent: formData.catchUpPercent / 100,
      lookback: formData.lookback,
      usePerClassWaterfall: formData.usePerClassWaterfall,
      promoteTiers: formData.promoteTiers.map(t => ({
        hurdle: t.hurdle === null ? Infinity : t.hurdle / 100,
        lpSplit: t.lpSplit / 100,
        gpSplit: t.gpSplit / 100
      }))
    });
  };

  const updateTier = (index, field, value) => {
    const newTiers = [...formData.promoteTiers];
    newTiers[index] = { ...newTiers[index], [field]: value };
    setFormData({ ...formData, promoteTiers: newTiers });
  };

  const addTier = () => {
    const lastTier = formData.promoteTiers[formData.promoteTiers.length - 1];
    setFormData({
      ...formData,
      promoteTiers: [
        ...formData.promoteTiers.slice(0, -1),
        { hurdle: 25, lpSplit: 55, gpSplit: 45 },
        { ...lastTier, hurdle: null }
      ]
    });
  };

  const removeTier = (index) => {
    if (formData.promoteTiers.length <= 2) return;
    setFormData({
      ...formData,
      promoteTiers: formData.promoteTiers.filter((_, i) => i !== index)
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Capital Structure */}
      <div className="space-y-4">
        <h4 className="font-medium text-sm">Capital Structure</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="lpEquity">LP Equity ($)</Label>
            <Input
              id="lpEquity"
              type="number"
              value={formData.lpEquity}
              onChange={(e) => setFormData({ ...formData, lpEquity: e.target.value })}
              placeholder="8,500,000"
            />
          </div>
          <div>
            <Label htmlFor="gpEquity">GP Co-Invest ($)</Label>
            <Input
              id="gpEquity"
              type="number"
              value={formData.gpEquity}
              onChange={(e) => setFormData({ ...formData, gpEquity: e.target.value })}
              placeholder="1,500,000"
            />
          </div>
        </div>
      </div>

      {/* Waterfall Terms */}
      <div className="space-y-4">
        <h4 className="font-medium text-sm">Waterfall Terms</h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="preferredReturn">Preferred Return (%)</Label>
            <Input
              id="preferredReturn"
              type="number"
              step="0.1"
              value={formData.preferredReturn}
              onChange={(e) => setFormData({ ...formData, preferredReturn: e.target.value })}
              placeholder="8.0"
            />
          </div>
          <div className="space-y-2">
            <Label>GP Catch-up</Label>
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={formData.gpCatchUp}
                onCheckedChange={(checked) => setFormData({ ...formData, gpCatchUp: checked })}
              />
              <span className="text-sm text-[#737373]">{formData.gpCatchUp ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Switch
              checked={formData.lookback}
              onCheckedChange={(checked) => setFormData({ ...formData, lookback: checked })}
            />
            <Label>Lookback Provision</Label>
          </div>
        </div>

        {/* Per-Class Waterfall */}
        <div className="pt-4 border-t mt-4">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Per-Class Waterfall</Label>
              <p className="text-xs text-[#737373] mt-1">
                Use class-specific preferred returns and payment priority
              </p>
            </div>
            <Switch
              checked={formData.usePerClassWaterfall}
              onCheckedChange={(checked) => {
                console.log('[WaterfallPanel] Per-class toggle changed', { checked });
                setFormData({ ...formData, usePerClassWaterfall: checked });
              }}
            />
          </div>

          {formData.usePerClassWaterfall && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-800">
                  When enabled, each share class uses its own preferred return rate.
                  Senior classes (lower priority number) are paid before junior classes.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Promote Tiers */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">Promote Tiers</h4>
          <Button type="button" variant="ghost" size="sm" onClick={addTier} className="h-7 text-xs">
            <Plus className="w-3 h-3 mr-1" />
            Add Tier
          </Button>
        </div>
        <div className="space-y-2">
          {formData.promoteTiers.map((tier, index) => (
            <div key={index} className="flex items-center gap-2 p-2 bg-slate-50 rounded">
              <div className="flex-1">
                <Label className="text-xs text-[#737373]">IRR Hurdle</Label>
                {tier.hurdle === null ? (
                  <Input
                    value="Above"
                    disabled
                    className="h-8 text-sm"
                  />
                ) : (
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      value={tier.hurdle}
                      onChange={(e) => updateTier(index, 'hurdle', parseFloat(e.target.value))}
                      className="h-8 text-sm pr-6"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#737373]">%</span>
                  </div>
                )}
              </div>
              <div className="flex-1">
                <Label className="text-xs text-[#737373]">LP Split</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={tier.lpSplit}
                    onChange={(e) => updateTier(index, 'lpSplit', parseFloat(e.target.value))}
                    className="h-8 text-sm pr-6"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#737373]">%</span>
                </div>
              </div>
              <div className="flex-1">
                <Label className="text-xs text-[#737373]">GP Split</Label>
                <div className="relative">
                  <Input
                    type="number"
                    value={tier.gpSplit}
                    onChange={(e) => updateTier(index, 'gpSplit', parseFloat(e.target.value))}
                    className="h-8 text-sm pr-6"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[#737373]">%</span>
                </div>
              </div>
              {index > 0 && index < formData.promoteTiers.length - 1 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeTier(index)}
                  className="h-8 w-8 p-0 text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? 'Saving...' : isEdit ? 'Update Structure' : 'Create Structure'}
      </Button>
    </form>
  );
}

// Helper Components
function PromoteTierCard({ tier, index }) {
  const hurdleDisplay = tier.hurdle === Infinity || tier.hurdle > 1 ?
    'Above' : `${(tier.hurdle * 100).toFixed(0)}%`;

  return (
    <div className={cn(
      "p-3 rounded-lg border text-center",
      index === 0 ? "bg-green-50 border-green-200" :
      index === 1 ? "bg-blue-50 border-blue-200" :
      index === 2 ? "bg-violet-50 border-violet-200" :
      "bg-slate-50 border-slate-200"
    )}>
      <div className="text-xs text-[#737373] mb-1">Tier {index + 1}</div>
      <div className="font-medium text-sm mb-2">
        {index === 0 ? `Up to ${hurdleDisplay}` :
         tier.hurdle === Infinity ? 'Above' :
         `${((tier.hurdle || 0) * 100).toFixed(0)}%+`}
      </div>
      <div className="text-xs">
        <span className="text-green-600">{((tier.lpSplit || 0) * 100).toFixed(0)}% LP</span>
        {' / '}
        <span className="text-violet-600">{((tier.gpSplit || 0) * 100).toFixed(0)}% GP</span>
      </div>
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
