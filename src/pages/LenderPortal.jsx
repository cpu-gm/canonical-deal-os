import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Building2, FileText, CheckCircle, X, MessageSquare,
  Loader2, AlertCircle, DollarSign, Home,
  TrendingUp, Users, Check
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { formatDistanceToNow } from 'date-fns';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

// Direct API calls for portal (no auth required, token-based)
const portalApi = {
  getData: async (token) => {
    const res = await fetch(`${BFF_BASE}/api/portal/lender?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const data = await res.json();
      throw { status: res.status, data };
    }
    return res.json();
  },
  approve: async (token, comment) => {
    const res = await fetch(`${BFF_BASE}/api/portal/lender/approve?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comment })
    });
    if (!res.ok) throw { status: res.status, data: await res.json() };
    return res.json();
  },
  reject: async (token, reason, requestChanges = false) => {
    const res = await fetch(`${BFF_BASE}/api/portal/lender/reject?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, requestChanges })
    });
    if (!res.ok) throw { status: res.status, data: await res.json() };
    return res.json();
  },
  comment: async (token, content) => {
    const res = await fetch(`${BFF_BASE}/api/portal/lender/comment?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content })
    });
    if (!res.ok) throw { status: res.status, data: await res.json() };
    return res.json();
  }
};

function formatCurrency(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${value}%`;
}

export default function LenderPortal() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [showFeedbackForm, setShowFeedbackForm] = useState(false);
  const [feedbackType, setFeedbackType] = useState(null); // 'approve', 'reject', 'changes'
  const [feedback, setFeedback] = useState('');
  const [actionComplete, setActionComplete] = useState(null);

  // Fetch portal data
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['lender-portal', token],
    queryFn: () => portalApi.getData(token),
    enabled: !!token,
    retry: false
  });

  // Mutations
  const approveMutation = useMutation({
    mutationFn: (comment) => portalApi.approve(token, comment),
    onSuccess: () => {
      setActionComplete({ type: 'approved', message: 'Deal has been approved' });
      setShowFeedbackForm(false);
      setFeedback('');
    }
  });

  const rejectMutation = useMutation({
    mutationFn: ({ reason, requestChanges }) => portalApi.reject(token, reason, requestChanges),
    onSuccess: (data) => {
      setActionComplete({
        type: data.status === 'CHANGES_REQUESTED' ? 'changes' : 'rejected',
        message: data.message
      });
      setShowFeedbackForm(false);
      setFeedback('');
    }
  });

  const handleAction = (type) => {
    setFeedbackType(type);
    setShowFeedbackForm(true);
  };

  const handleSubmitAction = () => {
    if (feedbackType === 'approve') {
      approveMutation.mutate(feedback || null);
    } else if (feedbackType === 'reject') {
      rejectMutation.mutate({ reason: feedback, requestChanges: false });
    } else if (feedbackType === 'changes') {
      rejectMutation.mutate({ reason: feedback, requestChanges: true });
    }
  };

  const isPending = approveMutation.isPending || rejectMutation.isPending;

  // No token provided
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invalid Access</h1>
          <p className="text-gray-600">
            No access token provided. Please use the link from your email.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading deal information...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Access Error</h1>
          <p className="text-gray-600">
            {error.data?.error || 'Unable to load deal information. The link may have expired.'}
          </p>
        </div>
      </div>
    );
  }

  // Action complete state
  if (actionComplete) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          {actionComplete.type === 'approved' ? (
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-emerald-100 flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-emerald-600" />
            </div>
          ) : actionComplete.type === 'changes' ? (
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-100 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-amber-600" />
            </div>
          ) : (
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
              <X className="w-8 h-8 text-red-600" />
            </div>
          )}
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {actionComplete.type === 'approved' ? 'Deal Approved' :
             actionComplete.type === 'changes' ? 'Changes Requested' : 'Deal Rejected'}
          </h1>
          <p className="text-gray-600">{actionComplete.message}</p>
          <p className="text-sm text-gray-500 mt-4">
            The GP team has been notified of your response.
          </p>
        </div>
      </div>
    );
  }

  const { deal, documents, comments, submission, portal } = data;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Building2 className="w-6 h-6 text-blue-700" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-gray-900">Lender Review Portal</h1>
                <p className="text-sm text-gray-500">Secure deal review</p>
              </div>
            </div>
            {portal?.expiresAt && (
              <div className="text-xs text-gray-500">
                Link expires {formatDistanceToNow(new Date(portal.expiresAt), { addSuffix: true })}
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Deal Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900">{deal.name}</h2>
              <p className="text-gray-600 mt-1">{deal.propertyAddress || 'Address not specified'}</p>
            </div>
            {submission && (
              <div className="text-right">
                <p className="text-sm text-gray-500">Submitted by</p>
                <p className="font-medium text-gray-900">{submission.submittedByName || 'GP Team'}</p>
                <p className="text-xs text-gray-500">
                  {formatDistanceToNow(new Date(submission.submittedAt), { addSuffix: true })}
                </p>
              </div>
            )}
          </div>

          {/* Key Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <DollarSign className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider">Loan Request</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(deal.loanAmount)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <TrendingUp className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider">LTV</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{formatPercent(deal.ltv)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Home className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider">Property</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{deal.propertyType || '—'}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex items-center gap-2 text-gray-500 mb-1">
                <Users className="w-4 h-4" />
                <span className="text-xs uppercase tracking-wider">Units</span>
              </div>
              <p className="text-xl font-bold text-gray-900">{deal.unitCount || '—'}</p>
            </div>
          </div>

          {/* Additional Metrics */}
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-gray-100">
            <div className="text-center">
              <p className="text-sm text-gray-500">DSCR</p>
              <p className="text-lg font-semibold text-gray-900">{deal.dscr ? `${deal.dscr}x` : '—'}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-500">Cap Rate</p>
              <p className="text-lg font-semibold text-gray-900">{formatPercent(deal.capRate)}</p>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-500">NOI</p>
              <p className="text-lg font-semibold text-gray-900">{formatCurrency(deal.noi)}</p>
            </div>
          </div>
        </div>

        {/* Documents */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <h3 className="font-semibold text-gray-900 mb-4">Documents</h3>
          <div className="space-y-2">
            {documents.length === 0 ? (
              <p className="text-gray-500 text-sm">No documents available</p>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                >
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <span className="font-medium text-gray-900">{doc.name}</span>
                  </div>
                  {doc.verified && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
                      <Check className="w-3 h-3" />
                      Verified
                    </span>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Action Section */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          {showFeedbackForm ? (
            <div>
              <h3 className="font-semibold text-gray-900 mb-4">
                {feedbackType === 'approve' ? 'Add a Comment (Optional)' :
                 feedbackType === 'changes' ? 'Describe Required Changes' : 'Reason for Rejection'}
              </h3>
              <Textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={
                  feedbackType === 'approve' ? 'Add any notes about the approval...' :
                  feedbackType === 'changes' ? 'What changes are needed?' :
                  'Why is this deal being rejected?'
                }
                className="min-h-[100px] mb-4"
              />
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowFeedbackForm(false);
                    setFeedback('');
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSubmitAction}
                  disabled={isPending || (feedbackType !== 'approve' && !feedback.trim())}
                  className={
                    feedbackType === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' :
                    feedbackType === 'changes' ? 'bg-amber-600 hover:bg-amber-700' :
                    'bg-red-600 hover:bg-red-700'
                  }
                >
                  {isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  {feedbackType === 'approve' ? 'Confirm Approval' :
                   feedbackType === 'changes' ? 'Submit Change Request' : 'Confirm Rejection'}
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <h3 className="font-semibold text-gray-900 mb-4">Your Decision</h3>
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={() => handleAction('approve')}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Approve Deal
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleAction('changes')}
                >
                  <MessageSquare className="w-4 h-4 mr-2" />
                  Request Changes
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleAction('reject')}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  <X className="w-4 h-4 mr-2" />
                  Reject
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Comments Section */}
        {comments && comments.length > 0 && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mt-6">
            <h3 className="font-semibold text-gray-900 mb-4">Comments</h3>
            <div className="space-y-4">
              {comments.map((comment) => (
                <div key={comment.id} className="border-l-2 border-gray-200 pl-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-gray-900">
                      {comment.authorName || comment.authorEmail}
                    </span>
                    <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                      {comment.authorRole}
                    </span>
                  </div>
                  <p className="text-gray-700">{comment.content}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {formatDistanceToNow(new Date(comment.createdAt), { addSuffix: true })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 bg-white mt-8">
        <div className="max-w-4xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          Secure portal powered by Canonical Deal OS
        </div>
      </footer>
    </div>
  );
}
