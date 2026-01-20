import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Shield,
  FileText,
  Loader2
} from 'lucide-react';

export default function TransitionCard({ transition, stateDisplay, onTransition, isPending }) {
  const [showBlockers, setShowBlockers] = useState(false);

  const targetInfo = stateDisplay[transition.targetState] || {
    label: transition.targetState,
    color: 'gray'
  };

  const hasBlockers = transition.blockers?.length > 0;
  const hasRequiredApprovals = transition.requiredApprovals?.length > 0;
  const hasRequiredDocs = transition.requiredDocuments?.length > 0;
  const canTransition = transition.canTransition;

  const colorClasses = {
    gray: 'border-gray-200 hover:border-gray-300',
    blue: 'border-blue-200 hover:border-blue-300',
    amber: 'border-amber-200 hover:border-amber-300',
    green: 'border-green-200 hover:border-green-300',
    violet: 'border-violet-200 hover:border-violet-300',
    red: 'border-red-200 hover:border-red-300'
  };

  const bgClasses = {
    gray: 'bg-gray-50',
    blue: 'bg-blue-50',
    amber: 'bg-amber-50',
    green: 'bg-green-50',
    violet: 'bg-violet-50',
    red: 'bg-red-50'
  };

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4 transition-all",
        colorClasses[targetInfo.color],
        canTransition && "cursor-pointer hover:shadow-md",
        !canTransition && "opacity-75"
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <h4 className="font-medium text-[#171717]">{targetInfo.label}</h4>
          <p className="text-xs text-[#737373] mt-0.5">{transition.targetState}</p>
        </div>
        {canTransition ? (
          <CheckCircle2 className="w-5 h-5 text-green-500" />
        ) : (
          <AlertTriangle className="w-5 h-5 text-amber-500" />
        )}
      </div>

      {/* Requirements */}
      <div className="space-y-2 mb-3">
        {/* Required Approvals */}
        {hasRequiredApprovals && (
          <div className="flex items-center gap-2 flex-wrap">
            <Shield className="w-3.5 h-3.5 text-violet-500" />
            {transition.requiredApprovals.map(role => (
              <Badge
                key={role}
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-violet-50 border-violet-200 text-violet-700"
              >
                {role}
              </Badge>
            ))}
          </div>
        )}

        {/* Required Documents */}
        {hasRequiredDocs && (
          <div className="flex items-center gap-2 flex-wrap">
            <FileText className="w-3.5 h-3.5 text-blue-500" />
            {transition.requiredDocuments.map(doc => (
              <Badge
                key={doc}
                variant="outline"
                className="text-[10px] px-1.5 py-0 bg-blue-50 border-blue-200 text-blue-700"
              >
                {doc}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Blockers */}
      {hasBlockers && (
        <div className="mb-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowBlockers(!showBlockers);
            }}
            className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700"
          >
            <AlertTriangle className="w-3 h-3" />
            <span>{transition.blockers.length} blocker{transition.blockers.length > 1 ? 's' : ''}</span>
            {showBlockers ? (
              <ChevronUp className="w-3 h-3" />
            ) : (
              <ChevronDown className="w-3 h-3" />
            )}
          </button>

          {showBlockers && (
            <ul className="mt-2 space-y-1">
              {transition.blockers.map((blocker, idx) => (
                <li
                  key={idx}
                  className="text-xs text-[#737373] pl-4 border-l-2 border-amber-200"
                >
                  {blocker.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Action Button */}
      <Button
        size="sm"
        onClick={onTransition}
        disabled={!canTransition || isPending}
        className={cn(
          "w-full",
          canTransition
            ? "bg-indigo-600 hover:bg-indigo-700"
            : "bg-gray-300 cursor-not-allowed"
        )}
      >
        {isPending ? (
          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
        ) : (
          <ArrowRight className="w-4 h-4 mr-1" />
        )}
        {canTransition ? 'Transition' : 'Blocked'}
      </Button>
    </div>
  );
}
