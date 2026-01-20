import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Send, CheckCircle, Loader2 } from 'lucide-react';
import { bff } from '@/api/bffClient';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

export default function RequestReviewModal({ dealId, dealName, isOpen, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  const requestMutation = useMutation({
    mutationFn: () => bff.deals.reviewRequests.create(dealId, message || null),
    onSuccess: () => {
      setShowSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-pending-review', dealId] });
      queryClient.invalidateQueries({ queryKey: ['pending-reviews'] });
      onSuccess?.();
      // Auto-close after showing success
      setTimeout(() => {
        setShowSuccess(false);
        setMessage('');
        onClose();
      }, 2000);
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    requestMutation.mutate();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Success State */}
        {showSuccess ? (
          <div className="p-8 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
            <h2 className="text-lg font-semibold text-[#171717] mb-2">Review Requested</h2>
            <p className="text-sm text-[#737373]">
              The GP team has been notified and will review your work shortly.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
              <div>
                <h2 className="text-lg font-semibold text-[#171717]">Request GP Review</h2>
                <p className="text-sm text-[#737373]">{dealName}</p>
              </div>
              <button
                onClick={onClose}
                className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#737373]" />
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleSubmit} className="px-6 py-4">
              <div className="mb-4">
                <label className="block text-sm font-medium text-[#171717] mb-2">
                  Message (optional)
                </label>
                <Textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Add a note for the GP team about what you'd like them to review..."
                  className="min-h-[100px] resize-none"
                />
                <p className="mt-2 text-xs text-[#A3A3A3]">
                  Let the GP know what areas need their attention or any questions you have.
                </p>
              </div>

              {requestMutation.isError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">
                    {requestMutation.error?.data?.error || 'Failed to submit review request'}
                  </p>
                </div>
              )}

              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  className="flex-1"
                  disabled={requestMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-teal-600 hover:bg-teal-700"
                  disabled={requestMutation.isPending}
                >
                  {requestMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Request Review
                    </>
                  )}
                </Button>
              </div>
            </form>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#E5E5E5] bg-[#FAFAFA]">
              <p className="text-xs text-[#737373]">
                Once submitted, the GP team will be notified to review your work.
                You'll receive a notification when they respond.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
