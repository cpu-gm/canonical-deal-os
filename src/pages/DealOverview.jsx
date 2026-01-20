import React, { useState, useEffect, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useRole } from '../Layout';
import {
  Building2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Clock,
  DollarSign,
  Percent,
  TrendingUp,
  FileText,
  GitBranch,
  Search,
  Lock,
  ArrowRight,
  Info,
  Shield,
  X,
  XCircle,
  UserPlus,
  Send,
  Bot,
  ClipboardCheck,
  FileOutput,
  Loader2
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import TraceabilityPanel from '@/components/TraceabilityPanel';
import { toast } from "@/components/ui/use-toast";
import FileUploadZone from '@/components/FileUploadZone';
import DraftModeBanner from '@/components/DraftModeBanner';
import DocumentChangeDialog from '@/components/DocumentChangeDialog';
import SmartDocUploadDialog from '@/components/SmartDocUploadDialog';
import {
  humanizeAction,
  humanizeMaterialType,
  humanizeRole,
  humanizeFieldPath,
  formatCurrency,
  humanizeText,
  humanizeBlocker
} from '@/lib/fieldHumanization';
import { canPerform, PERMISSIONS } from '@/lib/permissions';
import AssignAnalystModal from '@/components/AssignAnalystModal';
import RequestReviewModal from '@/components/RequestReviewModal';
import ReviewRequestBanner from '@/components/ReviewRequestBanner';
import SubmitToLenderModal from '@/components/SubmitToLenderModal';
import UnderwritingTab from '@/components/underwriting/UnderwritingTab';
import DealChat from '@/components/chat/DealChat';
import InsightsPanel from '@/components/underwriting/InsightsPanel';
import VerificationQueue from '@/components/verification/VerificationQueue';
import DocumentGenerator from '@/components/documents/DocumentGenerator';
import DealStateMachine from '@/components/dealState/DealStateMachine';
import DealLifecycleHero from '@/components/dealState/DealLifecycleHero';

const lifecycleColors = {
  'Draft': 'bg-slate-100 text-slate-700 border-slate-200',
  'Under Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Approved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Ready to Close': 'bg-blue-50 text-blue-700 border-blue-200',
  'Closed': 'bg-violet-50 text-violet-700 border-violet-200',
  'Operating': 'bg-green-50 text-green-700 border-green-200',
  'Changed': 'bg-orange-50 text-orange-700 border-orange-200',
  'Distressed': 'bg-red-50 text-red-700 border-red-200',
  'Resolved': 'bg-teal-50 text-teal-700 border-teal-200',
  'Exited': 'bg-slate-50 text-slate-600 border-slate-200'
};

const TruthHealthBadge = ({ health }) => {
  if (health === 'healthy') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
        <span className="text-xs font-medium text-green-700">Truth Verified</span>
      </div>
    );
  }
  if (health === 'warning') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
        <span className="text-xs font-medium text-amber-700">Pending Verification</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 border border-red-200 rounded-lg">
      <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
      <span className="text-xs font-medium text-red-700">Issues Detected</span>
    </div>
  );
};

// Processing overlay for critical mutations
function MutationOverlay({ isVisible, message = "Processing..." }) {
  if (!isVisible) return null;

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl shadow-xl p-8 flex flex-col items-center gap-4 max-w-sm mx-4">
        <Loader2 className="w-10 h-10 text-[#0A0A0A] animate-spin" />
        <div className="text-center">
          <p className="text-lg font-semibold text-[#171717]">{message}</p>
          <p className="text-sm text-[#737373] mt-1">Please wait while we process your request</p>
        </div>
      </div>
    </div>
  );
}

