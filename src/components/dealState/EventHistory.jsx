import React from 'react';
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  FileText,
  CheckCircle2,
  XCircle,
  Upload,
  User,
  Clock
} from 'lucide-react';

// Map event types to icons and colors
const EVENT_CONFIG = {
  StateTransition: {
    icon: ArrowRight,
    color: 'indigo',
    label: 'State Changed'
  },
  DealCreated: {
    icon: FileText,
    color: 'green',
    label: 'Deal Created'
  },
  DocumentUploaded: {
    icon: Upload,
    color: 'blue',
    label: 'Document Uploaded'
  },
  ClaimVerified: {
    icon: CheckCircle2,
    color: 'green',
    label: 'Claim Verified'
  },
  ClaimRejected: {
    icon: XCircle,
    color: 'red',
    label: 'Claim Rejected'
  },
  ApprovalGranted: {
    icon: CheckCircle2,
    color: 'green',
    label: 'Approval Granted'
  },
  AssignmentChanged: {
    icon: User,
    color: 'violet',
    label: 'Assignment Changed'
  }
};

const DEFAULT_EVENT = {
  icon: Clock,
  color: 'gray',
  label: 'Event'
};

export default function EventHistory({ events, stateDisplay }) {
  if (!events || events.length === 0) {
    return (
      <div className="text-center py-8 text-[#737373]">
        No activity recorded yet
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

      {/* Events */}
      <div className="space-y-4">
        {events.map((event, idx) => {
          const config = EVENT_CONFIG[event.eventType] || DEFAULT_EVENT;
          const Icon = config.icon;
          const eventData = parseEventData(event.eventData);

          return (
            <div key={event.id || idx} className="relative flex gap-4">
              {/* Icon dot */}
              <div
                className={cn(
                  "relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                  config.color === 'indigo' && "bg-indigo-100",
                  config.color === 'green' && "bg-green-100",
                  config.color === 'blue' && "bg-blue-100",
                  config.color === 'red' && "bg-red-100",
                  config.color === 'violet' && "bg-violet-100",
                  config.color === 'gray' && "bg-gray-100"
                )}
              >
                <Icon
                  className={cn(
                    "w-4 h-4",
                    config.color === 'indigo' && "text-indigo-600",
                    config.color === 'green' && "text-green-600",
                    config.color === 'blue' && "text-blue-600",
                    config.color === 'red' && "text-red-600",
                    config.color === 'violet' && "text-violet-600",
                    config.color === 'gray' && "text-gray-600"
                  )}
                />
              </div>

              {/* Content */}
              <div className="flex-1 pb-4">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[#171717]">
                    {formatEventTitle(event, eventData, stateDisplay)}
                  </p>
                  <span className="text-xs text-[#737373]">
                    {formatEventTime(event.occurredAt || event.timestamp)}
                  </span>
                </div>

                {/* Event details */}
                {eventData && (
                  <p className="text-xs text-[#737373] mt-1">
                    {formatEventDetails(event, eventData)}
                  </p>
                )}

                {/* Actor */}
                {event.actorName && (
                  <div className="flex items-center gap-1 mt-2">
                    <User className="w-3 h-3 text-[#A3A3A3]" />
                    <span className="text-xs text-[#737373]">
                      {event.actorName}
                      {event.actorRole && ` (${event.actorRole})`}
                    </span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function parseEventData(eventData) {
  if (!eventData) return null;
  if (typeof eventData === 'object') return eventData;
  try {
    return JSON.parse(eventData);
  } catch {
    return null;
  }
}

function formatEventTitle(event, eventData, stateDisplay) {
  switch (event.eventType) {
    case 'StateTransition':
      const toState = event.toState || eventData?.toState;
      const toLabel = stateDisplay?.[toState]?.label || toState;
      return `Transitioned to ${toLabel}`;

    case 'DealCreated':
      return eventData?.name ? `Deal created: ${eventData.name}` : 'Deal created';

    case 'DocumentUploaded':
      return eventData?.documentName
        ? `Document uploaded: ${eventData.documentName}`
        : 'Document uploaded';

    case 'ClaimVerified':
      return eventData?.fieldPath
        ? `Claim verified: ${eventData.fieldPath}`
        : 'Claim verified';

    case 'ClaimRejected':
      return eventData?.fieldPath
        ? `Claim rejected: ${eventData.fieldPath}`
        : 'Claim rejected';

    case 'ApprovalGranted':
      return eventData?.approverRole
        ? `${eventData.approverRole} approval granted`
        : 'Approval granted';

    case 'AssignmentChanged':
      return eventData?.assigneeName
        ? `Assigned to ${eventData.assigneeName}`
        : 'Assignment changed';

    default:
      return event.eventType?.replace(/([A-Z])/g, ' $1').trim() || 'Event';
  }
}

function formatEventDetails(event, eventData) {
  switch (event.eventType) {
    case 'StateTransition':
      const fromState = event.fromState || eventData?.fromState;
      const reason = eventData?.reason;
      const parts = [];
      if (fromState) parts.push(`From: ${fromState}`);
      if (reason) parts.push(`Reason: ${reason}`);
      return parts.join(' • ') || null;

    case 'ClaimVerified':
    case 'ClaimRejected':
      return eventData?.value !== undefined
        ? `Value: ${JSON.stringify(eventData.value)}`
        : null;

    default:
      return null;
  }
}

function formatEventTime(timestamp) {
  if (!timestamp) return '';

  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
