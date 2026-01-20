import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { ArrowRight, AlertTriangle, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import StateProgressBar from './StateProgressBar';
import BlockerList from './BlockerList';

// User-friendly state names for GP understanding
const STATE_DISPLAY = {
  INTAKE_RECEIVED: { label: 'Submitted', color: 'gray' },
  DATA_ROOM_INGESTED: { label: 'Docs Ready', color: 'blue' },
  EXTRACTION_COMPLETE: { label: 'Analyzing', color: 'blue' },
  UNDERWRITING_DRAFT: { label: 'Underwriting', color: 'amber' },
  IC_READY: { label: 'Committee Review', color: 'violet' },
  LOI_DRAFT: { label: 'Drafting Offer', color: 'amber' },
  LOI_SENT: { label: 'Offer Sent', color: 'blue' },
  LOI_ACCEPTED: { label: 'Offer Accepted', color: 'green' },
  PSA_DRAFT: { label: 'Drafting Contract', color: 'amber' },
  PSA_EXECUTED: { label: 'Contract Signed', color: 'green' },
  DD_ACTIVE: { label: 'Due Diligence', color: 'blue' },
  DD_COMPLETE: { label: 'Diligence Complete', color: 'green' },
  FINANCING_IN_PROGRESS: { label: 'Securing Financing', color: 'blue' },
  FINANCING_COMMITTED: { label: 'Financing Secured', color: 'green' },
  CLEAR_TO_CLOSE: { label: 'Ready to Close', color: 'violet' },
  CLOSED: { label: 'Closed', color: 'green' },
  DEAD: { label: 'Deal Lost', color: 'red' },
  ON_HOLD: { label: 'Paused', color: 'gray' }
};

const COLOR_CLASSES = {
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  violet: 'bg-violet-100 text-violet-700 border-violet-200',
  red: 'bg-red-100 text-red-700 border-red-200'
};

export default function DealLifecycleHero({ dealId, onNavigate }) {
  const queryClient = useQueryClient();
  const [showBlockers, setShowBlockers] = useState(false);
  const [transitionDialog, setTransitionDialog] = useState(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [selectedApprovals, setSelectedApprovals] = useState([]);

  const { data: stateData, isLoading: loadingState } = useQuery({
    queryKey: ['dealState', dealId],
    queryFn: () => bff.dealState.getState(dealId),
    enabled: !!dealId
  });

  const { data: transitionsData, isLoading: loadingTransitions } = useQuery({
    queryKey: ['dealStateTransitions', dealId],
    queryFn: () => bff.dealState.getTransitions(dealId),
    enabled: !!dealId
  });

  const { data: blockersData } = useQuery({
    queryKey: ['dealStateBlockers', dealId],
    queryFn: () => bff.dealState.getBlockers(dealId),
    enabled: !!dealId
  });

  const transitionMutation = useMutation({
    mutationFn: ({ toState, reason, approvals }) =>
      bff.dealState.transition(dealId, { toState, reason, approvals }),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['dealState', dealId]);
      queryClient.invalidateQueries(['dealStateTransitions', dealId]);
      queryClient.invalidateQueries(['dealStateBlockers', dealId]);
      queryClient.invalidateQueries(['dealStateEvents', dealId]);
      queryClient.invalidateQueries(['deal-home', dealId]);
      toast({
        title: 'State Transitioned',
        description: `Deal moved to ${STATE_DISPLAY[data.newState]?.label || data.newState}`
      });
      setTransitionDialog(null);
      setTransitionReason('');
      setSelectedApprovals([]);
    },
    onError: (error) => {
      toast({
        title: 'Transition Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const currentState = stateData?.state?.currentState || 'INTAKE_RECEIVED';
  const stateInfo = STATE_DISPLAY[currentState] || { label: currentState, color: 'gray' };
  const transitions = transitionsData?.transitions || [];
  const blockers = blockersData?.blockers || [];

  // Find primary forward transition (not ON_HOLD or DEAD)
  const primaryTransition = transitions.find(t =>
    t.canTransition && !['ON_HOLD', 'DEAD'].includes(t.targetState)
  );

  // Also show blocked transitions so user knows what's next
  const blockedTransitions = transitions.filter(t =>
    !t.canTransition && !['ON_HOLD', 'DEAD'].includes(t.targetState)
  );

  const enteredAt = stateData?.state?.enteredStateAt
    ? new Date(stateData.state.enteredStateAt)
    : null;

  const handleTransitionClick = (transition) => {
    if (transition.canTransition) {
      setTransitionDialog(transition);
      setSelectedApprovals([]);
      setTransitionReason('');
    }
  };

  const handleConfirmTransition = () => {
    const approvals = selectedApprovals.map(role => ({
      role,
      approved: true
    }));

    transitionMutation.mutate({
      toState: transitionDialog.targetState,
      reason: transitionReason || undefined,
      approvals: approvals.length > 0 ? approvals : undefined
    });
  };

  const toggleApproval = (role) => {
    setSelectedApprovals(prev =>
      prev.includes(role)
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  if (loadingState || loadingTransitions) {
    return (
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <div className="animate-pulse">
          <div className="h-16 bg-gray-100 rounded mb-4" />
          <div className="flex justify-between items-center">
            <div className="h-8 w-32 bg-gray-100 rounded" />
            <div className="h-10 w-40 bg-gray-100 rounded" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        {/* Progress Bar */}
        <StateProgressBar currentState={currentState} />

        {/* Current State + Next Action */}
        <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#E5E5E5]">
          <div className="flex items-center gap-4 flex-wrap">
            <Badge
              variant="outline"
              className={cn("text-sm px-3 py-1", COLOR_CLASSES[stateInfo.color])}
            >
              {stateInfo.label}
            </Badge>
            {enteredAt && (
              <span className="text-sm text-[#737373]">
                {formatTimeAgo(enteredAt)}
              </span>
            )}
            {blockers.length > 0 && (
              <button
                onClick={() => setShowBlockers(!showBlockers)}
                className="flex items-center gap-1 text-sm text-amber-600 hover:text-amber-700 transition-colors"
              >
                <AlertTriangle className="w-4 h-4" />
                {blockers.length} blocker{blockers.length > 1 ? 's' : ''}
                {showBlockers ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {primaryTransition && (
              <Button onClick={() => handleTransitionClick(primaryTransition)}>
                {STATE_DISPLAY[primaryTransition.targetState]?.label || primaryTransition.targetState}
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            )}
            {!primaryTransition && blockedTransitions.length > 0 && (
              <Button variant="outline" disabled className="text-[#737373]">
                Next: {STATE_DISPLAY[blockedTransitions[0].targetState]?.label || blockedTransitions[0].targetState}
                <AlertTriangle className="w-4 h-4 ml-2 text-amber-500" />
              </Button>
            )}
          </div>
        </div>

        {/* Expanded Blockers */}
        {showBlockers && blockers.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[#E5E5E5]">
            <BlockerList blockers={blockers} onNavigate={onNavigate} />
          </div>
        )}
      </div>

      {/* Transition Confirmation Dialog */}
      <Dialog open={!!transitionDialog} onOpenChange={() => setTransitionDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Transition to {STATE_DISPLAY[transitionDialog?.targetState]?.label || transitionDialog?.targetState}
            </DialogTitle>
            <DialogDescription>
              Confirm this state transition for the deal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Required Approvals */}
            {transitionDialog?.requiredApprovals?.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-[#171717] mb-3">
                  Required Approvals
                </h4>
                <div className="space-y-2">
                  {transitionDialog.requiredApprovals.map(role => (
                    <div key={role} className="flex items-center gap-2">
                      <Checkbox
                        id={`approval-${role}`}
                        checked={selectedApprovals.includes(role)}
                        onCheckedChange={() => toggleApproval(role)}
                      />
                      <label
                        htmlFor={`approval-${role}`}
                        className="text-sm text-[#171717] cursor-pointer"
                      >
                        {role.replace('_', ' ')}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reason */}
            <div>
              <label className="text-sm font-medium text-[#171717] mb-2 block">
                Reason (optional)
              </label>
              <Textarea
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
                placeholder="Why is this transition happening?"
                className="resize-none"
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTransitionDialog(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmTransition}
              disabled={transitionMutation.isPending}
            >
              {transitionMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <ArrowRight className="w-4 h-4 mr-2" />
              )}
              Confirm Transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Entered just now';
  if (diffMins < 60) return `Entered ${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `Entered ${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays === 1) return 'Entered yesterday';
  if (diffDays < 30) return `Entered ${diffDays} days ago`;
  return `Entered ${date.toLocaleDateString()}`;
}
