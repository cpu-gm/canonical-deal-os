import React from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { humanizeBlocker, humanizeMaterialType } from '@/lib/fieldHumanization';

// Map blocker check names to action links
const BLOCKER_ACTIONS = {
  allClaimsVerified: {
    label: 'Go to Verification Queue',
    section: 'verification'
  },
  noOpenConflicts: {
    label: 'View Conflicts',
    section: 'underwriting'
  },
  hasSourceDocuments: {
    label: 'Upload Documents',
    section: 'documents'
  },
  hasUnderwritingModel: {
    label: 'Create Model',
    section: 'underwriting'
  },
  hasICMemo: {
    label: 'Generate IC Memo',
    section: 'docfactory'
  },
  hasPSAExecuted: {
    label: 'View Documents',
    section: 'docfactory'
  },
  ddItemsComplete: {
    label: 'View DD Checklist',
    section: 'docfactory'
  },
  hasLoanCommitment: {
    label: 'View Documents',
    section: 'documents'
  },
  allClosingDocsReady: {
    label: 'View Closing Docs',
    section: 'docfactory'
  }
};

export default function BlockerList({ blockers, onNavigate }) {
  if (!blockers || blockers.length === 0) {
    return null;
  }

  return (
    <ul className="space-y-3">
      {blockers.map((blocker, idx) => {
        const action = BLOCKER_ACTIONS[blocker.check];

        return (
          <li
            key={idx}
            className="flex items-start gap-3 p-3 bg-white rounded-lg border border-amber-200"
          >
            <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#171717]">
                {blocker.reason}
              </p>
              {blocker.details && Object.keys(blocker.details).length > 0 && (
                <p className="text-xs text-[#737373] mt-1">
                  {formatBlockerDetails(blocker.details)}
                </p>
              )}
            </div>
            {action && onNavigate && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNavigate(action.section)}
                className="flex-shrink-0 text-xs"
              >
                {action.label}
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function formatBlockerDetails(details) {
  const parts = [];

  if (details.pendingClaims !== undefined) {
    parts.push(`${details.pendingClaims} pending claim${details.pendingClaims !== 1 ? 's' : ''}`);
  }

  if (details.openConflicts !== undefined) {
    parts.push(`${details.openConflicts} open conflict${details.openConflicts !== 1 ? 's' : ''}`);
  }

  if (details.missingDocuments?.length > 0) {
    // Humanize document names
    const humanizedDocs = details.missingDocuments.map(doc => humanizeMaterialType(doc));
    parts.push(`Missing: ${humanizedDocs.join(', ')}`);
  }

  // Fallback: humanize JSON or raw details
  return parts.join(' • ') || humanizeBlocker(JSON.stringify(details));
}
