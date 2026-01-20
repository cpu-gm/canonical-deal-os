import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, CheckCircle, MessageSquare, X, Loader2 } from 'lucide-react';
import { bff } from '@/api/bffClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow } from 'date-fns';

export default function ReviewRequestBanner({ request, dealId, onActionComplete }) {
  const queryClient = useQueryClient();
  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedback, setFeedback] = useState('');

  const respondMutation = useMutation({
    mutationFn: ({ action, message }) =>
      bff.reviewRequests.respond(request.id, action, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['review-requests'] });
      queryClient.invalidateQueries({ queryKey: ['deal-pending-review'] });
      queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
      setShowFeedbackForm(false);
      setFeedback('');
      if (onActionComplete) onActionComplete();
    }
  });

  const handleApprove = () => {
    respondMutation.mutate({ action: 'approve', message: null });
  };

  const handleReject = () => {
    respondMutation.mutate({ action: 'reject', message: feedback || null });
  };

  const handleSendFeedback = () => {
    if (!feedback.trim()) return;
    respondMutation.mutate({ action: 'feedback', message: feedback });
  };

  if (!request) return null;

  const requestedAgo = formatDistanceToNow(new Date(request.requestedAt), { addSuffix: true });

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Clock className="w-5 h-5 text-amber-700" />
          </div>
          <div>
            <h3 className="font-medium text-amber-900">Review Requested</h3>
            <p className="text-sm text-amber-700 mt-0.5">
              <span className="font-medium">{request.requestedByName || 'An analyst'}</span> requested your review {requestedAgo}
            </p>
            {request.message && (
              <div className="mt-2 p-3 bg-white/50 rounded-lg border border-amber-100">
                <p className="text-sm text-amber-800 italic">"{request.message}"</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Feedback Form */}
      {showFeedbackForm ? (
        <div className="mt-4 pt-4 border-t border-amber-200">
          <label className="block text-sm font-medium text-amber-900 mb-2">
            Your Feedback
          </label>
          <Textarea
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Provide feedback for the analyst..."
            className="min-h-[80px] bg-white border-amber-200"
          />
          <div className="flex gap-2 mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFeedbackForm(false)}
              disabled={respondMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSendFeedback}
              disabled={!feedback.trim() || respondMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {respondMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : (
                <MessageSquare className="w-4 h-4 mr-2" />
              )}
              Send Feedback
            </Button>
          </div>
        </div>
      ) : (
        /* Action Buttons */
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-amber-200">
          <Button
            size="sm"
            onClick={handleApprove}
            disabled={respondMutation.isPending}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {respondMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <CheckCircle className="w-4 h-4 mr-2" />
            )}
            Approve Work
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFeedbackForm(true)}
            disabled={respondMutation.isPending}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Request Changes
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReject}
            disabled={respondMutation.isPending}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <X className="w-4 h-4 mr-2" />
            Reject
          </Button>
        </div>
      )}

      {respondMutation.isError && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {respondMutation.error?.message || 'Failed to respond to review request'}
        </div>
      )}
    </div>
  );
}
