import React from 'react';
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Simplified state sequence for progress bar - user-friendly names
const STATE_SEQUENCE = [
  { key: 'INTAKE_RECEIVED', label: 'Submitted', shortLabel: '1' },
  { key: 'DATA_ROOM_INGESTED', label: 'Docs Ready', shortLabel: '2' },
  { key: 'EXTRACTION_COMPLETE', label: 'Analyzing', shortLabel: '3' },
  { key: 'UNDERWRITING_DRAFT', label: 'Underwriting', shortLabel: '4' },
  { key: 'IC_READY', label: 'Committee', shortLabel: '5' },
  { key: 'LOI_DRAFT', label: 'Offer Sent', shortLabel: '6' },
  { key: 'LOI_ACCEPTED', label: 'Accepted', shortLabel: '7' },
  { key: 'PSA_EXECUTED', label: 'Contract', shortLabel: '8' },
  { key: 'DD_COMPLETE', label: 'Diligence', shortLabel: '9' },
  { key: 'FINANCING_COMMITTED', label: 'Financing', shortLabel: '10' },
  { key: 'CLOSED', label: 'Closed', shortLabel: '✓' }
];

// Map intermediate states to their milestone
const STATE_TO_MILESTONE = {
  INTAKE_RECEIVED: 'INTAKE_RECEIVED',
  DATA_ROOM_INGESTED: 'DATA_ROOM_INGESTED',
  EXTRACTION_COMPLETE: 'EXTRACTION_COMPLETE',
  UNDERWRITING_DRAFT: 'UNDERWRITING_DRAFT',
  IC_READY: 'IC_READY',
  LOI_DRAFT: 'LOI_DRAFT',
  LOI_SENT: 'LOI_DRAFT',
  LOI_ACCEPTED: 'LOI_ACCEPTED',
  PSA_DRAFT: 'LOI_ACCEPTED',
  PSA_EXECUTED: 'PSA_EXECUTED',
  DD_ACTIVE: 'PSA_EXECUTED',
  DD_COMPLETE: 'DD_COMPLETE',
  FINANCING_IN_PROGRESS: 'DD_COMPLETE',
  FINANCING_COMMITTED: 'FINANCING_COMMITTED',
  CLEAR_TO_CLOSE: 'FINANCING_COMMITTED',
  CLOSED: 'CLOSED'
};

export default function StateProgressBar({ currentState }) {
  const currentMilestone = STATE_TO_MILESTONE[currentState] || currentState;
  const currentIndex = STATE_SEQUENCE.findIndex(s => s.key === currentMilestone);

  // Handle terminal states
  const isTerminal = currentState === 'DEAD' || currentState === 'ON_HOLD';

  return (
    <div className="relative">
      {/* Progress line background */}
      <div className="absolute top-4 left-0 right-0 h-1 bg-gray-200 rounded-full" />

      {/* Progress line filled */}
      {!isTerminal && currentIndex >= 0 && (
        <div
          className="absolute top-4 left-0 h-1 bg-indigo-500 rounded-full transition-all duration-500"
          style={{ width: `${(currentIndex / (STATE_SEQUENCE.length - 1)) * 100}%` }}
        />
      )}

      {/* State dots */}
      <TooltipProvider>
        <div className="relative flex justify-between">
          {STATE_SEQUENCE.map((state, index) => {
            const isComplete = !isTerminal && index < currentIndex;
            const isCurrent = !isTerminal && index === currentIndex;
            const isUpcoming = isTerminal || index > currentIndex;

            return (
              <Tooltip key={state.key}>
                <TooltipTrigger asChild>
                  <div className="flex flex-col items-center">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300 cursor-default",
                        isComplete && "bg-indigo-500 border-indigo-500 text-white",
                        isCurrent && "bg-white border-indigo-500 ring-4 ring-indigo-100",
                        isUpcoming && "bg-white border-gray-300 text-gray-400"
                      )}
                    >
                      {isComplete ? (
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      ) : (
                        <span className={cn(
                          "text-[10px] font-semibold",
                          isCurrent && "text-indigo-600"
                        )}>
                          {state.shortLabel}
                        </span>
                      )}
                    </div>
                    <span className={cn(
                      "mt-2 text-[10px] font-medium text-center max-w-[60px] leading-tight",
                      isComplete && "text-indigo-600",
                      isCurrent && "text-indigo-700 font-semibold",
                      isUpcoming && "text-gray-400"
                    )}>
                      {state.label}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{state.label}</p>
                  {isCurrent && <p className="text-xs text-gray-400">Current State</p>}
                  {isComplete && <p className="text-xs text-green-600">Completed</p>}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>

      {/* Terminal state indicator */}
      {isTerminal && (
        <div className="mt-4 text-center">
          <span className={cn(
            "inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium",
            currentState === 'DEAD' && "bg-red-100 text-red-700",
            currentState === 'ON_HOLD' && "bg-gray-100 text-gray-700"
          )}>
            {currentState === 'DEAD' ? 'Deal Terminated' : 'Deal On Hold'}
          </span>
        </div>
      )}
    </div>
  );
}
