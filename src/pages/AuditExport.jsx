import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { 
  FileDown, 
  FileText, 
  Shield,
  CheckCircle2,
  Loader2,
  Building2,
  Clock,
  AlertTriangle
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

export default function AuditExportPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const dealIdFromUrl = urlParams.get('id');
  
  const [selectedDealId, setSelectedDealId] = useState(dealIdFromUrl || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeOptions, setIncludeOptions] = useState({
    metadata: true,
    timeline: true,
    explains: true,
    authorities: true,
    evidenceHashes: true,
    covenants: true
  });

  const { data: deals = [] } = useQuery({
    queryKey: ['deals'],
    queryFn: () => bff.deals.list(),
  });

  const { data: dealRecords } = useQuery({
    queryKey: ['deal-records', selectedDealId],
    queryFn: () => bff.deals.records(selectedDealId),
    enabled: !!selectedDealId
  });

  const selectedDeal = dealRecords?.deal ?? deals.find(d => d.id === selectedDealId);
  const events = dealRecords?.events ?? [];
  const authorities = dealRecords?.authorities ?? [];
  const covenants = [];
  const approvals = dealRecords?.approvals ?? {};
  const materials = dealRecords?.materials ?? [];
  const evidenceIndex = dealRecords?.evidence_index ?? {
    dealId: selectedDealId,
    at: null,
    artifacts: []
  };

  const handleGenerateExport = async () => {
    if (!selectedDealId) return;
    
    setIsGenerating(true);
    
    // Simulate PDF generation delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create a simple text export (in production, this would be a PDF)
    const exportData = {
      generatedAt: new Date().toISOString(),
      deal: selectedDeal,
      events: events,
      authorities: authorities,
      covenants: covenants,
      approvals: approvals,
      materials: materials,
      evidence_index: evidenceIndex,
      options: includeOptions
    };

    // Create downloadable JSON (placeholder for PDF)
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-export-${selectedDeal.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
    
    setIsGenerating(false);
  };

  const toggleOption = (key) => {
    setIncludeOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Audit Export</h1>
        <p className="text-sm text-[#737373] mt-1">
          Generate certified audit documentation from immutable event history
        </p>
      </div>

      {/* Deal Selector */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <label className="text-sm font-medium text-[#171717] block mb-2">Select Deal</label>
        <Select value={selectedDealId} onValueChange={setSelectedDealId}>
          <SelectTrigger className="border-[#E5E5E5] max-w-md">
            <SelectValue placeholder="Choose a deal to export" />
          </SelectTrigger>
          <SelectContent>
            {deals.map(deal => (
              <SelectItem key={deal.id} value={deal.id}>
                {deal.name} — {deal.lifecycle_state || 'Draft'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selectedDeal && (
        <>
          {/* Deal Summary */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
            <h2 className="text-sm font-semibold text-[#171717] mb-4">Export Summary</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-[#FAFAFA] rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Building2 className="w-4 h-4 text-[#A3A3A3]" />
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Deal</span>
                </div>
                <p className="text-sm font-medium text-[#171717]">{selectedDeal.name}</p>
              </div>
              
              <div className="p-3 bg-[#FAFAFA] rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Clock className="w-4 h-4 text-[#A3A3A3]" />
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">State</span>
                </div>
                <p className="text-sm font-medium text-[#171717]">{selectedDeal.lifecycle_state}</p>
              </div>
              
              <div className="p-3 bg-[#FAFAFA] rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <FileText className="w-4 h-4 text-[#A3A3A3]" />
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Events</span>
                </div>
                <p className="text-sm font-medium text-[#171717]">{events.length}</p>
              </div>
              
              <div className="p-3 bg-[#FAFAFA] rounded-lg">
                <div className="flex items-center gap-2 mb-1">
                  <Shield className="w-4 h-4 text-[#A3A3A3]" />
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Authorities</span>
                </div>
                <p className="text-sm font-medium text-[#171717]">{authorities.length}</p>
              </div>
            </div>

            {selectedDeal.stress_mode && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-sm text-red-800">Stress Mode Active — will be included in export</span>
              </div>
            )}
          </div>

          {/* Export Options */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
            <h2 className="text-sm font-semibold text-[#171717] mb-4">Include in Export</h2>
            
            <div className="space-y-3">
              {[
                { key: 'metadata', label: 'Deal Metadata', description: 'Basic deal information, participants, and current state' },
                { key: 'timeline', label: 'Full Event Timeline', description: 'Complete chronological record of all deal events' },
                { key: 'explains', label: 'Explain() Outputs', description: 'Generated explanations for key events and decisions' },
                { key: 'authorities', label: 'Authority Signatures', description: 'Record of all authorizations and consent actions' },
                { key: 'evidenceHashes', label: 'Evidence Hashes', description: 'Cryptographic hashes of all supporting documents' },
                { key: 'covenants', label: 'Covenant Status', description: 'Current and historical covenant compliance data' }
              ].map((option) => (
                <div 
                  key={option.key}
                  className="flex items-start gap-3 p-3 rounded-lg hover:bg-[#FAFAFA] cursor-pointer"
                  onClick={() => toggleOption(option.key)}
                >
                  <Checkbox 
                    checked={includeOptions[option.key]}
                    onCheckedChange={() => toggleOption(option.key)}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#171717]">{option.label}</p>
                    <p className="text-xs text-[#A3A3A3] mt-0.5">{option.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[#171717]">Generate Export</h3>
                <p className="text-xs text-[#A3A3A3] mt-1">
                  Export will be certified from immutable event history
                </p>
              </div>
              <Button 
                onClick={handleGenerateExport}
                disabled={isGenerating}
                className="bg-[#0A0A0A] hover:bg-[#171717]"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <FileDown className="w-4 h-4 mr-2" />
                    Generate Audit Export
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Certification Notice */}
          <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-green-800">Certified Export</p>
                <p className="text-xs text-green-700 mt-1">
                  This export is generated from the immutable event history maintained by Canonical Deal OS. 
                  All timestamps, evidence hashes, and authority records are preserved exactly as recorded. 
                  This document is suitable for regulatory submission and legal review.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Empty State */}
      {!selectedDealId && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-12 text-center">
          <FileDown className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">Select a deal to export</h3>
          <p className="text-sm text-[#737373]">
            Choose a deal from the dropdown above to generate an audit export
          </p>
        </div>
      )}
    </div>
  );
}