export default function DealOverviewPage() {
  const { currentRole } = useRole();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const dealId = urlParams.get('id');
  const [traceField, setTraceField] = useState(null);
  const [artifactSelections, setArtifactSelections] = useState({});
  const [uploadingTask, setUploadingTask] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState({});
  const [showDocumentChangeDialog, setShowDocumentChangeDialog] = useState(false);
  const [showSmartUploadDialog, setShowSmartUploadDialog] = useState(false);
  const [showAssignAnalystModal, setShowAssignAnalystModal] = useState(false);
  const [showRequestReviewModal, setShowRequestReviewModal] = useState(false);
  const [showSubmitToLenderModal, setShowSubmitToLenderModal] = useState(false);
  const [showUnderwriting, setShowUnderwriting] = useState(false);
  const [showAIChat, setShowAIChat] = useState(false);
  const [showStateMachine, setShowStateMachine] = useState(false);
  const [showVerificationQueue, setShowVerificationQueue] = useState(false);
  const [showDocGenerator, setShowDocGenerator] = useState(false);

  const { data: home, isLoading } = useQuery({
    queryKey: ['deal-home', dealId],
    queryFn: () => bff.deals.home(dealId),
    enabled: !!dealId
  });

  const { data: dataTrust } = useQuery({
    queryKey: ['deal-data-trust', dealId],
    queryFn: () => bff.deals.dataTrust(dealId),
    enabled: !!dealId
  });

  const { data: records } = useQuery({
    queryKey: ['deal-records', dealId],
    queryFn: () => bff.deals.records(dealId),
    enabled: !!dealId
  });

  // Query for input provenance to color-code metrics
  const { data: inputProvenance } = useQuery({
    queryKey: ['deal-input-provenance', dealId],
    queryFn: () => bff.inputs.getInputProvenance(dealId),
    enabled: !!dealId
  });

  // Query for pending review request (for GP to see banner)
  const { data: pendingReview } = useQuery({
    queryKey: ['deal-pending-review', dealId],
    queryFn: () => bff.deals.reviewRequests.getPending(dealId),
    enabled: !!dealId
  });

  // Query for deal state blockers (for action required banner)
  const { data: blockersData } = useQuery({
    queryKey: ['dealStateBlockers', dealId],
    queryFn: () => bff.dealState.getBlockers(dealId),
    enabled: !!dealId
  });
  const stateBlockers = blockersData?.blockers || [];

  const deal = home?.deal ?? null;
  const events = home?.events ?? [];
  const authorities = home?.authorities ?? [];
  const covenants = home?.covenants ?? [];
  const evidence = home?.evidence ?? null;
  const profile = deal?.profile ?? {};
  const artifacts = records?.evidence_index?.artifacts ?? [];

  // Helper to get provenance type for a field (DOC, AI, HUMAN)
  const getFieldProvenance = (fieldPath) => {
    if (!inputProvenance?.fields) return null;
    // Try both with and without profile. prefix
    const fieldData = inputProvenance.fields[fieldPath] || inputProvenance.fields[`profile.${fieldPath}`];
    if (!fieldData) return null;

    // Map sourceType to display type
    const sourceTypeMap = {
      'AI_EXTRACTION': 'AI',
      'HUMAN_ENTRY': 'HUMAN',
      'CALCULATION': 'CALC',
      'EXCEL_IMPORT': 'DOC',
      'DOCUMENT': 'DOC'
    };
    return {
      type: sourceTypeMap[fieldData.sourceType] || 'AI',
      verified: fieldData.verified,
      source: fieldData.source,
      documentName: fieldData.documentName
    };
  };

  const updateArtifactSelection = (fieldPath, artifactId) => {
    setArtifactSelections((prev) => ({
      ...prev,
      [fieldPath]: artifactId
    }));
  };

  const [actionBlockedExplain, setActionBlockedExplain] = useState(null);

  const primaryActionType = deal?.next_action_type ?? null;

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!primaryActionType) {
        throw new Error("No primary action available");
      }
      return bff.deals.action(dealId, primaryActionType);
    },
    onSuccess: () => {
      setActionBlockedExplain(null);
      queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      toast({
        title: "Action recorded",
        description: "Kernel event appended successfully."
      });
    },
    onError: (error) => {
      if (error.explain?.reasons?.length) {
        // Store the full explain object for detailed display
        setActionBlockedExplain(error.explain);
        toast({
          title: "Action blocked",
          description: error.explain.reasons[0].message
        });
        return;
      }
      toast({
        title: "Action failed",
        description: error.message || "Request failed",
        variant: "destructive"
      });
    }
  });

  const markDocMutation = useMutation({
    mutationFn: ({ fieldPath, artifactId }) => bff.deals.markDoc(dealId, fieldPath, artifactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });
      queryClient.invalidateQueries({ queryKey: ['inbox', 'data_requests'] });
      toast({
        title: "Evidence linked",
        description: "Field marked as document-backed."
      });
    },
    onError: (error) => {
      toast({
        title: "Evidence update failed",
        description: error.message || "Request failed",
        variant: "destructive"
      });
    }
  });

  const uploadAndMarkMutation = useMutation({
    mutationFn: async ({ file, fieldPath }) => {
      // 1. Upload artifact
      const formData = new FormData();
      formData.append('file', file);

      const artifact = await fetch(`/api/deals/${dealId}/artifacts`, {
        method: 'POST',
        body: formData
      }).then(r => {
        if (!r.ok) throw new Error('Artifact upload failed');
        return r.json();
      });

      // 2. Mark provenance (auto-creates material now!)
      await bff.deals.markDoc(dealId, fieldPath, artifact.id);

      return { artifact, fieldPath };
    },
    onSuccess: ({ fieldPath }) => {
      queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });
      queryClient.invalidateQueries({ queryKey: ['inbox', 'data_requests'] });

      // Clear upload state
      setUploadingTask(null);
      setSelectedFiles(prev => {
        const updated = { ...prev };
        delete updated[fieldPath];
        return updated;
      });

      toast({
        title: "Upload complete",
        description: "File uploaded and marked as evidence."
      });
    },
    onError: (error) => {
      toast({
        title: "Upload failed",
        description: error.message || "Failed to upload and link evidence",
        variant: "destructive"
      });
    }
  });

  // Draft mode queries and mutations
  const { data: draftGates } = useQuery({
    queryKey: ['draft-gates', dealId],
    queryFn: () => bff.deals.draft.gates(dealId),
    enabled: !!dealId && deal?.isDraft === true,
    refetchInterval: false
  });

  const draftCommitMutation = useMutation({
    mutationFn: () => bff.deals.draft.commit(dealId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });
      toast({
        title: "Draft committed",
        description: "All changes have been permanently saved."
      });
    },
    onError: (error) => {
      toast({
        title: "Commit failed",
        description: error.message || "Failed to commit draft",
        variant: "destructive"
      });
    }
  });

  const draftRevertMutation = useMutation({
    mutationFn: () => bff.deals.draft.revert(dealId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });
      queryClient.invalidateQueries({ queryKey: ['draft-gates', dealId] });
      toast({
        title: "Changes reverted",
        description: "All draft changes have been discarded."
      });
    },
    onError: (error) => {
      toast({
        title: "Revert failed",
        description: error.message || "Failed to revert draft",
        variant: "destructive"
      });
    }
  });

  // Combined mutation loading state for overlay
  const mutationState = useMemo(() => {
    if (actionMutation.isPending) return { isLoading: true, message: "Processing action..." };
    if (draftCommitMutation.isPending) return { isLoading: true, message: "Committing draft..." };
    if (draftRevertMutation.isPending) return { isLoading: true, message: "Reverting changes..." };
    if (uploadAndMarkMutation.isPending) return { isLoading: true, message: "Uploading document..." };
    if (markDocMutation.isPending) return { isLoading: true, message: "Linking evidence..." };
    return { isLoading: false, message: "" };
  }, [
    actionMutation.isPending,
    draftCommitMutation.isPending,
    draftRevertMutation.isPending,
    uploadAndMarkMutation.isPending,
    markDocMutation.isPending
  ]);

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-100 rounded w-1/3"></div>
          <div className="h-32 bg-slate-100 rounded"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-100 rounded"></div>)}
          </div>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-12 text-center">
          <Building2 className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">Deal not found</h3>
          <Link to={createPageUrl('Deals')} className="text-sm text-blue-600 hover:underline">
            Return to Deals
          </Link>
        </div>
      </div>
    );
  }

  const blockedBy = deal.blocked_by;

  const roleActionMap = {
    'GP': deal.next_action || 'Complete deal documentation',
    'Lender': 'Review underwriting package',
    'Regulator': 'Audit compliance records',
    'Auditor': 'Verify event trail',
    'LP': 'Review investment summary'
  };

  const primaryActionLabel = deal.next_action || (
    deal.lifecycle_state === 'Draft' ? 'Submit for Review' : 
    deal.lifecycle_state === 'Under Review' ? 'Approve Deal' :
    deal.lifecycle_state === 'Approved' ? 'Attest Ready to Close' :
    deal.lifecycle_state === 'Ready to Close' ? 'Finalize Closing' :
    'View Details'
  );

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Processing Overlay */}
      <MutationOverlay isVisible={mutationState.isLoading} message={mutationState.message} />

      {/* Action Blocked Alert */}
      {actionBlockedExplain && (
        <ActionBlockedAlert
          blockData={actionBlockedExplain}
          onDismiss={() => setActionBlockedExplain(null)}
          dealId={dealId}
          currentRole={currentRole}
        />
      )}

      {/* Draft Mode Banner */}
      <DraftModeBanner
        dealId={dealId}
        isDraft={deal?.isDraft}
        onCommit={() => draftCommitMutation.mutate()}
        onRevert={() => draftRevertMutation.mutate()}
      />

      {/* Review Request Banner - GP only */}
      {currentRole === 'GP' && pendingReview?.request && (
        <ReviewRequestBanner
          request={pendingReview.request}
          dealId={dealId}
          onActionComplete={() => {
            queryClient.invalidateQueries({ queryKey: ['deal-pending-review', dealId] });
            queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
          }}
        />
      )}

      {/* Stress Mode Banner */}
      {deal.stress_mode && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-800">Stress Mode Active</h3>
              <p className="text-sm text-red-700 mt-1">
                Automation reduced. Certain actions require additional approval.
              </p>
              {deal.stress_reason && (
                <p className="text-sm text-red-600 mt-2">
                  Reason: {deal.stress_reason}
                </p>
              )}
              <Link
                to={createPageUrl(`Explain?id=${dealId}&query=stress_mode`)}
                className="inline-flex items-center gap-1 text-sm font-medium text-red-700 hover:text-red-800 mt-2"
              >
                Click to understand why
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">{deal.name}</h1>
              {profile.ai_derived && (
                <span className="text-xs px-2 py-1 bg-violet-50 text-violet-700 rounded font-medium">
                  AI-Derived
                </span>
              )}
            </div>
            <p className="text-sm text-[#737373]">
              {profile.asset_address ? `${profile.asset_address}, ${profile.asset_city}, ${profile.asset_state}` : 'No address specified'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TruthHealthBadge health={deal.truth_health || 'healthy'} />
            <Badge className={cn("font-medium border", lifecycleColors[deal.lifecycle_state] || lifecycleColors['Draft'])}>
              {deal.lifecycle_state || 'Draft'}
            </Badge>
          </div>
        </div>
      </div>

      {/* Action Required Banner - First thing GP sees */}
      {stateBlockers.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-amber-800">
                  Action Required
                </h3>
                <p className="text-sm text-amber-700 mt-1">
                  {stateBlockers[0].reason}
                </p>
                {stateBlockers.length > 1 && (
                  <p className="text-xs text-amber-600 mt-1">
                    +{stateBlockers.length - 1} more issue{stateBlockers.length > 2 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => setShowSmartUploadDialog(true)}
              className="bg-amber-600 hover:bg-amber-700 text-white flex-shrink-0"
            >
              Upload Documents
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Deal Lifecycle Hero - Prominent workflow display */}
      <DealLifecycleHero dealId={dealId} />

      {/* State-First Panel */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[#0A0A0A] flex items-center justify-center">
                <GitBranch className="w-4 h-4 text-white" />
              </div>
              <div>
                <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Current State</span>
                <p className="text-lg font-semibold text-[#171717]">{deal.lifecycle_state || 'Draft'}</p>
              </div>
            </div>

            {blockedBy && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg mb-4">
                <Lock className="w-4 h-4 text-amber-600" />
                <span className="text-sm text-amber-800">
                  <span className="font-medium">Blocked by:</span> {humanizeBlocker(blockedBy)}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-[#A3A3A3]" />
              <span className="text-sm text-[#737373]">Your Role: <span className="font-medium text-[#171717]">{currentRole}</span></span>
            </div>

            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#A3A3A3]" />
              <span className="text-sm text-[#737373]">Next Action: <span className="font-medium text-[#171717]">{roleActionMap[currentRole]}</span></span>
            </div>
          </div>

          <div className="flex flex-col justify-center items-end gap-2">
            {/* Primary action - disabled for GP Analyst (no submit permission) */}
            <Button
              onClick={() => actionMutation.mutate()}
              disabled={
                !primaryActionType ||
                actionMutation.isPending ||
                !canPerform(currentRole, PERMISSIONS.DEAL_SUBMIT)
              }
              className="bg-[#0A0A0A] hover:bg-[#171717] w-full md:w-auto"
              title={!canPerform(currentRole, PERMISSIONS.DEAL_SUBMIT) ? "GP Analysts cannot submit - request review instead" : ""}
            >
              {primaryActionLabel}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>

            {/* Request Review button - GP Analyst only */}
            {currentRole === 'GP Analyst' && (
              <Button
                variant="outline"
                onClick={() => setShowRequestReviewModal(true)}
                className="w-full md:w-auto border-teal-300 text-teal-700 hover:bg-teal-50"
              >
                <Send className="w-4 h-4 mr-2" />
                Request GP Review
              </Button>
            )}

            {/* Submit to Lender button - GP only */}
            {currentRole === 'GP' && (
              <Button
                variant="outline"
                onClick={() => setShowSubmitToLenderModal(true)}
                className="w-full md:w-auto border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Building2 className="w-4 h-4 mr-2" />
                Submit to Lender
              </Button>
            )}

            {/* Assign Analyst button - GP only */}
            {canPerform(currentRole, PERMISSIONS.DEAL_ASSIGN_ANALYST) && (
              <Button
                variant="outline"
                onClick={() => setShowAssignAnalystModal(true)}
                className="w-full md:w-auto"
              >
                <UserPlus className="w-4 h-4 mr-2" />
                Assign Analysts
              </Button>
            )}

            {/* Document Change button - shown in Operating or Changed state */}
            {(deal.lifecycle_state === 'Operating' || deal.lifecycle_state === 'Changed') && (
              <Button
                variant="outline"
                onClick={() => setShowDocumentChangeDialog(true)}
                className="w-full md:w-auto"
              >
                <FileText className="w-4 h-4 mr-2" />
                Document Change
              </Button>
            )}

            {/* GP Analyst info message */}
            {currentRole === 'GP Analyst' && (
              <p className="text-xs text-[#A3A3A3] text-right max-w-[200px]">
                As an analyst, you can edit data and upload documents. Request GP review for approval.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Draft Gates Preview */}
      {deal?.isDraft && draftGates?.gates && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Lifecycle Gates Preview</CardTitle>
            <CardDescription>
              See which actions would be blocked if you commit this draft
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {draftGates.gates.map((gate) => (
                <div
                  key={gate.action}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-lg",
                    gate.isBlocked
                      ? "bg-red-50 border border-red-200"
                      : "bg-green-50 border border-green-200"
                  )}
                >
                  <div className="flex items-center gap-2">
                    {gate.isBlocked ? (
                      <XCircle className="h-4 w-4 text-red-600" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4 text-green-600" />
                    )}
                    <span className="font-medium">
                      {humanizeAction(gate.action)}
                    </span>
                  </div>

                  {gate.isBlocked && gate.reasons && gate.reasons.length > 0 && (
                    <div className="text-sm text-red-600">
                      {gate.reasons.length} blocker{gate.reasons.length > 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Key Metrics */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#171717]">Key Metrics</h3>
              <div className="flex items-center gap-2 text-[10px] text-[#A3A3A3]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400" /> DOC
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-400" /> AI
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Purchase Price"
                value={formatCurrency(profile.purchase_price, { compact: true })}
                icon={DollarSign}
                onClick={() => setTraceField('purchase_price')}
                provenance={getFieldProvenance('purchase_price')}
              />
              <MetricCard
                label="NOI"
                value={formatCurrency(profile.noi, { compact: true })}
                icon={TrendingUp}
                onClick={() => setTraceField('noi')}
                provenance={getFieldProvenance('noi')}
              />
              <MetricCard
                label="LTV"
                value={profile.ltv ? `${(profile.ltv * 100).toFixed(0)}%` : 'N/A'}
                icon={Percent}
                onClick={() => setTraceField('ltv')}
                provenance={getFieldProvenance('ltv')}
                riskLevel={profile.ltv > 0.80 ? 'warning' : profile.ltv > 0.75 ? 'caution' : null}
              />
              <MetricCard
                label="DSCR"
                value={profile.dscr ? profile.dscr.toFixed(2) + 'x' : 'N/A'}
                icon={TrendingUp}
                onClick={() => setTraceField('dscr')}
                provenance={getFieldProvenance('dscr')}
                riskLevel={profile.dscr && profile.dscr < 1.0 ? 'warning' : profile.dscr && profile.dscr < 1.25 ? 'caution' : null}
              />
            </div>
          </div>

          {/* Underwriting Section */}
          <div className="bg-white rounded-xl border border-[#E5E5E5]">
            <button
              onClick={() => setShowUnderwriting(!showUnderwriting)}
              className="w-full flex items-center justify-between p-6 hover:bg-[#FAFAFA] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-emerald-600" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-[#171717]">Underwriting Model</h3>
                  <p className="text-xs text-[#737373]">Financial analysis, scenarios & IC memo</p>
                </div>
              </div>
              <ChevronRight className={cn(
                "w-5 h-5 text-[#A3A3A3] transition-transform",
                showUnderwriting && "rotate-90"
              )} />
            </button>
            {showUnderwriting && (
              <div className="border-t border-[#E5E5E5]">
                <UnderwritingTab dealId={dealId} dealName={deal?.name} />
              </div>
            )}
          </div>

          {/* Deal Lifecycle Details - Advanced section (expandable) */}
          <div className="bg-white rounded-xl border border-[#E5E5E5]">
            <button
              onClick={() => setShowStateMachine(!showStateMachine)}
              className="w-full flex items-center justify-between p-6 hover:bg-[#FAFAFA] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center">
                  <GitBranch className="w-4 h-4 text-indigo-600" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-[#171717]">Lifecycle Details</h3>
                  <p className="text-xs text-[#737373]">Advanced: all transitions, event history, approvals</p>
                </div>
              </div>
              <ChevronRight className={cn(
                "w-5 h-5 text-[#A3A3A3] transition-transform",
                showStateMachine && "rotate-90"
              )} />
            </button>
            {showStateMachine && (
              <div className="border-t border-[#E5E5E5] p-6">
                <DealStateMachine dealId={dealId} />
              </div>
            )}
          </div>

          {/* Verification Queue Section */}
          <div className="bg-white rounded-xl border border-[#E5E5E5]">
            <button
              onClick={() => setShowVerificationQueue(!showVerificationQueue)}
              className="w-full flex items-center justify-between p-6 hover:bg-[#FAFAFA] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center">
                  <ClipboardCheck className="w-4 h-4 text-amber-600" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-[#171717]">Verification Queue</h3>
                  <p className="text-xs text-[#737373]">Review and verify AI-extracted data claims</p>
                </div>
              </div>
              <ChevronRight className={cn(
                "w-5 h-5 text-[#A3A3A3] transition-transform",
                showVerificationQueue && "rotate-90"
              )} />
            </button>
            {showVerificationQueue && (
              <div className="border-t border-[#E5E5E5] p-6">
                <VerificationQueue dealId={dealId} />
              </div>
            )}
          </div>

          {/* Document Generator Section */}
          <div className="bg-white rounded-xl border border-[#E5E5E5]">
            <button
              onClick={() => setShowDocGenerator(!showDocGenerator)}
              className="w-full flex items-center justify-between p-6 hover:bg-[#FAFAFA] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                  <FileOutput className="w-4 h-4 text-blue-600" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-[#171717]">Document Factory</h3>
                  <p className="text-xs text-[#737373]">Generate IC memos, LOIs, and closing packages</p>
                </div>
              </div>
              <ChevronRight className={cn(
                "w-5 h-5 text-[#A3A3A3] transition-transform",
                showDocGenerator && "rotate-90"
              )} />
            </button>
            {showDocGenerator && (
              <div className="border-t border-[#E5E5E5] p-6">
                <DocumentGenerator dealId={dealId} dealName={deal?.name} />
              </div>
            )}
          </div>

          {/* Capital Stack */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Capital Stack</h3>
            <div className="space-y-3">
              <CapitalStackRow 
                label="Senior Debt" 
                value={profile.senior_debt}
                total={profile.purchase_price}
                color="bg-blue-500"
              />
              <CapitalStackRow 
                label="Mezzanine" 
                value={profile.mezzanine_debt}
                total={profile.purchase_price}
                color="bg-violet-500"
              />
              <CapitalStackRow 
                label="Preferred Equity" 
                value={profile.preferred_equity}
                total={profile.purchase_price}
                color="bg-amber-500"
              />
              <CapitalStackRow 
                label="Common Equity" 
                value={profile.common_equity}
                total={profile.purchase_price}
                color="bg-emerald-500"
              />
            </div>
          </div>

          {/* Recent Events */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#171717]">Recent Events</h3>
              <Link 
                to={createPageUrl(`Traceability?id=${dealId}`)}
                className="text-xs text-[#737373] hover:text-[#171717] flex items-center gap-1"
              >
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {events.slice(0, 5).map((event) => (
                <div key={event.id} className="flex items-start gap-3 py-2 border-b border-[#F5F5F5] last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-[#F5F5F5] flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-[#737373]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#171717]">{event.event_title}</p>
                    <p className="text-xs text-[#A3A3A3] mt-0.5">
                      {event.authority_role} - {new Date(event.timestamp || event.created_date).toLocaleDateString()}
                    </p>
                  </div>
                  <EvidenceBadge type={event.evidence_type} />
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-sm text-[#A3A3A3] text-center py-4">No events recorded</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Data Trust */}
          {dataTrust && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <h3 className="text-sm font-semibold text-[#171717] mb-4">Data Trust</h3>
              <div className="space-y-2 text-sm text-[#737373]">
                <div className="flex items-center justify-between">
                  <span>DOC-backed</span>
                  <span className="font-medium text-[#171717]">{dataTrust.docCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Human-verified</span>
                  <span className="font-medium text-[#171717]">{dataTrust.humanCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>AI-derived</span>
                  <span className="font-medium text-[#171717]">{dataTrust.aiCount}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Open tasks</span>
                  <span className="font-medium text-[#171717]">{dataTrust.openTasksCount}</span>
                </div>
              </div>

              {dataTrust.tasks?.length > 0 && (
                <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-[#A3A3A3] uppercase tracking-wider">
                      Open Requests
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowSmartUploadDialog(true)}
                      className="h-7 text-xs text-violet-600 border-violet-200 hover:bg-violet-50 hover:border-violet-300"
                    >
                      <FileText className="w-3 h-3 mr-1" />
                      Smart Upload
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {dataTrust.tasks.map((task) => {
                      const isExpanded = uploadingTask === task.id;
                      const selectedFile = selectedFiles[task.relatedFieldPath];
                      const canUpload = task.relatedFieldPath && task.status === 'OPEN';

                      return (
                        <div
                          key={task.id}
                          className={cn(
                            "p-3 bg-[#FAFAFA] rounded-lg border transition-all",
                            canUpload
                              ? "border-[#E5E5E5] hover:border-blue-400 hover:shadow-md cursor-pointer"
                              : "border-[#E5E5E5]"
                          )}
                          onClick={() => {
                            if (canUpload && !isExpanded) {
                              setUploadingTask(task.id);
                            }
                          }}
                        >
                          <p className="text-sm font-medium text-[#171717]">{humanizeText(task.title)}</p>
                          {task.description && (
                            <p className="text-xs text-[#A3A3A3] mt-1">{humanizeText(task.description)}</p>
                          )}
                          {task.relatedFieldPath && (
                            <p className="text-xs text-[#737373] mt-1">
                              For field: {humanizeFieldPath(task.relatedFieldPath)}
                            </p>
                          )}

                          {/* Inline file upload zone */}
                          {isExpanded && canUpload && (
                            <div className="mt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                              <FileUploadZone
                                onFileSelect={(file) => {
                                  setSelectedFiles(prev => ({
                                    ...prev,
                                    [task.relatedFieldPath]: file
                                  }));
                                }}
                                onClearFile={() => {
                                  setSelectedFiles(prev => {
                                    const updated = { ...prev };
                                    delete updated[task.relatedFieldPath];
                                    return updated;
                                  });
                                }}
                                selectedFile={selectedFile}
                              />

                              {selectedFile && (
                                <div className="flex gap-2">
                                  <Button
                                    onClick={() => {
                                      uploadAndMarkMutation.mutate({
                                        file: selectedFile,
                                        fieldPath: task.relatedFieldPath
                                      });
                                    }}
                                    disabled={uploadAndMarkMutation.isPending}
                                    className="flex-1"
                                    size="sm"
                                  >
                                    {uploadAndMarkMutation.isPending
                                      ? "Uploading..."
                                      : "Upload & Mark as Evidence"
                                    }
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      setUploadingTask(null);
                                      setSelectedFiles(prev => {
                                        const updated = { ...prev };
                                        delete updated[task.relatedFieldPath];
                                        return updated;
                                      });
                                    }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Legacy: Existing artifact dropdown (for when artifacts already uploaded) */}
                          {!isExpanded && task.relatedFieldPath && artifacts.length > 0 && task.status === 'OPEN' && (
                            <div className="mt-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                              <Select
                                value={artifactSelections[task.relatedFieldPath] || ""}
                                onValueChange={(value) =>
                                  updateArtifactSelection(task.relatedFieldPath, value)
                                }
                              >
                                <SelectTrigger className="border-[#E5E5E5] text-xs h-8">
                                  <SelectValue placeholder="Select existing artifact" />
                                </SelectTrigger>
                                <SelectContent>
                                  {artifacts.map((artifact) => (
                                    <SelectItem key={artifact.artifactId} value={artifact.artifactId}>
                                      {artifact.filename || artifact.artifactId}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!artifactSelections[task.relatedFieldPath] || markDocMutation.isPending}
                                onClick={() =>
                                  markDocMutation.mutate({
                                    fieldPath: task.relatedFieldPath,
                                    artifactId: artifactSelections[task.relatedFieldPath]
                                  })
                                }
                              >
                                Mark DOC
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Participants */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Participants</h3>
            <div className="space-y-3">
              {profile.gp_name && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-emerald-700">GP</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#171717]">{profile.gp_name}</p>
                    <p className="text-xs text-[#A3A3A3]">General Partner</p>
                  </div>
                </div>
              )}
              {profile.lender_name && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-blue-700">L</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#171717]">{profile.lender_name}</p>
                    <p className="text-xs text-[#A3A3A3]">Lender</p>
                  </div>
                </div>
              )}
              {authorities.map((auth) => (
                <div key={auth.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-slate-700">{auth.role?.[0] ?? '?'}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#171717]">{auth.entity_name}</p>
                    <p className="text-xs text-[#A3A3A3]">{auth.role}</p>
                  </div>
                  <ConsentBadge status={auth.consent_status} />
                </div>
              ))}
            </div>
          </div>

          {/* Evidence Summary */}
          {evidence && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <h3 className="text-sm font-semibold text-[#171717] mb-4">Evidence Summary</h3>
              <div className="space-y-2 text-sm text-[#737373]">
                <div className="flex items-center justify-between">
                  <span>Total Artifacts</span>
                  <span className="font-medium text-[#171717]">{evidence.total_artifacts}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Last Upload</span>
                  <span className="font-medium text-[#171717]">
                    {evidence.last_uploaded_at
                      ? new Date(evidence.last_uploaded_at).toLocaleString()
                      : 'None'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Covenants */}
          {covenants.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <h3 className="text-sm font-semibold text-[#171717] mb-4">Covenants</h3>
              <div className="space-y-3">
                {covenants.map((covenant) => (
                  <div 
                    key={covenant.id} 
                    className={cn(
                      "p-3 rounded-lg border",
                      covenant.status === 'breach' ? 'bg-red-50 border-red-200' :
                      covenant.status === 'warning' ? 'bg-amber-50 border-amber-200' :
                      'bg-green-50 border-green-200'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{covenant.covenant_type}</span>
                      <span className={cn(
                        "text-xs font-medium",
                        covenant.status === 'breach' ? 'text-red-700' :
                        covenant.status === 'warning' ? 'text-amber-700' :
                        'text-green-700'
                      )}>
                        {covenant.current_value} {covenant.threshold_operator} {covenant.threshold_value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Insights */}
          <InsightsPanel dealId={dealId} />

          {/* AI Chat */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
            <button
              onClick={() => setShowAIChat(!showAIChat)}
              className="w-full flex items-center justify-between p-4 hover:bg-[#FAFAFA] transition-colors"
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-purple-100 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-purple-600" />
                </div>
                <div className="text-left">
                  <h3 className="text-sm font-semibold text-[#171717]">AI Deal Assistant</h3>
                  <p className="text-xs text-[#737373]">Ask questions about this deal</p>
                </div>
              </div>
              <ChevronRight className={cn(
                "w-5 h-5 text-[#A3A3A3] transition-transform",
                showAIChat && "rotate-90"
              )} />
            </button>
            {showAIChat && (
              <div className="border-t border-[#E5E5E5] h-[400px]">
                <DealChat dealId={dealId} dealName={deal?.name} />
              </div>
            )}
          </div>

          {/* Quick Links */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Link 
                to={createPageUrl(`Lifecycle?id=${dealId}`)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#F5F5F5] transition-colors"
              >
                <GitBranch className="w-4 h-4 text-[#737373]" />
                <span className="text-sm text-[#171717]">View Lifecycle</span>
                <ChevronRight className="w-4 h-4 text-[#A3A3A3] ml-auto" />
              </Link>
              <Link 
                to={createPageUrl(`Traceability?id=${dealId}`)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#F5F5F5] transition-colors"
              >
                <Search className="w-4 h-4 text-[#737373]" />
                <span className="text-sm text-[#171717]">Full Traceability</span>
                <ChevronRight className="w-4 h-4 text-[#A3A3A3] ml-auto" />
              </Link>
              <Link 
                to={createPageUrl(`Explain?id=${dealId}`)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#F5F5F5] transition-colors"
              >
                <Info className="w-4 h-4 text-[#737373]" />
                <span className="text-sm text-[#171717]">Explain Any Number</span>
                <ChevronRight className="w-4 h-4 text-[#A3A3A3] ml-auto" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Traceability Panel */}
      {traceField && (
        <TraceabilityPanel
          deal={deal}
          field={traceField}
          events={events}
          onClose={() => setTraceField(null)}
        />
      )}

      {/* Document Change Dialog */}
      <DocumentChangeDialog
        open={showDocumentChangeDialog}
        onOpenChange={setShowDocumentChangeDialog}
        dealId={dealId}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
          toast({
            title: "Change documented",
            description: "LEGAL has been notified for approval."
          });
        }}
      />

      {/* Smart Document Upload Dialog */}
      <SmartDocUploadDialog
        open={showSmartUploadDialog}
        onOpenChange={setShowSmartUploadDialog}
        dealId={dealId}
        missingFields={dataTrust?.tasks?.filter(t => t.status === 'OPEN' && t.relatedFieldPath)?.map(t => ({
          fieldPath: t.relatedFieldPath,
          title: t.title
        })) || []}
        currentProfile={profile}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
          queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
          queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });
          setShowSmartUploadDialog(false);
        }}
      />

      {/* Assign Analyst Modal - GP only */}
      <AssignAnalystModal
        dealId={dealId}
        dealName={deal?.name}
        isOpen={showAssignAnalystModal}
        onClose={() => setShowAssignAnalystModal(false)}
      />

      {/* Request Review Modal - GP Analyst only */}
      <RequestReviewModal
        dealId={dealId}
        dealName={deal?.name}
        isOpen={showRequestReviewModal}
        onClose={() => setShowRequestReviewModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['deal-pending-review', dealId] });
        }}
      />

      {/* Submit to Lender Modal - GP only */}
      <SubmitToLenderModal
        dealId={dealId}
        dealName={deal?.name}
        isOpen={showSubmitToLenderModal}
        onClose={() => setShowSubmitToLenderModal(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['deal-submissions', dealId] });
        }}
      />
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, onClick, provenance, riskLevel }) {
  // Color based on provenance: DOC = green, HUMAN = blue, AI/default = amber
  const borderColor = provenance?.type === 'DOC'
    ? 'border-green-300'
    : provenance?.type === 'HUMAN'
      ? 'border-blue-300'
      : provenance?.type === 'AI'
        ? 'border-amber-300'
        : 'border-transparent';

  const provenanceLabel = provenance?.type === 'DOC'
    ? { text: 'DOC-BACKED', color: 'text-green-600' }
    : provenance?.type === 'HUMAN'
      ? { text: 'VERIFIED', color: 'text-blue-600' }
      : provenance?.type === 'AI'
        ? { text: 'AI-DERIVED', color: 'text-amber-600' }
        : null;

  // Risk level tooltips
  const riskTooltip = riskLevel === 'warning'
    ? 'Outside normal range'
    : riskLevel === 'caution'
      ? 'Below typical threshold'
      : null;

  return (
    <button
      onClick={onClick}
      className={cn(
        "p-4 rounded-lg bg-[#FAFAFA] hover:bg-[#F5F5F5] transition-colors text-left group border-2",
        borderColor
      )}
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 text-[#A3A3A3]" />
        <div className="flex items-center gap-1">
          {riskLevel === 'warning' && (
            <AlertTriangle className="w-3 h-3 text-red-500" title={riskTooltip} />
          )}
          {riskLevel === 'caution' && (
            <AlertTriangle className="w-3 h-3 text-amber-500" title={riskTooltip} />
          )}
          {provenanceLabel && (
            <span className={cn("text-[9px] font-medium", provenanceLabel.color)}>
              {provenanceLabel.text}
            </span>
          )}
          <Search className="w-3 h-3 text-[#A3A3A3] opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
      <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">{label}</span>
      <p className="text-lg font-semibold text-[#171717] mt-0.5">{value}</p>
    </button>
  );
}

function CapitalStackRow({ label, value, total, color }) {
  const percentage = total && value ? (value / total) * 100 : 0;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[#737373]">{label}</span>
        <span className="text-sm font-medium text-[#171717]">
          {value ? `$${(value / 1000000).toFixed(1)}M` : 'N/A'}
        </span>
      </div>
      <div className="h-2 bg-[#F5F5F5] rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function EvidenceBadge({ type }) {
  const config = {
    'document_verified': { label: 'Doc', className: 'bg-green-50 text-green-700' },
    'human_attested': { label: 'Human', className: 'bg-blue-50 text-blue-700' },
    'ai_derived': { label: 'AI', className: 'bg-violet-50 text-violet-700' },
    'system_computed': { label: 'System', className: 'bg-slate-50 text-slate-700' }
  };
  
  const { label, className } = config[type] || config['system_computed'];
  
  return (
    <span className={cn("text-[10px] px-2 py-0.5 rounded font-medium", className)}>
      {label}
    </span>
  );
}

function ConsentBadge({ status }) {
  if (status === 'approved') {
    return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  }
  if (status === 'rejected') {
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  }
  return <Clock className="w-4 h-4 text-amber-500" />;
}

function ActionBlockedAlert({ blockData, onDismiss, dealId, currentRole }) {
  const [showOverride, setShowOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [isOverriding, setIsOverriding] = useState(false);
  const queryClient = useQueryClient();
  const dismissButtonRef = React.useRef(null);

  // Reset override state when blockData changes
  useEffect(() => {
    setShowOverride(false);
    setOverrideReason('');
  }, [blockData]);

  // Attach click handler via DOM directly as a fallback
  useEffect(() => {
    const button = dismissButtonRef.current;
    if (button) {
      const handleClick = (e) => {
        console.log("DOM click handler fired!");
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      };
      button.addEventListener('click', handleClick, true);
      return () => button.removeEventListener('click', handleClick, true);
    }
  }, [onDismiss]);

  // Check if current user can override
  const canOverride = blockData.nextSteps?.some(step =>
    step.canBeOverriddenByRoles?.includes(currentRole)
  );

  const handleOverride = async () => {
    if (!overrideReason.trim()) {
      toast({
        title: "Reason required",
        description: "Please provide a reason for the override",
        variant: "destructive"
      });
      return;
    }

    setIsOverriding(true);
    try {
      await bff.deals.override(dealId, blockData.action, overrideReason);

      // Refresh deal data
      await queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      await queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });

      toast({
        title: "Override successful!",
        description: `All requirements bypassed for ${humanizeAction(blockData.action)}. The action should now be unblocked.`,
        duration: 5000
      });

      // Dismiss the alert - the action should now be unblocked
      onDismiss();
    } catch (error) {
      toast({
        title: "Override failed",
        description: error.message || "Failed to override action requirements",
        variant: "destructive"
      });
    } finally {
      setIsOverriding(false);
    }
  };

  return (
    <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
      {/* Header row with title and X button - using flexbox instead of absolute */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
          <h3 className="font-semibold text-red-800">
            Action Blocked: {humanizeAction(blockData.action)}
          </h3>
        </div>
        <button
          ref={dismissButtonRef}
          type="button"
          onClick={(e) => {
            console.log("React onClick fired!");
            e.preventDefault();
            e.stopPropagation();
            onDismiss();
          }}
          className="flex-shrink-0 p-2 hover:bg-red-100 rounded transition-colors cursor-pointer bg-red-100 border border-red-200"
          aria-label="Dismiss alert"
        >
          <X className="h-4 w-4 text-red-800" />
        </button>
      </div>

      <div className="space-y-4 text-red-900">
        {/* Reasons */}
        <div>
          <p className="font-medium mb-2 text-sm">Reasons:</p>
          <ul className="list-disc pl-5 space-y-2">
            {blockData.reasons?.map((reason, i) => (
              <li key={i} className="text-sm">
                {reason.type === "APPROVAL_THRESHOLD" && (
                  <div className="space-y-1">
                    <p>{reason.message}</p>
                    {(reason.threshold || reason.rolesAllowed || reason.currentCount !== undefined) && (
                      <div className="text-xs text-red-700 bg-red-50 p-2 rounded mt-1">
                        {reason.threshold !== undefined && (
                          <p>
                            <span className="font-medium">Required:</span>{" "}
                            {reason.threshold} {reason.threshold === 1 ? "approval" : "approvals"}
                            {reason.rolesAllowed?.length > 0 && (
                              <span> from {reason.rolesAllowed.map(r => humanizeRole(r)).join(", ")}</span>
                            )}
                          </p>
                        )}
                        {reason.currentCount !== undefined && (
                          <p>
                            <span className="font-medium">Current:</span>{" "}
                            {reason.currentCount} {reason.currentCount === 1 ? "approval" : "approvals"}
                          </p>
                        )}
                        {reason.satisfiedByRole && Object.keys(reason.satisfiedByRole).length > 0 && (
                          <p>
                            <span className="font-medium">By role:</span>{" "}
                            {Object.entries(reason.satisfiedByRole)
                              .map(([role, count]) => `${humanizeRole(role)}: ${count}`)
                              .join(", ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {reason.type === "MISSING_MATERIAL" && (
                  <div className="space-y-1">
                    <p>
                      Missing material: <span className="font-medium">{humanizeMaterialType(reason.materialType)}</span>
                    </p>
                    <p className="text-xs text-red-700 bg-red-50 p-2 rounded mt-1">
                      <span className="font-medium">Required truth level:</span> {reason.requiredTruth}
                      {reason.currentTruth && (
                        <span> (Current: {reason.currentTruth})</span>
                      )}
                    </p>
                  </div>
                )}
                {reason.type === "INSUFFICIENT_TRUTH" && (
                  <div className="space-y-1">
                    <p>{reason.message}</p>
                    <p className="text-xs text-red-700 bg-red-50 p-2 rounded mt-1">
                      Material <span className="font-medium">{humanizeMaterialType(reason.materialType)}</span> exists
                      but truth level is insufficient (Current: {reason.currentTruth}, Required: {reason.requiredTruth})
                    </p>
                  </div>
                )}
                {!["APPROVAL_THRESHOLD", "MISSING_MATERIAL", "INSUFFICIENT_TRUTH"].includes(reason.type) && (
                  <p>{reason.message}</p>
                )}
              </li>
            ))}
          </ul>
        </div>

        {/* Next Steps */}
        {blockData.nextSteps?.length > 0 && (
          <div>
            <p className="font-medium mb-2 text-sm">Next Steps:</p>
            <ul className="list-disc pl-5 space-y-1">
              {blockData.nextSteps.map((step, i) => (
                <li key={i} className="text-sm">
                  {step.description}
                  {step.canBeFixedByRoles?.length > 0 && (
                    <span className="text-red-700">
                      {" "}(Can be fixed by: {step.canBeFixedByRoles.map(r => humanizeRole(r)).join(", ")})
                    </span>
                  )}
                  {step.canBeOverriddenByRoles?.length > 0 && (
                    <span className="text-red-700 block text-xs mt-0.5">
                      Or overridden by: {step.canBeOverriddenByRoles.map(r => humanizeRole(r)).join(", ")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Override Section */}
        {canOverride && (
          <div className="mt-4 pt-4 border-t border-red-200">
            {!showOverride ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowOverride(true)}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                Override Requirements
              </Button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium">Override Reason:</p>
                <Textarea
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="Explain why you're overriding these requirements..."
                  className="min-h-[80px] text-sm"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={handleOverride}
                    disabled={isOverriding || !overrideReason.trim()}
                    className="bg-red-600 hover:bg-red-700"
                  >
                    {isOverriding ? "Overriding..." : "Confirm Override"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setShowOverride(false);
                      setOverrideReason('');
                    }}
                    disabled={isOverriding}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Dismiss button at bottom - always visible */}
        <div className="mt-4 pt-3 border-t border-red-200 flex justify-between items-center">
          <span className="text-xs text-red-600">Click dismiss to close this alert</span>
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log("Dismiss button clicked");
              onDismiss();
            }}
            className="border-red-300 text-red-700 hover:text-red-900 hover:bg-red-100 font-medium"
          >
            Dismiss Alert
          </Button>
        </div>
      </div>
    </div>
  );
}
