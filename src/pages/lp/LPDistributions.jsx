import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import {
  ArrowLeft, Loader2, DollarSign, CheckCircle2,
  Clock, TrendingUp, ChevronRight, Banknote
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { PageError } from '@/components/ui/page-state';
import { debugLog } from '@/lib/debug';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

function formatCurrency(value) {
  if (value === null || value === undefined) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function getStatusColor(status) {
  switch (status) {
    case 'PENDING':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'PROCESSING':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'PAID':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'FAILED':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'PROCESSING':
      return 'Processing';
    case 'PAID':
      return 'Paid';
    case 'FAILED':
      return 'Failed';
    default:
      return status;
  }
}

function getTypeLabel(type) {
  switch (type) {
    case 'CASH_DISTRIBUTION':
      return 'Cash Distribution';
    case 'RETURN_OF_CAPITAL':
      return 'Return of Capital';
    case 'TAX_DISTRIBUTION':
      return 'Tax Distribution';
    default:
      return type;
  }
}

function DistributionCard({ distribution, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {distribution.title}
          </h3>
          <p className="text-sm text-gray-500">
            {getTypeLabel(distribution.type)}
            {distribution.period && ` • ${distribution.period}`}
          </p>
        </div>
        <Badge className={cn('ml-2', getStatusColor(distribution.myAllocation?.status))}>
          {getStatusLabel(distribution.myAllocation?.status)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Your Amount</div>
          <div className="font-semibold text-gray-900 text-lg">
            {formatCurrency(distribution.myAllocation?.netAmount)}
          </div>
          {distribution.myAllocation?.withholdingAmount > 0 && (
            <div className="text-xs text-gray-500">
              ({formatCurrency(distribution.myAllocation?.withholdingAmount)} withheld)
            </div>
          )}
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Distribution Date</div>
          <div className="font-semibold text-gray-900">
            {formatDate(distribution.distributionDate)}
          </div>
        </div>
      </div>

      {distribution.myAllocation?.status === 'PAID' && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          <span>Paid on {formatDate(distribution.myAllocation.paidAt)}</span>
        </div>
      )}

      {distribution.myAllocation?.status === 'PROCESSING' && (
        <div className="flex items-center gap-2 text-blue-600 text-sm">
          <Clock className="w-4 h-4" />
          <span>Payment in progress</span>
        </div>
      )}

      <div className="flex items-center justify-end mt-4 pt-4 border-t border-gray-100">
        <span className="text-sm text-gray-500 group-hover:text-blue-600 transition-colors">
          View details
        </span>
        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 ml-1" />
      </div>
    </div>
  );
}

export default function LPDistributions() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const { authToken } = useAuth();

  const distributionsQuery = useQuery({
    queryKey: ['lp-distributions', dealId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/distributions`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 404) return { distributions: [], summary: {} };
        throw new Error('Failed to fetch distributions');
      }
      return res.json();
    },
    enabled: !!dealId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Distributions load failed', { message: error?.message, dealId });
    }
  });

  const distributions = distributionsQuery.data?.distributions || [];
  const summary = distributionsQuery.data?.summary || {};

  if (distributionsQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading distributions...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (distributionsQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={distributionsQuery.error} onRetry={distributionsQuery.refetch} />
        </div>
      </LPLayout>
    );
  }

  return (
    <LPLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <button
          onClick={() => navigate(`/investments/${dealId}`)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to investment</span>
        </button>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Distributions</h1>
          <p className="text-gray-500">
            {distributions.length} distribution{distributions.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-sm text-gray-500">Total Received</div>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {formatCurrency(summary.totalReceived || 0)}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-sm text-gray-500">Distributions</div>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {distributions.filter(d => d.myAllocation?.status === 'PAID').length}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-yellow-600" />
              </div>
              <div className="text-sm text-gray-500">Pending</div>
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {summary.pendingDistributions || 0}
            </div>
          </div>
        </div>

        {/* Distributions List */}
        {distributions.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Banknote className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="font-medium text-gray-900 mb-2">No Distributions Yet</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              There are no distributions for this investment yet. You'll be notified when a distribution is made.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pending distributions first */}
            {distributions.filter(d => d.myAllocation?.status !== 'PAID').length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Pending
                </h2>
                <div className="space-y-4">
                  {distributions
                    .filter(d => d.myAllocation?.status !== 'PAID')
                    .map(d => (
                      <DistributionCard
                        key={d.id}
                        distribution={d}
                        onClick={() => navigate(`/investments/${dealId}/distributions/${d.id}`)}
                      />
                    ))}
                </div>
              </div>
            )}

            {/* Paid distributions */}
            {distributions.filter(d => d.myAllocation?.status === 'PAID').length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Paid
                </h2>
                <div className="space-y-4">
                  {distributions
                    .filter(d => d.myAllocation?.status === 'PAID')
                    .map(d => (
                      <DistributionCard
                        key={d.id}
                        distribution={d}
                        onClick={() => navigate(`/investments/${dealId}/distributions/${d.id}`)}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </LPLayout>
  );
}
