import React from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * DraftModeBanner Component
 *
 * Shows a prominent banner when a deal is in draft mode, indicating that changes
 * are simulated and not committed. Provides actions to commit or revert the draft.
 */
export default function DraftModeBanner({ dealId, isDraft, onCommit, onRevert }) {
  if (!isDraft) return null;

  return (
    <div className="mb-6 bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded-r-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-600 flex-shrink-0" />
          <div>
            <p className="font-semibold text-yellow-800">
              Draft Mode Active
            </p>
            <p className="text-sm text-yellow-700 mt-1">
              Changes are simulated and not committed to the permanent record.
              Use "Commit Draft" to make them permanent or "Revert Changes" to discard.
            </p>
          </div>
        </div>

        <div className="flex gap-2 ml-4">
          <Button
            variant="outline"
            onClick={onRevert}
            className="border-yellow-600 text-yellow-700 hover:bg-yellow-100"
          >
            Revert Changes
          </Button>
          <Button
            onClick={onCommit}
            className="bg-yellow-600 hover:bg-yellow-700 text-white"
          >
            Commit Draft
          </Button>
        </div>
      </div>
    </div>
  );
}
