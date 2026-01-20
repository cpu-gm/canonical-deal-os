import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
import {
  ArrowRight,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
  XCircle,
  PauseCircle
} from 'lucide-react';
import StateProgressBar from './StateProgressBar';
import TransitionCard from './TransitionCard';
import BlockerList from './BlockerList';
import EventHistory from './EventHistory';

// User-friendly state names for GP understanding
const STATE_DISPLAY = {
  INTAKE_RECEIVED: { label: 'Submitted', color: 'gray', icon: Clock },
  DATA_ROOM_INGESTED: { label: 'Docs Ready', color: 'blue', icon: CheckCircle2 },
  EXTRACTION_COMPLETE: { label: 'Analyzing', color: 'blue', icon: CheckCircle2 },
  UNDERWRITING_DRAFT: { label: 'Underwriting', color: 'amber', icon: Clock },
  IC_READY: { label: 'Committee Review', color: 'violet', icon: CheckCircle2 },
  LOI_DRAFT: { label: 'Drafting Offer', color: 'amber', icon: Clock },
  LOI_SENT: { label: 'Offer Sent', color: 'blue', icon: ArrowRight },
  LOI_ACCEPTED: { label: 'Offer Accepted', color: 'green', icon: CheckCircle2 },
  PSA_DRAFT: { label: 'Drafting Contract', color: 'amber', icon: Clock },
  PSA_EXECUTED: { label: 'Contract Signed', color: 'green', icon: CheckCircle2 },
  DD_ACTIVE: { label: 'Due Diligence', color: 'blue', icon: Clock },
  DD_COMPLETE: { label: 'Diligence Complete', color: 'green', icon: CheckCircle2 },
  FINANCING_IN_PROGRESS: { label: 'Securing Financing', color: 'blue', icon: Clock },
  FINANCING_COMMITTED: { label: 'Financing Secured', color: 'green', icon: CheckCircle2 },
  CLEAR_TO_CLOSE: { label: 'Ready to Close', color: 'violet', icon: CheckCircle2 },
  CLOSED: { label: 'Closed', color: 'green', icon: CheckCircle2 },
  DEAD: { label: 'Deal Lost', color: 'red', icon: XCircle },
  ON_HOLD: { label: 'Paused', color: 'gray', icon: PauseCircle }
};

const COLOR_CLASSES = {
  gray: 'bg-gray-100 text-gray-700 border-gray-200',
  blue: 'bg-blue-100 text-blue-700 border-blue-200',
  amber: 'bg-amber-100 text-amber-700 border-amber-200',
  green: 'bg-green-100 text-green-700 border-green-200',
  violet: 'bg-violet-100 text-violet-700 border-violet-200',
  red: 'bg-red-100 text-red-700 border-red-200'
};

export default function DealStateMachine({ dealId }) {
  const queryClient = useQueryClient();
  const [transitionDialog, setTransitionDialog] = useState(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [selectedApprovals, setSelectedApprovals] = useState([]);

  // Fetch current state
  const { data: stateData, isLoading: loadingState } = useQuery({
    queryKey: ['dealState', dealId],
    queryFn: () => bff.dealState.getState(dealId)
  });

  // Fetch available transitions
  const { data: transitionsData, isLoading: loadingTransitions } = useQuery({
    queryKey: ['dealStateTransitions', dealId],
    queryFn: () => bff.dealState.getTransitions(dealId)
  });

  // Fetch blockers
  const { data: blockersData } = useQuery({
    queryKey: ['dealStateBlockers', dealId],
    queryFn: () => bff.dealState.getBlockers(dealId)
  });

  // Fetch recent events
  const { data: eventsData } = useQuery({
    queryKey: ['dealStateEvents', dealId],
    queryFn: () => bff.dealState.getEvents(dealId, { limit: 10 })
  });

  // Transition mutation
  const transitionMutation = useMutation({
    mutationFn: ({ toState, reason, approvals }) =>
      bff.dealState.transition(dealId, { toState, reason, approvals }),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['dealState', dealId]);
      queryClient.invalidateQueries(['dealStateTransitions', dealId]);
      queryClient.invalidateQueries(['dealStateBlockers', dealId]);
      queryClient.invalidateQueries(['dealStateEvents', dealId]);
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
  const stateInfo = STATE_DISPLAY[currentState] || { label: currentState, color: 'gray', icon: Clock };
  const StateIcon = stateInfo.icon;
  const transitions = transitionsData?.transitions || [];
  const blockers = blockersData?.blockers || [];
  const events = eventsData?.events || [];

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
      <div className="space-y-4">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const enteredAt = stateData?.state?.enteredStateAt
    ? new Date(stateData.state.enteredStateAt)
    : null;

  const timeInState = enteredAt
    ? formatTimeAgo(enteredAt)
    : 'Unknown';

  return (
    <div className="space-y-6">
      {/* Progress Bar */}
      <StateProgressBar currentState={currentState} />

      {/* Current State Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-12 h-12 rounded-xl flex items-center justify-center",
                stateInfo.color === 'green' && "bg-green-100",
                stateInfo.color === 'blue' && "bg-blue-100",
                stateInfo.color === 'amber' && "bg-amber-100",
                stateInfo.color === 'violet' && "bg-violet-100",
                stateInfo.color === 'gray' && "bg-gray-100",
                stateInfo.color === 'red' && "bg-red-100"
              )}>
                <StateIcon className={cn(
                  "w-6 h-6",
                  stateInfo.color === 'green' && "text-green-600",
                  stateInfo.color === 'blue' && "text-blue-600",
                  stateInfo.color === 'amber' && "text-amber-600",
                  stateInfo.color === 'violet' && "text-violet-600",
                  stateInfo.color === 'gray' && "text-gray-600",
                  stateInfo.color === 'red' && "text-red-600"
                )} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[#171717]">
                  {stateInfo.label}
                </h3>
                <p className="text-sm text-[#737373]">
                  {enteredAt && (
                    <>
                      Entered {enteredAt.toLocaleDateString()} at {enteredAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      <span className="mx-2">•</span>
                    </>
                  )}
                  {timeInState}
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={cn("text-sm px-3 py-1", COLOR_CLASSES[stateInfo.color])}
            >
              {stateInfo.label}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Blockers (if any) */}
      {blockers.length > 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Blockers Preventing Transition
            </CardTitle>
          </CardHeader>
          <CardContent>
            <BlockerList blockers={blockers} />
          </CardContent>
        </Card>
      )}

      {/* Available Transitions */}
      {transitions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Available Transitions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {transitions.map(transition => (
                <TransitionCard
                  key={transition.targetState}
                  transition={transition}
                  stateDisplay={STATE_DISPLAY}
                  onTransition={() => handleTransitionClick(transition)}
                  isPending={transitionMutation.isPending}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <EventHistory events={events} stateDisplay={STATE_DISPLAY} />
          </CardContent>
        </Card>
      )}

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
    </div>
  );
}

function formatTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  return date.toLocaleDateString();
}
