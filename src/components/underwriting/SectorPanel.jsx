import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Building2,
  Hotel,
  Server,
  FlaskConical,
  Users,
  GraduationCap,
  Warehouse,
  Factory,
  ShoppingBag,
  Building,
  Home,
  HardHat,
  AlertTriangle,
  CheckCircle2,
  Info,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Target
} from 'lucide-react';

// Sector icons mapping
const SECTOR_ICONS = {
  MULTIFAMILY: Home,
  OFFICE: Building,
  INDUSTRIAL: Factory,
  RETAIL: ShoppingBag,
  HOTEL: Hotel,
  DATA_CENTER: Server,
  LIFE_SCIENCES: FlaskConical,
  SENIORS_HOUSING: Users,
  STUDENT_HOUSING: GraduationCap,
  SELF_STORAGE: Warehouse,
  MANUFACTURED_HOUSING: Home,
  DEVELOPMENT: HardHat
};

// Format values based on type
function formatValue(value, format) {
  if (value === null || value === undefined) return '—';

  switch (format) {
    case 'currency':
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'number':
      return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
    case 'multiple':
      return `${value.toFixed(2)}x`;
    default:
      return typeof value === 'number' ? value.toFixed(2) : String(value);
  }
}

// Determine format from metric key
function getMetricFormat(key) {
  if (key.includes('Rate') || key.includes('Percent') || key.includes('Ratio') || key.includes('Margin') || key.includes('Occupancy')) {
    return 'percent';
  }
  if (key.includes('Price') || key.includes('Revenue') || key.includes('Rent') || key.includes('NOI') || key.includes('Cost')) {
    return 'currency';
  }
  if (key.includes('Multiple')) {
    return 'multiple';
  }
  return 'number';
}

// Format metric key for display
function formatMetricLabel(key) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, str => str.toUpperCase())
    .replace('Per ', '/')
    .replace('Pue', 'PUE')
    .replace('Irr', 'IRR')
    .replace('Noi', 'NOI')
    .replace('Sf', 'SF')
    .replace('Kw', 'kW');
}

