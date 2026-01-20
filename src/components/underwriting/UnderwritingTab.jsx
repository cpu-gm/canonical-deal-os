import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Calculator,
  FileSpreadsheet,
  AlertTriangle,
  RefreshCw,
  FileText,
  TrendingUp,
  ChevronRight,
  Table,
  Layers,
  Grid3X3,
  Target
} from 'lucide-react';

import ExtractionsPanel from './ExtractionsPanel';
import SectorPanel from './SectorPanel';
import ModelInputsPanel from './ModelInputsPanel';
import ConflictsPanel from './ConflictsPanel';
import ScenariosPanel from './ScenariosPanel';
import MemoPanel from './MemoPanel';
import ExcelImportModal from './ExcelImportModal';
import CashFlowTable from './CashFlowTable';
import WaterfallPanel from './WaterfallPanel';
import SensitivityMatrix from './SensitivityMatrix';

export default function UnderwritingTab({ dealId, dealName }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('model');
  const [showExcelImport, setShowExcelImport] = useState(false);

  // Fetch underwriting model
  const { data: modelData, isLoading: modelLoading } = useQuery({
    queryKey: ['underwriting-model', dealId],
    queryFn: () => bff.underwriting.getModel(dealId),
    enabled: !!dealId
  });

  // Fetch extractions
  const { data: extractionsData } = useQuery({
    queryKey: ['extractions', dealId],
    queryFn: () => bff.underwriting.listExtractions(dealId),
    enabled: !!dealId
  });

  // Fetch conflicts
  const { data: conflictsData } = useQuery({
    queryKey: ['conflicts', dealId],
    queryFn: () => bff.underwriting.listConflicts(dealId),
    enabled: !!dealId
  });

  // Fetch scenarios
  const { data: scenariosData } = useQuery({
    queryKey: ['scenarios', dealId],
    queryFn: () => bff.underwriting.listScenarios(dealId),
    enabled: !!dealId
  });

  // Fetch memo
  const { data: memoData } = useQuery({
    queryKey: ['memo', dealId],
    queryFn: () => bff.underwriting.getMemo(dealId),
    enabled: !!dealId
  });

  // Calculate mutation
  const calculateMutation = useMutation({
    mutationFn: () => bff.underwriting.calculate(dealId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['underwriting-model', dealId] });
      toast({ title: 'Model recalculated', description: 'Returns and metrics updated.' });
    },
    onError: (error) => {
      toast({ title: 'Calculation failed', description: error.message, variant: 'destructive' });
    }
  });

  const model = modelData?.model;
  const extractions = extractionsData?.extractions || [];
  const conflicts = conflictsData?.conflicts || [];
  const scenarios = scenariosData?.scenarios || [];
  const memo = memoData?.memo;

  const openConflicts = conflicts.filter(c => c.status === 'OPEN');

  // Summary stats
  const stats = {
    extractionCount: extractions.length,
    conflictCount: openConflicts.length,
    scenarioCount: scenarios.length,
    hasMemo: !!memo?.content
  };

  if (modelLoading) {
    return (
      <div className="space-y-4">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-100 rounded w-1/4"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-24 bg-slate-100 rounded"></div>)}
          </div>
          <div className="h-64 bg-slate-100 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with quick stats */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[#171717]">Underwriting Model</h2>
          <p className="text-sm text-[#737373] mt-1">
            Build and analyze your investment thesis
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowExcelImport(true)}
            className="gap-2"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Import Excel
          </Button>
          <Button
            size="sm"
            onClick={() => calculateMutation.mutate()}
            disabled={calculateMutation.isPending}
            className="gap-2 bg-[#171717] hover:bg-[#262626]"
          >
            {calculateMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Calculator className="w-4 h-4" />
            )}
            Recalculate
          </Button>
        </div>
      </div>

      {/* Quick stat cards */}
      <div className="grid grid-cols-4 gap-4">
        <QuickStatCard
          icon={FileSpreadsheet}
          label="Extractions"
          value={stats.extractionCount}
          color="blue"
          onClick={() => setActiveTab('extractions')}
        />
        <QuickStatCard
          icon={AlertTriangle}
          label="Open Conflicts"
          value={stats.conflictCount}
          color={stats.conflictCount > 0 ? 'amber' : 'green'}
          onClick={() => setActiveTab('conflicts')}
        />
        <QuickStatCard
          icon={TrendingUp}
          label="Scenarios"
          value={stats.scenarioCount}
          color="violet"
          onClick={() => setActiveTab('scenarios')}
        />
        <QuickStatCard
          icon={FileText}
          label="IC Memo"
          value={stats.hasMemo ? 'Ready' : 'Draft'}
          color={stats.hasMemo ? 'green' : 'slate'}
          onClick={() => setActiveTab('memo')}
        />
      </div>

      {/* Main content tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="bg-[#F5F5F5] p-1 inline-flex w-auto min-w-full">
            <TabsTrigger value="model" className="data-[state=active]:bg-white whitespace-nowrap">
              <Calculator className="w-4 h-4 mr-1.5" />
              Model
            </TabsTrigger>
            <TabsTrigger value="cashflows" className="data-[state=active]:bg-white whitespace-nowrap">
              <Table className="w-4 h-4 mr-1.5" />
              Cash Flows
            </TabsTrigger>
            <TabsTrigger value="extractions" className="data-[state=active]:bg-white whitespace-nowrap">
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
              Extractions
              {stats.extractionCount > 0 && (
                <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs">
                  {stats.extractionCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="conflicts" className="data-[state=active]:bg-white whitespace-nowrap">
              <AlertTriangle className="w-4 h-4 mr-1.5" />
              Conflicts
              {stats.conflictCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-xs">
                  {stats.conflictCount}
                </Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="scenarios" className="data-[state=active]:bg-white whitespace-nowrap">
              <TrendingUp className="w-4 h-4 mr-1.5" />
              Scenarios
            </TabsTrigger>
            <TabsTrigger value="waterfall" className="data-[state=active]:bg-white whitespace-nowrap">
              <Layers className="w-4 h-4 mr-1.5" />
              Waterfall
            </TabsTrigger>
            <TabsTrigger value="sensitivity" className="data-[state=active]:bg-white whitespace-nowrap">
              <Grid3X3 className="w-4 h-4 mr-1.5" />
              Sensitivity
            </TabsTrigger>
            <TabsTrigger value="sector" className="data-[state=active]:bg-white whitespace-nowrap">
              <Target className="w-4 h-4 mr-1.5" />
              Sector
            </TabsTrigger>
            <TabsTrigger value="memo" className="data-[state=active]:bg-white whitespace-nowrap">
              <FileText className="w-4 h-4 mr-1.5" />
              IC Memo
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="model" className="mt-6">
          <ModelInputsPanel
            dealId={dealId}
            model={model}
            onUpdate={() => queryClient.invalidateQueries({ queryKey: ['underwriting-model', dealId] })}
          />
        </TabsContent>

        <TabsContent value="cashflows" className="mt-6">
          <CashFlowTable dealId={dealId} />
        </TabsContent>

        <TabsContent value="extractions" className="mt-6">
          <ExtractionsPanel
            dealId={dealId}
            extractions={extractions}
            onApply={() => {
              queryClient.invalidateQueries({ queryKey: ['underwriting-model', dealId] });
              queryClient.invalidateQueries({ queryKey: ['extractions', dealId] });
            }}
          />
        </TabsContent>

        <TabsContent value="conflicts" className="mt-6">
          <ConflictsPanel
            dealId={dealId}
            conflicts={conflicts}
            onResolve={() => {
              queryClient.invalidateQueries({ queryKey: ['conflicts', dealId] });
              queryClient.invalidateQueries({ queryKey: ['underwriting-model', dealId] });
            }}
          />
        </TabsContent>

        <TabsContent value="scenarios" className="mt-6">
          <ScenariosPanel
            dealId={dealId}
            scenarios={scenarios}
            baseModel={model}
            onUpdate={() => queryClient.invalidateQueries({ queryKey: ['scenarios', dealId] })}
          />
        </TabsContent>

        <TabsContent value="waterfall" className="mt-6">
          <WaterfallPanel
            dealId={dealId}
            model={model}
            scenarios={scenarios}
            onUpdate={() => {
              queryClient.invalidateQueries({ queryKey: ['waterfall', dealId] });
              queryClient.invalidateQueries({ queryKey: ['waterfall-distributions', dealId] });
            }}
          />
        </TabsContent>

        <TabsContent value="sensitivity" className="mt-6">
          <SensitivityMatrix
            dealId={dealId}
            model={model}
            onUpdate={() => {
              queryClient.invalidateQueries({ queryKey: ['scenarios', dealId] });
            }}
          />
        </TabsContent>

        <TabsContent value="sector" className="mt-6">
          <SectorPanel
            dealId={dealId}
            model={model}
            onUpdate={() => {
              queryClient.invalidateQueries({ queryKey: ['underwriting-model', dealId] });
              queryClient.invalidateQueries({ queryKey: ['sector-metrics', dealId] });
            }}
          />
        </TabsContent>

        <TabsContent value="memo" className="mt-6">
          <MemoPanel
            dealId={dealId}
            dealName={dealName}
            memo={memo}
            model={model}
            scenarios={scenarios}
            onUpdate={() => queryClient.invalidateQueries({ queryKey: ['memo', dealId] })}
          />
        </TabsContent>
      </Tabs>

      {/* Excel Import Modal */}
      {showExcelImport && (
        <ExcelImportModal
          dealId={dealId}
          open={showExcelImport}
          onClose={() => setShowExcelImport(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['underwriting-model', dealId] });
            queryClient.invalidateQueries({ queryKey: ['extractions', dealId] });
            setShowExcelImport(false);
          }}
        />
      )}
    </div>
  );
}

function QuickStatCard({ icon: Icon, label, value, color, onClick }) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600 border-blue-100',
    green: 'bg-green-50 text-green-600 border-green-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    violet: 'bg-violet-50 text-violet-600 border-violet-100',
    slate: 'bg-slate-50 text-slate-600 border-slate-100'
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "p-4 rounded-xl border text-left transition-all hover:shadow-md",
        colorMap[color]
      )}
    >
      <div className="flex items-center justify-between">
        <Icon className="w-5 h-5" />
        <ChevronRight className="w-4 h-4 opacity-50" />
      </div>
      <div className="mt-3">
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-sm opacity-75">{label}</div>
      </div>
    </button>
  );
}
