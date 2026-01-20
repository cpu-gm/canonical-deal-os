import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { 
  MessageSquare, 
  Send,
  FileText,
  Calendar,
  Shield,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Search
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const suggestedQueries = [
  "Why is the deal blocked?",
  "Explain the current stress mode",
  "Why is this covenant in breach?",
  "What caused the last state transition?",
  "Who authorized the closing?",
  "Explain the LTV calculation",
  "Why is verification pending?",
  "What evidence supports the NOI?"
];

const actionKeywordMap = [
  { actionType: "OPEN_REVIEW", keywords: ["open review", "submit", "review"] },
  { actionType: "APPROVE_DEAL", keywords: ["approve", "approval"] },
  { actionType: "ATTEST_READY_TO_CLOSE", keywords: ["ready to close", "attest"] },
  { actionType: "FINALIZE_CLOSING", keywords: ["finalize closing", "closing", "close"] },
  { actionType: "ACTIVATE_OPERATIONS", keywords: ["activate operations", "operate", "operating"] },
  { actionType: "DECLARE_CHANGE", keywords: ["declare change", "change detected", "change"] },
  { actionType: "RECONCILE_CHANGE", keywords: ["reconcile", "change reconciled"] },
  { actionType: "DECLARE_DISTRESS", keywords: ["distress", "stress mode"] },
  { actionType: "RESOLVE_DISTRESS", keywords: ["resolve distress", "resolve"] },
  { actionType: "IMPOSE_FREEZE", keywords: ["freeze", "impose freeze"] },
  { actionType: "LIFT_FREEZE", keywords: ["lift freeze", "unfreeze"] },
  { actionType: "FINALIZE_EXIT", keywords: ["exit", "finalize exit"] },
  { actionType: "TERMINATE_DEAL", keywords: ["terminate", "termination"] },
  { actionType: "DISPUTE_DATA", keywords: ["dispute", "dispute data"] },
  { actionType: "OVERRIDE", keywords: ["override"] }
];

function resolveActionType(queryText, deal) {
  const normalized = (queryText || "").toLowerCase();
  for (const entry of actionKeywordMap) {
    if (entry.keywords.some((keyword) => normalized.includes(keyword))) {
      return entry.actionType;
    }
  }
  return deal?.next_action_type ?? null;
}

function buildFallbackExplanation(message) {
  return {
    direct_answer: message,
    evidence_items: [],
    authority_chain: [],
    blocking_conditions: [],
    confidence: "low"
  };
}

function buildExplanationFromExplain(explain, records, actionType) {
  const events = Array.isArray(records?.events) ? records.events : [];
  const artifacts = Array.isArray(records?.evidence_index?.artifacts)
    ? records.evidence_index.artifacts
    : [];

  const recentEvents = [...events].slice(-5).reverse();
  const recentArtifacts = [...artifacts].slice(-3).reverse();

  const evidenceItems = [
    ...recentEvents.map((event) => ({
      description:
        event.event_description || event.event_title || event.event_type || "Event",
      type: event.evidence_type,
      timestamp: event.timestamp || event.created_date || null,
      source: event.id
    })),
    ...recentArtifacts.map((artifact) => ({
      description: `Artifact: ${artifact.filename || artifact.artifactId}`,
      type: "document_verified",
      timestamp: artifact.createdAt || null,
      source: artifact.artifactId
    }))
  ];

  const blockingConditions =
    explain?.status === "BLOCKED"
      ? (explain.reasons ?? [])
          .map((reason) => reason.message || reason.type)
          .filter(Boolean)
      : [];

  const authorityChain = recentEvents.map((event) => ({
    role: event.authority_role || "System",
    action: event.event_title || event.event_type || "Event",
    timestamp: event.timestamp || event.created_date || null
  }));

  const directAnswer =
    explain?.status === "BLOCKED"
      ? `Blocked on ${actionType}. ${blockingConditions[0] ? `Primary blocker: ${blockingConditions[0]}.` : ""}`.trim()
      : `Allowed to proceed with ${actionType}.`;

  const confidence =
    explain?.status === "BLOCKED"
      ? "high"
      : evidenceItems.length > 0
        ? "medium"
        : "low";

  return {
    direct_answer: directAnswer,
    evidence_items: evidenceItems,
    authority_chain: authorityChain,
    blocking_conditions: blockingConditions,
    confidence
  };
}

export default function ExplainPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const dealIdFromUrl = urlParams.get('id');
  const queryFromUrl = urlParams.get('query');
  
  const [selectedDealId, setSelectedDealId] = useState(dealIdFromUrl || '');
  const [query, setQuery] = useState('');
  const [isExplaining, setIsExplaining] = useState(false);
  const [explanation, setExplanation] = useState(null);

  const { data: deals = [] } = useQuery({
    queryKey: ['deals'],
    queryFn: () => bff.deals.list(),
  });

  const { data: dealRecords, refetch: refetchRecords } = useQuery({
    queryKey: ['deal-records', selectedDealId],
    queryFn: () => bff.deals.records(selectedDealId),
    enabled: !!selectedDealId
  });

  const selectedDeal = dealRecords?.deal ?? deals.find(d => d.id === selectedDealId);

  const handleExplain = React.useCallback(async (queryText) => {
    const q = (queryText || query).trim();
    if (!q || !selectedDealId) return;
    
    setIsExplaining(true);
    setExplanation(null);
    setQuery(q);

    try {
      let records = dealRecords;
      if (!records) {
        const refreshed = await refetchRecords();
        records = refreshed.data;
      }

      const actionType = resolveActionType(q, records?.deal ?? selectedDeal);
      if (!actionType) {
        setExplanation(buildFallbackExplanation("No action context available for this deal."));
        return;
      }

      const explain = await bff.deals.explain(selectedDealId, actionType, {});
      const formatted = buildExplanationFromExplain(explain, records, actionType);
      setExplanation(formatted);
    } catch (error) {
      console.error('Error explaining:', error);
      setExplanation(
        buildFallbackExplanation(
          "Unable to generate explanation. Please try a more specific query."
        )
      );
    } finally {
      setIsExplaining(false);
    }
  }, [query, selectedDealId, dealRecords, refetchRecords, selectedDeal]);

  React.useEffect(() => {
    setExplanation(null);
  }, [selectedDealId]);

  // Auto-explain if query came from URL
  React.useEffect(() => {
    if (queryFromUrl && selectedDealId && !explanation) {
      const queryMap = {
        'stress_mode': 'Explain why stress mode is active',
        'blocked': 'Why is the deal blocked?',
        'ltv': 'Explain the LTV calculation',
        'dscr': 'Explain the DSCR covenant'
      };
      handleExplain(queryMap[queryFromUrl] || queryFromUrl);
    }
  }, [queryFromUrl, selectedDealId, explanation, handleExplain]);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Explain</h1>
        <p className="text-sm text-[#737373] mt-1">
          Ask questions about any deal — get evidence-based, traceable answers
        </p>
      </div>

      {/* Query Interface */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <div className="space-y-4">
          {/* Deal Selector */}
          <div>
            <label className="text-sm font-medium text-[#171717] block mb-2">Select Deal</label>
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger className="border-[#E5E5E5] max-w-md">
                <SelectValue placeholder="Choose a deal to explain" />
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

          {/* Query Input */}
          <div>
            <label className="text-sm font-medium text-[#171717] block mb-2">Your Question</label>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A3A3A3]" />
                <Input 
                  placeholder="e.g., Why is the deal blocked?"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleExplain()}
                  className="pl-10 border-[#E5E5E5]"
                  disabled={!selectedDealId}
                />
              </div>
              <Button 
                onClick={() => handleExplain()}
                disabled={!query.trim() || !selectedDealId || isExplaining}
                className="bg-[#0A0A0A] hover:bg-[#171717]"
              >
                {isExplaining ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    Explain
                    <Send className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Suggested Queries */}
          {selectedDealId && !explanation && (
            <div>
              <span className="text-xs text-[#A3A3A3] uppercase tracking-wider">Suggested Questions</span>
              <div className="flex flex-wrap gap-2 mt-2">
                {suggestedQueries.map((sq, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQuery(sq);
                      handleExplain(sq);
                    }}
                    className="px-3 py-1.5 text-xs bg-[#F5F5F5] hover:bg-[#E5E5E5] text-[#737373] hover:text-[#171717] rounded-full transition-colors"
                  >
                    {sq}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Explanation Result */}
      {explanation && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
          {/* Header */}
          <div className="p-6 border-b border-[#E5E5E5] bg-[#FAFAFA]">
            <div className="flex items-center gap-2">
              <Search className="w-4 h-4 text-[#737373]" />
              <span className="text-sm text-[#737373]">{query}</span>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Direct Answer */}
            <div>
              <h3 className="text-sm font-semibold text-[#171717] mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                Answer
              </h3>
              <p className="text-sm text-[#737373] leading-relaxed">
                {explanation.direct_answer}
              </p>
            </div>

            {/* Evidence */}
            {explanation.evidence_items?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#171717] mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Supporting Evidence
                </h3>
                <div className="space-y-2">
                  {explanation.evidence_items.map((item, i) => (
                    <div key={i} className="p-3 bg-[#FAFAFA] rounded-lg border border-[#E5E5E5]">
                      <p className="text-sm text-[#171717]">{item.description}</p>
                      <div className="flex items-center gap-4 mt-2 text-xs text-[#A3A3A3]">
                        {item.type && (
                          <span className={cn(
                            "px-2 py-0.5 rounded",
                            item.type === 'document_verified' ? 'bg-green-50 text-green-700' :
                            item.type === 'human_attested' ? 'bg-blue-50 text-blue-700' :
                            item.type === 'ai_derived' ? 'bg-violet-50 text-violet-700' :
                            'bg-slate-50 text-slate-700'
                          )}>
                            {item.type?.replace(/_/g, ' ')}
                          </span>
                        )}
                        {item.timestamp && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {item.timestamp}
                          </span>
                        )}
                        {item.source && (
                          <span>{item.source}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Authority Chain */}
            {explanation.authority_chain?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#171717] mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-violet-600" />
                  Authority Chain
                </h3>
                <div className="space-y-2">
                  {explanation.authority_chain.map((auth, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-violet-50 flex items-center justify-center flex-shrink-0">
                        <span className="text-xs font-medium text-violet-700">{auth.role?.[0]}</span>
                      </div>
                      <div className="flex-1">
                        <p className="text-sm text-[#171717]">
                          <span className="font-medium">{auth.role}</span> {auth.action}
                        </p>
                        {auth.timestamp && (
                          <p className="text-xs text-[#A3A3A3]">{auth.timestamp}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Blocking Conditions */}
            {explanation.blocking_conditions?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-[#171717] mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Blocking Conditions
                </h3>
                <div className="space-y-2">
                  {explanation.blocking_conditions.map((condition, i) => (
                    <div key={i} className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                      <span className="text-sm text-amber-800">{condition}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Confidence */}
            {explanation.confidence && (
              <div className="pt-4 border-t border-[#E5E5E5]">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#A3A3A3] uppercase tracking-wider">Confidence</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded text-xs font-medium",
                    explanation.confidence === 'high' ? 'bg-green-50 text-green-700' :
                    explanation.confidence === 'medium' ? 'bg-amber-50 text-amber-700' :
                    'bg-red-50 text-red-700'
                  )}>
                    {explanation.confidence}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 bg-[#FAFAFA] border-t border-[#E5E5E5]">
            <p className="text-xs text-[#A3A3A3]">
              This explanation is generated from the canonical event record. All referenced evidence is traceable.
            </p>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!selectedDealId && (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-12 text-center">
          <MessageSquare className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">Select a deal to begin</h3>
          <p className="text-sm text-[#737373]">
            Choose a deal from the dropdown above to ask questions about it
          </p>
        </div>
      )}
    </div>
  );
}
