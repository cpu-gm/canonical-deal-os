import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Grid3X3,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Plus,
  Target,
  Calendar,
  Zap,
  Check,
  AlertTriangle
} from 'lucide-react';

export default function SensitivityMatrix({ dealId, model, onUpdate }) {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] = useState('matrix'); // matrix, hold-period, quick
  const [xField, setXField] = useState('exitCapRate');
  const [yField, setYField] = useState('vacancyRate');
  const [outputMetric, setOutputMetric] = useState('irr');
  const [showCreateScenario, setShowCreateScenario] = useState(false);
  const [selectedCell, setSelectedCell] = useState(null);
  const [customScenarioName, setCustomScenarioName] = useState('');

  // Fetch sensitivity options
  const { data: optionsData } = useQuery({
    queryKey: ['sensitivity-options', dealId],
    queryFn: () => bff.underwriting.getSensitivityOptions(dealId),
    enabled: !!dealId
  });

  // Fetch matrix data
  const { data: matrixData, isLoading: matrixLoading, refetch: refetchMatrix } = useQuery({
    queryKey: ['sensitivity-matrix', dealId, xField, yField, outputMetric],
    queryFn: () => bff.underwriting.calculateSensitivityMatrix(dealId, xField, yField, outputMetric),
    enabled: !!dealId && activeView === 'matrix'
  });

  // Fetch hold period sensitivity
  const { data: holdPeriodData, isLoading: holdPeriodLoading } = useQuery({
    queryKey: ['sensitivity-hold-period', dealId],
    queryFn: () => bff.underwriting.getHoldPeriodSensitivity(dealId),
    enabled: !!dealId && activeView === 'hold-period'
  });

  // Fetch quick sensitivity
  const { data: quickData, isLoading: quickLoading } = useQuery({
    queryKey: ['sensitivity-quick', dealId],
    queryFn: () => bff.underwriting.getQuickSensitivity(dealId),
    enabled: !!dealId && activeView === 'quick'
  });

  // Create scenario mutation
  const createScenarioMutation = useMutation({
    mutationFn: ({ xField, xValue, yField, yValue, customName }) =>
      bff.underwriting.createScenarioFromSensitivity(dealId, xField, xValue, yField, yValue, customName),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scenarios', dealId] });
      toast({ title: 'Scenario created', description: 'New scenario saved from sensitivity analysis.' });
      setShowCreateScenario(false);
      setSelectedCell(null);
      setCustomScenarioName('');
      onUpdate?.();
    },
    onError: (error) => {
      toast({ title: 'Failed to create scenario', description: error.message, variant: 'destructive' });
    }
  });

  const options = optionsData || { fields: [], metrics: [] };

  const handleCellClick = (cell) => {
    setSelectedCell(cell);
    setShowCreateScenario(true);
  };

  const handleCreateScenario = () => {
    if (!selectedCell) return;
    createScenarioMutation.mutate({
      xField,
      xValue: selectedCell.xValue,
      yField,
      yValue: selectedCell.yValue,
      customName: customScenarioName || null
    });
  };

  // Color mapping for cells
  const getColorClass = (color) => {
    switch (color) {
      case 'green':
        return 'bg-green-100 text-green-800 hover:bg-green-200';
      case 'yellow':
        return 'bg-amber-100 text-amber-800 hover:bg-amber-200';
      case 'red':
        return 'bg-red-100 text-red-800 hover:bg-red-200';
      default:
        return 'bg-slate-100 text-slate-800 hover:bg-slate-200';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-[#171717]">Sensitivity Analysis</h3>
          <p className="text-sm text-[#737373] mt-1">
            Analyze how returns change with different assumptions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={activeView === 'matrix' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveView('matrix')}
            className="gap-2"
          >
            <Grid3X3 className="w-4 h-4" />
            Matrix
          </Button>
          <Button
            variant={activeView === 'hold-period' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveView('hold-period')}
            className="gap-2"
          >
            <Calendar className="w-4 h-4" />
            Hold Period
          </Button>
          <Button
            variant={activeView === 'quick' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveView('quick')}
            className="gap-2"
          >
            <Zap className="w-4 h-4" />
            Quick
          </Button>
        </div>
      </div>

      {/* Matrix View */}
      {activeView === 'matrix' && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">2D Sensitivity Matrix</CardTitle>
                <CardDescription>Click any cell to create a scenario</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchMatrix()}
                disabled={matrixLoading}
              >
                <RefreshCw className={cn("w-4 h-4 mr-2", matrixLoading && "animate-spin")} />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Axis Selectors */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">X-Axis</Label>
                <Select value={xField} onValueChange={setXField}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.fields.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Y-Axis</Label>
                <Select value={yField} onValueChange={setYField}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.fields.map(f => (
                      <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Output Metric</Label>
                <Select value={outputMetric} onValueChange={setOutputMetric}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {options.metrics.map(m => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Matrix Table */}
            {matrixLoading ? (
              <div className="h-64 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : matrixData ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="p-2 text-left text-xs font-medium text-slate-500 border-b">
                        {matrixData.yAxis.label} / {matrixData.xAxis.label}
                      </th>
                      {matrixData.xAxis.values.map((val, i) => (
                        <th
                          key={i}
                          className={cn(
                            "p-2 text-center text-xs font-medium border-b min-w-[70px]",
                            matrixData.baseCase.xIndex === i ? "bg-blue-50 text-blue-700" : "text-slate-500"
                          )}
                        >
                          {val}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrixData.matrix.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        <td className={cn(
                          "p-2 text-xs font-medium border-b",
                          matrixData.baseCase.yIndex === rowIdx ? "bg-blue-50 text-blue-700" : "text-slate-500"
                        )}>
                          {matrixData.yAxis.values[rowIdx]}
                        </td>
                        {row.map((cell, colIdx) => (
                          <TooltipProvider key={colIdx}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <td
                                  onClick={() => handleCellClick(cell)}
                                  className={cn(
                                    "p-2 text-center border-b cursor-pointer transition-colors",
                                    getColorClass(cell.color),
                                    matrixData.baseCase.xIndex === colIdx && matrixData.baseCase.yIndex === rowIdx &&
                                      "ring-2 ring-blue-500 ring-inset"
                                  )}
                                >
                                  <span className="font-medium">{cell.formatted}</span>
                                </td>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">
                                  {matrixData.xAxis.label}: {matrixData.xAxis.values[colIdx]}
                                </p>
                                <p className="text-xs">
                                  {matrixData.yAxis.label}: {matrixData.yAxis.values[rowIdx]}
                                </p>
                                <p className="text-xs font-medium mt-1">
                                  {matrixData.metric.label}: {cell.formatted}
                                </p>
                                <p className="text-xs text-blue-500 mt-1">Click to save as scenario</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-4 text-xs">
                  <span className="text-slate-500">Legend:</span>
                  <span className="flex items-center gap-1">
                    <span className="w-4 h-4 rounded bg-green-100"></span>
                    {`≥ ${(matrixData.metric.thresholds?.green * 100).toFixed(0)}%`}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-4 h-4 rounded bg-amber-100"></span>
                    {`${(matrixData.metric.thresholds?.yellow * 100).toFixed(0)}-${(matrixData.metric.thresholds?.green * 100).toFixed(0)}%`}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-4 h-4 rounded bg-red-100"></span>
                    {`< ${(matrixData.metric.thresholds?.yellow * 100).toFixed(0)}%`}
                  </span>
                  <span className="flex items-center gap-1 ml-4">
                    <span className="w-4 h-4 rounded ring-2 ring-blue-500"></span>
                    Base Case
                  </span>
                </div>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-500">
                Configure axes and metric to generate matrix
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hold Period View */}
      {activeView === 'hold-period' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">IRR by Hold Period</CardTitle>
            <CardDescription>
              How returns change based on exit timing
            </CardDescription>
          </CardHeader>
          <CardContent>
            {holdPeriodLoading ? (
              <div className="h-64 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : holdPeriodData ? (
              <div className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-3 gap-4">
                  <div className="p-4 rounded-lg bg-green-50 border border-green-100">
                    <div className="flex items-center gap-2 text-green-700 mb-1">
                      <Target className="w-4 h-4" />
                      <span className="text-xs font-medium">Optimal Exit</span>
                    </div>
                    <div className="text-2xl font-bold text-green-800">
                      Year {holdPeriodData.optimalYear || '—'}
                    </div>
                    <div className="text-sm text-green-600">
                      IRR: {holdPeriodData.optimalIRR ? `${(holdPeriodData.optimalIRR * 100).toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-blue-50 border border-blue-100">
                    <div className="flex items-center gap-2 text-blue-700 mb-1">
                      <Calendar className="w-4 h-4" />
                      <span className="text-xs font-medium">Current Plan</span>
                    </div>
                    <div className="text-2xl font-bold text-blue-800">
                      Year {holdPeriodData.currentHoldPeriod || '—'}
                    </div>
                    <div className="text-sm text-blue-600">
                      {model?.irr ? `IRR: ${(model.irr * 100).toFixed(1)}%` : '—'}
                    </div>
                  </div>
                  <div className="p-4 rounded-lg bg-violet-50 border border-violet-100">
                    <div className="flex items-center gap-2 text-violet-700 mb-1">
                      <TrendingUp className="w-4 h-4" />
                      <span className="text-xs font-medium">Max Return</span>
                    </div>
                    <div className="text-2xl font-bold text-violet-800">
                      Year {holdPeriodData.highestReturnYear || '—'}
                    </div>
                    <div className="text-sm text-violet-600">
                      {holdPeriodData.highestTotalReturn
                        ? `$${(holdPeriodData.highestTotalReturn / 1000000).toFixed(2)}M`
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* Year-by-Year Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="p-2 text-left font-medium text-slate-500">Exit Year</th>
                        <th className="p-2 text-right font-medium text-slate-500">IRR</th>
                        <th className="p-2 text-right font-medium text-slate-500">Eq. Multiple</th>
                        <th className="p-2 text-right font-medium text-slate-500">Exit Value</th>
                        <th className="p-2 text-right font-medium text-slate-500">Total Return</th>
                        <th className="p-2 text-center font-medium text-slate-500">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {holdPeriodData.years.map((yr) => (
                        <tr
                          key={yr.year}
                          className={cn(
                            "border-b transition-colors",
                            yr.year === holdPeriodData.currentHoldPeriod && "bg-blue-50",
                            yr.year === holdPeriodData.optimalYear && "bg-green-50"
                          )}
                        >
                          <td className="p-2">
                            <span className="font-medium">Year {yr.year}</span>
                            {yr.year === holdPeriodData.currentHoldPeriod && (
                              <Badge variant="outline" className="ml-2 text-xs">Current</Badge>
                            )}
                            {yr.year === holdPeriodData.optimalYear && (
                              <Badge className="ml-2 text-xs bg-green-500">Optimal</Badge>
                            )}
                          </td>
                          <td className="p-2 text-right font-medium">
                            {yr.irr !== null ? `${(yr.irr * 100).toFixed(1)}%` : '—'}
                          </td>
                          <td className="p-2 text-right">
                            {yr.equityMultiple !== null ? `${yr.equityMultiple.toFixed(2)}x` : '—'}
                          </td>
                          <td className="p-2 text-right">
                            {yr.exitValue ? `$${(yr.exitValue / 1000000).toFixed(2)}M` : '—'}
                          </td>
                          <td className="p-2 text-right">
                            {yr.totalCashDistributed
                              ? `$${(yr.totalCashDistributed / 1000000).toFixed(2)}M`
                              : '—'}
                          </td>
                          <td className="p-2 text-center">
                            {yr.recommendation === 'recommended' && (
                              <Check className="w-4 h-4 text-green-500 mx-auto" />
                            )}
                            {yr.recommendation === 'acceptable' && (
                              <Check className="w-4 h-4 text-amber-500 mx-auto" />
                            )}
                            {yr.recommendation === 'caution' && (
                              <AlertTriangle className="w-4 h-4 text-amber-500 mx-auto" />
                            )}
                            {yr.recommendation === 'negative' && (
                              <TrendingDown className="w-4 h-4 text-red-500 mx-auto" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-500">
                No hold period data available
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Quick Sensitivity View */}
      {activeView === 'quick' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Sensitivity Summary</CardTitle>
            <CardDescription>
              How key assumptions affect returns
            </CardDescription>
          </CardHeader>
          <CardContent>
            {quickLoading ? (
              <div className="h-64 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : quickData ? (
              <div className="space-y-6">
                {/* Base Case Summary */}
                <div className="p-4 rounded-lg bg-slate-50 border">
                  <h4 className="text-sm font-medium text-slate-700 mb-3">Base Case</h4>
                  <div className="grid grid-cols-4 gap-4">
                    <div>
                      <div className="text-xs text-slate-500">IRR</div>
                      <div className="text-lg font-bold">
                        {quickData.baseCase.irr ? `${(quickData.baseCase.irr * 100).toFixed(1)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Eq. Multiple</div>
                      <div className="text-lg font-bold">
                        {quickData.baseCase.equityMultiple ? `${quickData.baseCase.equityMultiple.toFixed(2)}x` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">Cash-on-Cash</div>
                      <div className="text-lg font-bold">
                        {quickData.baseCase.cashOnCash ? `${(quickData.baseCase.cashOnCash * 100).toFixed(1)}%` : '—'}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">DSCR</div>
                      <div className="text-lg font-bold">
                        {quickData.baseCase.dscr ? `${quickData.baseCase.dscr.toFixed(2)}x` : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Sensitivity Tests */}
                <div className="space-y-3">
                  <h4 className="text-sm font-medium text-slate-700">Sensitivity Tests</h4>
                  {quickData.sensitivities.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 rounded-lg border hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {s.irrChange > 0 ? (
                          <TrendingUp className="w-5 h-5 text-green-500" />
                        ) : s.irrChange < 0 ? (
                          <TrendingDown className="w-5 h-5 text-red-500" />
                        ) : (
                          <Minus className="w-5 h-5 text-slate-400" />
                        )}
                        <span className="font-medium">{s.label}</span>
                      </div>
                      <div className="flex items-center gap-6 text-sm">
                        <div className="text-right">
                          <div className="text-xs text-slate-500">IRR</div>
                          <div className="font-medium">
                            {s.irr ? `${(s.irr * 100).toFixed(1)}%` : '—'}
                            {s.irrChange !== undefined && (
                              <span className={cn(
                                "ml-1 text-xs",
                                s.irrChange > 0 ? "text-green-600" : s.irrChange < 0 ? "text-red-600" : "text-slate-400"
                              )}>
                                ({s.irrChange > 0 ? '+' : ''}{(s.irrChange * 100).toFixed(1)}%)
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Eq. Multiple</div>
                          <div className="font-medium">
                            {s.equityMultiple ? `${s.equityMultiple.toFixed(2)}x` : '—'}
                            {s.emChange !== undefined && (
                              <span className={cn(
                                "ml-1 text-xs",
                                s.emChange > 0 ? "text-green-600" : s.emChange < 0 ? "text-red-600" : "text-slate-400"
                              )}>
                                ({s.emChange > 0 ? '+' : ''}{s.emChange.toFixed(2)}x)
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-64 flex items-center justify-center text-slate-500">
                No sensitivity data available
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Scenario Dialog */}
      <Dialog open={showCreateScenario} onOpenChange={setShowCreateScenario}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Scenario from Sensitivity</DialogTitle>
            <DialogDescription>
              Save this sensitivity analysis point as a named scenario
            </DialogDescription>
          </DialogHeader>

          {selectedCell && (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-slate-50">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs text-slate-500">{matrixData?.xAxis?.label}</div>
                    <div className="font-medium">
                      {matrixData?.xAxis?.values[matrixData?.xAxis?.rawValues?.indexOf(selectedCell.xValue)]}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">{matrixData?.yAxis?.label}</div>
                    <div className="font-medium">
                      {matrixData?.yAxis?.values[matrixData?.yAxis?.rawValues?.indexOf(selectedCell.yValue)]}
                    </div>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t">
                  <div className="text-xs text-slate-500">{matrixData?.metric?.label}</div>
                  <div className="text-xl font-bold">{selectedCell.formatted}</div>
                </div>
              </div>

              <div>
                <Label htmlFor="scenarioName">Scenario Name (optional)</Label>
                <Input
                  id="scenarioName"
                  placeholder="Enter custom name or leave blank for auto-generated"
                  value={customScenarioName}
                  onChange={(e) => setCustomScenarioName(e.target.value)}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateScenario(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateScenario}
              disabled={createScenarioMutation.isPending}
            >
              {createScenarioMutation.isPending ? (
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              Create Scenario
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