export default function SectorPanel({ dealId, model, onUpdate }) {
  const queryClient = useQueryClient();
  const [showAllMetrics, setShowAllMetrics] = useState(false);
  const [selectedSector, setSelectedSector] = useState(null);

  // Fetch all available sectors
  const { data: sectorsData } = useQuery({
    queryKey: ['sectors'],
    queryFn: () => bff.sectors.getAll(),
    staleTime: 1000 * 60 * 60 // 1 hour
  });

  // Detect sector from deal
  const { data: detectedSector, isLoading: detectingLoading } = useQuery({
    queryKey: ['detect-sector', dealId],
    queryFn: () => bff.sectors.detectSector(dealId),
    enabled: !!dealId
  });

  // Get sector metrics
  const { data: sectorMetrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['sector-metrics', dealId, selectedSector],
    queryFn: () => bff.sectors.getMetrics(dealId, selectedSector),
    enabled: !!dealId
  });

  // Validate benchmarks
  const { data: benchmarkValidation, isLoading: validationLoading, refetch: refetchValidation } = useQuery({
    queryKey: ['validate-benchmarks', dealId, selectedSector],
    queryFn: () => bff.sectors.validateBenchmarks(dealId, selectedSector),
    enabled: !!dealId
  });

  // Get sector config
  const currentSector = selectedSector || sectorMetrics?.sector || detectedSector?.sector;
  const { data: sectorConfig } = useQuery({
    queryKey: ['sector-config', currentSector],
    queryFn: () => bff.sectors.getConfig(currentSector),
    enabled: !!currentSector
  });

  const SectorIcon = SECTOR_ICONS[currentSector] || Building2;
  const sectors = sectorsData?.sectors || [];
  const metrics = sectorMetrics?.metrics || {};
  const warnings = sectorMetrics?.warnings || [];
  const riskFactors = sectorMetrics?.riskFactors || [];
  const primaryMetrics = sectorMetrics?.primaryMetrics || [];
  const validations = benchmarkValidation?.validations || [];

  // Count passed/warning validations
  const passedCount = validations.filter(v => v.valid && !v.warning).length;
  const warningCount = validations.filter(v => v.warning).length;

  const handleSectorChange = (newSector) => {
    setSelectedSector(newSector);
    queryClient.invalidateQueries({ queryKey: ['sector-metrics', dealId] });
    queryClient.invalidateQueries({ queryKey: ['validate-benchmarks', dealId] });
  };

  if (detectingLoading || metricsLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-100 rounded w-1/4"></div>
          <div className="h-32 bg-slate-100 rounded"></div>
          <div className="h-48 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Sector Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600">
                <SectorIcon className="w-6 h-6" />
              </div>
              <div>
                <CardTitle className="text-lg">
                  {sectorMetrics?.sectorName || 'Property Sector'}
                </CardTitle>
                <CardDescription>
                  {detectedSector?.detected ? 'Auto-detected from deal profile' : 'Select property type for tailored analysis'}
                </CardDescription>
              </div>
            </div>

            {/* Sector Selector */}
            <Select value={currentSector || ''} onValueChange={handleSectorChange}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Select sector" />
              </SelectTrigger>
              <SelectContent>
                {sectors.map((sector) => {
                  const Icon = SECTOR_ICONS[sector.code] || Building2;
                  return (
                    <SelectItem key={sector.code} value={sector.code}>
                      <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4" />
                        {sector.name}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
      </Card>

      {/* Sector Metrics */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Sector-Specific Metrics</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllMetrics(!showAllMetrics)}
              className="text-sm"
            >
              {showAllMetrics ? 'Show Primary Only' : 'Show All Metrics'}
              {showAllMetrics ? <ChevronDown className="w-4 h-4 ml-1" /> : <ChevronRight className="w-4 h-4 ml-1" />}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {Object.keys(metrics).length === 0 ? (
            <p className="text-sm text-[#737373]">No sector-specific metrics calculated yet. Ensure the underwriting model has data.</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {Object.entries(metrics)
                .filter(([key]) => showAllMetrics || primaryMetrics.includes(key))
                .map(([key, value]) => {
                  const format = getMetricFormat(key);
                  const warning = warnings.find(w => w.metric === key);

                  return (
                    <div
                      key={key}
                      className={cn(
                        "p-3 rounded-lg border",
                        warning ? "bg-amber-50 border-amber-200" : "bg-slate-50 border-slate-100"
                      )}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs text-[#737373] truncate" title={formatMetricLabel(key)}>
                          {formatMetricLabel(key)}
                        </span>
                        {warning && (
                          <Tooltip>
                            <TooltipTrigger>
                              <AlertTriangle className="w-3 h-3 text-amber-500" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">{warning.warning}</p>
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="text-lg font-semibold">
                        {typeof value === 'string' ? value : formatValue(value, format)}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Benchmark Validation */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Benchmark Validation</CardTitle>
              <CardDescription className="text-xs mt-1">
                {benchmarkValidation?.summary || 'Comparing metrics against typical sector ranges'}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {passedCount > 0 && (
                <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {passedCount} passed
                </Badge>
              )}
              {warningCount > 0 && (
                <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {warningCount} warnings
                </Badge>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => refetchValidation()}
                disabled={validationLoading}
              >
                <RefreshCw className={cn("w-4 h-4", validationLoading && "animate-spin")} />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {validations.length === 0 ? (
            <p className="text-sm text-[#737373]">No benchmark data available for validation.</p>
          ) : (
            <div className="space-y-2">
              {validations.slice(0, showAllMetrics ? undefined : 6).map((validation, idx) => (
                <div
                  key={idx}
                  className={cn(
                    "flex items-center justify-between p-2 rounded-lg text-sm",
                    validation.warning ? "bg-amber-50" : validation.valid ? "bg-green-50" : "bg-slate-50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {validation.warning ? (
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                    ) : validation.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                    ) : (
                      <Info className="w-4 h-4 text-slate-400" />
                    )}
                    <span className="font-medium">{formatMetricLabel(validation.metric)}</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs">
                    <span className="text-[#737373]">
                      Actual: <span className="font-medium">{formatValue(validation.value, getMetricFormat(validation.metric))}</span>
                    </span>
                    {validation.benchmark && (
                      <span className="text-[#737373]">
                        Benchmark: {formatValue(validation.benchmark.min, getMetricFormat(validation.metric))} - {formatValue(validation.benchmark.max, getMetricFormat(validation.metric))}
                      </span>
                    )}
                  </div>
                </div>
              ))}
              {!showAllMetrics && validations.length > 6 && (
                <button
                  onClick={() => setShowAllMetrics(true)}
                  className="text-xs text-indigo-600 hover:underline"
                >
                  Show {validations.length - 6} more validations
                </button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Risk Factors */}
      {riskFactors.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-rose-500" />
              Key Risk Factors for {sectorMetrics?.sectorName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {riskFactors.slice(0, 6).map((risk, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm">
                  <span className="text-rose-500 mt-1">•</span>
                  <span className="text-[#404040]">{risk}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Sector-Specific Inputs (Optional expandable section) */}
      {sectorConfig?.inputs?.unique && Object.keys(sectorConfig.inputs.unique).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Sector-Specific Inputs</CardTitle>
            <CardDescription className="text-xs">
              Additional inputs specific to {sectorMetrics?.sectorName} underwriting
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {Object.entries(sectorConfig.inputs.unique).map(([key, config]) => (
                <div key={key}>
                  <Label className="text-xs text-[#737373]">{config.label}</Label>
                  <Input
                    type="number"
                    placeholder={config.placeholder || '—'}
                    className="mt-1 h-8 text-sm"
                    disabled
                  />
                  {config.description && (
                    <p className="text-xs text-[#737373] mt-1">{config.description}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-xs text-[#737373] mt-4">
              Sector-specific input editing coming soon. These inputs will enhance your underwriting analysis.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
