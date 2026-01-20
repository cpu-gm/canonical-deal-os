import React from 'react';
import { X, FileText, User, Bot, Cpu, Calendar, Hash, Shield } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const fieldExplanations = {
  purchase_price: {
    what: "The total acquisition price for the asset",
    why: "Determines equity requirements and establishes basis for LTV calculations"
  },
  noi: {
    what: "Net Operating Income - annual property income minus operating expenses",
    why: "Primary measure of property performance, used to calculate DSCR and cap rate"
  },
  ltv: {
    what: "Loan-to-Value ratio - total debt divided by property value",
    why: "Key risk metric for lenders, often capped by loan covenants"
  },
  dscr: {
    what: "Debt Service Coverage Ratio - NOI divided by annual debt service",
    why: "Measures ability to service debt, critical covenant metric"
  },
  cap_rate: {
    what: "Capitalization Rate - NOI divided by purchase price",
    why: "Market comparison metric indicating required yield"
  }
};

const evidenceTypeConfig = {
  'document_verified': { 
    icon: FileText, 
    label: 'Document-Verified',
    description: 'Value extracted from uploaded document',
    color: 'text-green-600 bg-green-50'
  },
  'human_attested': { 
    icon: User, 
    label: 'Human-Attested',
    description: 'Value confirmed by authorized party',
    color: 'text-blue-600 bg-blue-50'
  },
  'ai_derived': { 
    icon: Bot, 
    label: 'AI-Derived',
    description: 'Value extracted using AI (pending verification)',
    color: 'text-violet-600 bg-violet-50'
  },
  'system_computed': { 
    icon: Cpu, 
    label: 'System-Computed',
    description: 'Value calculated from other verified inputs',
    color: 'text-slate-600 bg-slate-50'
  }
};

export default function TraceabilityPanel({ deal, field, events, onClose }) {
  const profile = deal?.profile ?? {};
  const explanation = fieldExplanations[field] || { 
    what: 'Value stored in deal record',
    why: 'Part of deal documentation'
  };

  // Find the most recent event that modified this field
  const relatedEvent = events.find(e => 
    e.event_description?.toLowerCase()?.includes(field.replace('_', ' ')) ||
    e.event_type === 'ai_derivation'
  );

  const evidenceType = relatedEvent?.evidence_type || (profile.ai_derived ? 'ai_derived' : 'human_attested');
  const evidence = evidenceTypeConfig[evidenceType];
  const EvidenceIcon = evidence.icon;

  const getValue = () => {
    const val = profile[field] ?? deal[field];
    if (!val) return '—';
    if (field === 'purchase_price' || field === 'noi') {
      return `$${val.toLocaleString()}`;
    }
    if (field === 'ltv' || field === 'cap_rate') {
      return `${(val * 100).toFixed(2)}%`;
    }
    if (field === 'dscr') {
      return `${val.toFixed(2)}x`;
    }
    return val;
  };

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex justify-end">
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E5E5] p-6 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Traceability</span>
            <h2 className="text-lg font-semibold text-[#171717] capitalize">
              {field.replace(/_/g, ' ')}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Current Value */}
          <div className="p-4 bg-[#FAFAFA] rounded-xl">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Current Value</span>
            <p className="text-2xl font-semibold text-[#171717] mt-1">{getValue()}</p>
          </div>

          {/* What is this? */}
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">1</span>
              What is this?
            </h3>
            <p className="text-sm text-[#737373] pl-8">{explanation.what}</p>
          </div>

          {/* Why does it exist? */}
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">2</span>
              Why does it exist?
            </h3>
            <p className="text-sm text-[#737373] pl-8">{explanation.why}</p>
          </div>

          {/* What caused it? */}
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">3</span>
              What caused it?
            </h3>
            <div className="pl-8">
              {relatedEvent ? (
                <div className="p-3 bg-[#FAFAFA] rounded-lg border border-[#E5E5E5]">
                  <p className="text-sm font-medium text-[#171717]">{relatedEvent.event_title}</p>
                  <p className="text-xs text-[#737373] mt-1">{relatedEvent.event_description}</p>
                </div>
              ) : (
                <p className="text-sm text-[#737373]">Initial deal creation</p>
              )}
            </div>
          </div>

          {/* Who authorized it? */}
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">4</span>
              Who authorized it?
            </h3>
            <div className="pl-8 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-[#F5F5F5] flex items-center justify-center">
                <Shield className="w-4 h-4 text-[#737373]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#171717]">
                  {relatedEvent?.authority_name || 'System'}
                </p>
                <p className="text-xs text-[#A3A3A3]">
                  {relatedEvent?.authority_role || 'Automated'}
                </p>
              </div>
            </div>
          </div>

          {/* What evidence supports it? */}
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">5</span>
              What evidence supports it?
            </h3>
            <div className="pl-8">
              <div className={cn("p-3 rounded-lg border flex items-start gap-3", evidence.color)}>
                <EvidenceIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium">{evidence.label}</p>
                  <p className="text-xs mt-0.5 opacity-80">{evidence.description}</p>
                </div>
              </div>
              
              {relatedEvent?.evidence_hash && (
                <div className="mt-3 p-3 bg-[#FAFAFA] rounded-lg border border-[#E5E5E5]">
                  <div className="flex items-center gap-2 text-xs text-[#A3A3A3]">
                    <Hash className="w-3 h-3" />
                    <span>Document Hash</span>
                  </div>
                  <code className="text-xs text-[#737373] font-mono mt-1 block break-all">
                    {relatedEvent.evidence_hash}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* When was this true? */}
          <div>
            <h3 className="text-sm font-semibold text-[#171717] mb-2 flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-medium">6</span>
              When was this true?
            </h3>
            <div className="pl-8 flex items-center gap-3">
              <Calendar className="w-4 h-4 text-[#A3A3A3]" />
              <span className="text-sm text-[#737373]">
                {relatedEvent 
                  ? new Date(relatedEvent.timestamp || relatedEvent.created_date).toLocaleString()
                  : new Date(deal.created_date).toLocaleString()
                }
              </span>
            </div>
          </div>

          {/* Truth Classification */}
          <div className="p-4 bg-[#FAFAFA] rounded-xl border border-[#E5E5E5]">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Truth Classification</span>
            <div className="flex items-center gap-2 mt-2">
              <div className={cn("px-2 py-1 rounded text-xs font-medium", evidence.color)}>
                {evidence.label}
              </div>
              {profile.ai_derived && profile.verification_status === 'pending_verification' && (
                <div className="px-2 py-1 rounded text-xs font-medium bg-amber-50 text-amber-700">
                  ⚠️ Pending Verification
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
