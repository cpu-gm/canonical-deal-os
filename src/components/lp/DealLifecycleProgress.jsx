import React from 'react';
import { Check } from 'lucide-react';

/**
 * Deal lifecycle states in order
 */
export const DEAL_LIFECYCLE_STATES = [
  { id: 'INTAKE_RECEIVED', label: 'Intake', shortLabel: 'Intake' },
  { id: 'DATA_ROOM_INGESTED', label: 'Data Room', shortLabel: 'Data' },
  { id: 'EXTRACTION_COMPLETE', label: 'Extraction', shortLabel: 'Extract' },
  { id: 'UNDERWRITING_DRAFT', label: 'Underwriting', shortLabel: 'UW' },
  { id: 'IC_READY', label: 'IC Ready', shortLabel: 'IC' },
  { id: 'LOI_DRAFT', label: 'LOI Draft', shortLabel: 'LOI' },
  { id: 'LOI_SENT', label: 'LOI Sent', shortLabel: 'Sent' },
  { id: 'LOI_ACCEPTED', label: 'LOI Accepted', shortLabel: 'Accept' },
  { id: 'PSA_DRAFT', label: 'PSA Draft', shortLabel: 'PSA' },
  { id: 'PSA_EXECUTED', label: 'PSA Executed', shortLabel: 'Exec' },
  { id: 'DD_ACTIVE', label: 'Due Diligence', shortLabel: 'DD' },
  { id: 'DD_COMPLETE', label: 'DD Complete', shortLabel: 'Done' },
  { id: 'FINANCING_IN_PROGRESS', label: 'Financing', shortLabel: 'Fin' },
  { id: 'FINANCING_COMMITTED', label: 'Committed', shortLabel: 'Comm' },
  { id: 'CLEAR_TO_CLOSE', label: 'Clear to Close', shortLabel: 'CTC' },
  { id: 'CLOSED', label: 'Closed', shortLabel: 'Closed' }
];

/**
 * Get the index of a state in the lifecycle
 */
export function getStateIndex(stateId) {
  const index = DEAL_LIFECYCLE_STATES.findIndex(s => s.id === stateId);
  return index >= 0 ? index : 0;
}

/**
 * Get state info by ID
 */
export function getStateInfo(stateId) {
  return DEAL_LIFECYCLE_STATES.find(s => s.id === stateId) || DEAL_LIFECYCLE_STATES[0];
}

/**
 * DealLifecycleProgress component
 *
 * @param {string} currentState - The current state ID
 * @param {string} size - 'sm' | 'md' | 'lg'
 * @param {boolean} showLabels - Whether to show state labels
 * @param {boolean} compact - Show fewer milestones for compact view
 */
export default function DealLifecycleProgress({
  currentState = 'INTAKE_RECEIVED',
  size = 'md',
  showLabels = false,
  compact = true
}) {
  const currentIndex = getStateIndex(currentState);
  const totalStates = DEAL_LIFECYCLE_STATES.length;

  // For compact view, show key milestones only
  const keyMilestones = compact ? [
    { index: 0, ...DEAL_LIFECYCLE_STATES[0] },     // Intake
    { index: 4, ...DEAL_LIFECYCLE_STATES[4] },     // IC Ready
    { index: 7, ...DEAL_LIFECYCLE_STATES[7] },     // LOI Accepted
    { index: 10, ...DEAL_LIFECYCLE_STATES[10] },   // DD Active
    { index: 13, ...DEAL_LIFECYCLE_STATES[13] },   // Financing Committed
    { index: 15, ...DEAL_LIFECYCLE_STATES[15] }    // Closed
  ] : DEAL_LIFECYCLE_STATES.map((state, index) => ({ index, ...state }));

  const sizeClasses = {
    sm: {
      container: 'h-1.5',
      dot: 'w-2 h-2',
      label: 'text-[10px]'
    },
    md: {
      container: 'h-2',
      dot: 'w-3 h-3',
      label: 'text-xs'
    },
    lg: {
      container: 'h-3',
      dot: 'w-4 h-4',
      label: 'text-sm'
    }
  };

  const classes = sizeClasses[size] || sizeClasses.md;
  const progressPercent = ((currentIndex + 1) / totalStates) * 100;

  if (compact) {
    // Simple progress bar with stage indicator
    return (
      <div className="w-full">
        <div className="flex justify-between items-center mb-1">
          <span className={`${classes.label} font-medium text-gray-900`}>
            {getStateInfo(currentState).label}
          </span>
          <span className={`${classes.label} text-gray-500`}>
            Stage {currentIndex + 1} of {totalStates}
          </span>
        </div>
        <div className={`w-full bg-gray-200 rounded-full ${classes.container}`}>
          <div
            className={`bg-blue-600 ${classes.container} rounded-full transition-all duration-500`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>
    );
  }

  // Full milestone view
  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-2">
        <span className="text-sm font-medium text-gray-900">
          {getStateInfo(currentState).label}
        </span>
        <span className="text-xs text-gray-500">
          {currentIndex + 1} of {totalStates}
        </span>
      </div>

      <div className="relative">
        {/* Background line */}
        <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gray-200 -translate-y-1/2" />

        {/* Progress line */}
        <div
          className="absolute top-1/2 left-0 h-0.5 bg-blue-600 -translate-y-1/2 transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />

        {/* Milestones */}
        <div className="relative flex justify-between">
          {keyMilestones.map((milestone) => {
            const isComplete = currentIndex >= milestone.index;
            const isCurrent = currentIndex === milestone.index;

            return (
              <div key={milestone.id} className="flex flex-col items-center">
                <div
                  className={`
                    ${classes.dot} rounded-full flex items-center justify-center
                    transition-all duration-300 z-10
                    ${isComplete
                      ? 'bg-blue-600 text-white'
                      : 'bg-white border-2 border-gray-300'
                    }
                    ${isCurrent ? 'ring-2 ring-blue-200 ring-offset-1' : ''}
                  `}
                >
                  {isComplete && size !== 'sm' && (
                    <Check className="w-2 h-2" />
                  )}
                </div>
                {showLabels && (
                  <span
                    className={`
                      ${classes.label} mt-1 text-center
                      ${isComplete ? 'text-blue-600 font-medium' : 'text-gray-500'}
                    `}
                  >
                    {milestone.shortLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
