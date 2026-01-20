import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Send, CheckCircle, Loader2, Building2, Copy, Check } from 'lucide-react';
import { bff } from '@/api/bffClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export default function SubmitToLenderModal({ dealId, dealName, isOpen, onClose, onSuccess }) {
  const queryClient = useQueryClient();
  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [message, setMessage] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [magicLink, setMagicLink] = useState('');
  const [copied, setCopied] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () => bff.deals.submissions.create(dealId, {
      recipientEmail,
      recipientName: recipientName || null,
      recipientRole: 'LENDER',
      message: message || null
    }),
    onSuccess: (data) => {
      setShowSuccess(true);
      setMagicLink(data.magicLink || '');
      queryClient.invalidateQueries({ queryKey: ['deal-submissions', dealId] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      onSuccess?.();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!recipientEmail.trim()) return;
    submitMutation.mutate();
  };

  const handleCopyLink = async () => {
    if (magicLink) {
      await navigator.clipboard.writeText(magicLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleClose = () => {
    setShowSuccess(false);
    setRecipientEmail('');
    setRecipientName('');
    setMessage('');
    setMagicLink('');
    setCopied(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Success State */}
        {showSuccess ? (
          <div className="p-8">
            <div className="text-center mb-6">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle className="w-8 h-8 text-emerald-600" />
              </div>
              <h2 className="text-lg font-semibold text-[#171717] mb-2">Deal Submitted</h2>
              <p className="text-sm text-[#737373]">
                A review link has been sent to {recipientEmail}
              </p>
            </div>

            {/* Magic Link Display (for demo/testing) */}
            {magicLink && (
              <div className="mb-6">
                <label className="block text-xs font-medium text-[#737373] uppercase tracking-wider mb-2">
                  Magic Link (for testing)
                </label>
                <div className="flex gap-2">
                  <Input
                    value={magicLink}
                    readOnly
                    className="text-xs font-mono flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyLink}
                    className="shrink-0"
                  >
                    {copied ? (
                      <Check className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-[#A3A3A3]">
                  Share this link with the lender to test the portal experience.
                </p>
              </div>
            )}

            <Button onClick={handleClose} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Building2 className="w-5 h-5 text-blue-700" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-[#171717]">Submit to Lender</h2>
                  <p className="text-sm text-[#737373]">{dealName}</p>
                </div>
              </div>
              <button
                onClick={handleClose}
                className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#737373]" />
              </button>
            </div>

            {/* Content */}
            <form onSubmit={handleSubmit} className="px-6 py-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-[#171717] mb-2">
                    Lender Email <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="email"
                    value={recipientEmail}
                    onChange={(e) => setRecipientEmail(e.target.value)}
                    placeholder="lender@example.com"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#171717] mb-2">
                    Lender Name (optional)
                  </label>
                  <Input
                    value={recipientName}
                    onChange={(e) => setRecipientName(e.target.value)}
                    placeholder="John Smith"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#171717] mb-2">
                    Message (optional)
                  </label>
                  <Textarea
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    placeholder="Add a note for the lender..."
                    className="min-h-[80px] resize-none"
                  />
                </div>
              </div>

              {submitMutation.isError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700">
                    {submitMutation.error?.data?.error || 'Failed to submit deal'}
                  </p>
                </div>
              )}

              <div className="flex gap-3 mt-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  className="flex-1"
                  disabled={submitMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="flex-1 bg-blue-600 hover:bg-blue-700"
                  disabled={!recipientEmail.trim() || submitMutation.isPending}
                >
                  {submitMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Submit to Lender
                    </>
                  )}
                </Button>
              </div>
            </form>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-[#E5E5E5] bg-[#FAFAFA]">
              <p className="text-xs text-[#737373]">
                The lender will receive a secure link to review the deal.
                They can approve, reject, or request changes without creating an account.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
