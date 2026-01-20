import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import {
  ArrowLeft, Loader2, DollarSign, Clock, CheckCircle2,
  AlertCircle, ChevronRight, BanknoteIcon
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
    case 'WIRE_INITIATED':
      return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'FUNDED':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'OVERDUE':
      return 'bg-red-100 text-red-800 border-red-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

function getStatusLabel(status) {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'WIRE_INITIATED':
      return 'Wire Sent';
    case 'FUNDED':
      return 'Funded';
    case 'OVERDUE':
      return 'Overdue';
    default:
      return status;
  }
}

function getPurposeLabel(purpose) {
  switch (purpose) {
    case 'INITIAL_FUNDING':
      return 'Initial Funding';
    case 'CAPEX':
      return 'Capital Expenditure';
    case 'OPERATING_SHORTFALL':
      return 'Operating Shortfall';
    case 'OTHER':
      return 'Other';
    default:
      return purpose;
  }
}

function CapitalCallCard({ capitalCall, onClick }) {
  const isOverdue = capitalCall.myAllocation?.status === 'PENDING' &&
    new Date(capitalCall.dueDate) < new Date();

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {capitalCall.title}
          </h3>
          <p className="text-sm text-gray-500">{getPurposeLabel(capitalCall.purpose)}</p>
        </div>
        <Badge className={cn('ml-2', getStatusColor(isOverdue ? 'OVERDUE' : capitalCall.myAllocation?.status))}>
          {getStatusLabel(isOverdue ? 'OVERDUE' : capitalCall.myAllocation?.status)}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Your Amount</div>
          <div className="font-semibold text-gray-900 text-lg">
            {formatCurrency(capitalCall.myAllocation?.amount)}
          </div>
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Due Date</div>
          <div className={cn(
            "font-semibold",
            isOverdue ? "text-red-600" : "text-gray-900"
          )}>
            {formatDate(capitalCall.dueDate)}
          </div>
        </div>
      </div>

      {capitalCall.myAllocation?.status === 'FUNDED' && (
        <div className="flex items-center gap-2 text-green-600 text-sm">
          <CheckCircle2 className="w-4 h-4" />
          <span>Funded on {formatDate(capitalCall.myAllocation.fundedAt)}</span>
        </div>
      )}

      {capitalCall.myAllocation?.status === 'WIRE_INITIATED' && (
        <div className="flex items-center gap-2 text-blue-600 text-sm">
          <Clock className="w-4 h-4" />
          <span>Awaiting confirmation</span>
        </div>
      )}

      {(capitalCall.myAllocation?.status === 'PENDING' && !isOverdue) && (
        <div className="flex items-center gap-2 text-yellow-600 text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>Action required</span>
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

export default function LPCapitalCalls() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const { authToken } = useAuth();

  const capitalCallsQuery = useQuery({
    queryKey: ['lp-capital-calls', dealId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/capital-calls`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 404) return { capitalCalls: [] };
        throw new Error('Failed to fetch capital calls');
      }
      return res.json();
    },
    enabled: !!dealId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Capital calls load failed', { message: error?.message, dealId });
    }
  });

  const capitalCalls = capitalCallsQuery.data?.capitalCalls || [];

  // Calculate summary
  const totalCalled = capitalCalls.reduce((sum, cc) => sum + (cc.myAllocation?.amount || 0), 0);
  const totalFunded = capitalCalls.reduce((sum, cc) => {
    if (cc.myAllocation?.status === 'FUNDED') {
      return sum + (cc.myAllocation?.fundedAmount || cc.myAllocation?.amount || 0);
    }
    return sum;
  }, 0);
  const pendingCalls = capitalCalls.filter(cc =>
    cc.myAllocation?.status === 'PENDING' || cc.myAllocation?.status === 'WIRE_INITIATED'
  );

  if (capitalCallsQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading capital calls...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (capitalCallsQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={capitalCallsQuery.error} onRetry={capitalCallsQuery.refetch} />
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
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Capital Calls</h1>
          <p className="text-gray-500">
            {capitalCalls.length} capital call{capitalCalls.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-blue-600" />
              </div>
              <div className="text-sm text-gray-500">Total Called</div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(totalCalled)}</div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-sm text-gray-500">Total Funded</div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatCurrency(totalFunded)}</div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
                <Clock className="w-5 h-5 text-yellow-600" />
              </div>
              <div className="text-sm text-gray-500">Pending</div>
            </div>
            <div className="text-2xl font-bold text-gray-900">{pendingCalls.length}</div>
          </div>
        </div>

        {/* Capital Calls List */}
        {capitalCalls.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <BanknoteIcon className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="font-medium text-gray-900 mb-2">No Capital Calls</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              There are no capital calls for this investment yet. You'll be notified when a capital call is issued.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Pending calls first */}
            {pendingCalls.length > 0 && (
              <div className="mb-6">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Action Required ({pendingCalls.length})
                </h2>
                <div className="space-y-4">
                  {pendingCalls.map(cc => (
                    <CapitalCallCard
                      key={cc.id}
                      capitalCall={cc}
                      onClick={() => navigate(`/investments/${dealId}/capital-calls/${cc.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Completed calls */}
            {capitalCalls.filter(cc => cc.myAllocation?.status === 'FUNDED').length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Completed
                </h2>
                <div className="space-y-4">
                  {capitalCalls
                    .filter(cc => cc.myAllocation?.status === 'FUNDED')
                    .map(cc => (
                      <CapitalCallCard
                        key={cc.id}
                        capitalCall={cc}
                        onClick={() => navigate(`/investments/${dealId}/capital-calls/${cc.id}`)}
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
