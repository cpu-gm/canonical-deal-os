import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import {
  ArrowLeft, Loader2, CheckCircle2,
  Clock, AlertCircle, FileText, HelpCircle
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
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

function getPaymentMethodLabel(method) {
  switch (method) {
    case 'WIRE':
      return 'Wire Transfer';
    case 'ACH':
      return 'ACH Transfer';
    case 'CHECK':
      return 'Check';
    default:
      return method;
  }
}

export default function LPDistributionDetail() {
  const { dealId, distributionId } = useParams();
  const navigate = useNavigate();
  const { authToken } = useAuth();

  const distributionQuery = useQuery({
    queryKey: ['lp-distribution', dealId, distributionId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/distributions/${distributionId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch distribution');
      return res.json();
    },
    enabled: !!dealId && !!distributionId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Distribution load failed', { message: error?.message, dealId, distributionId });
    }
  });

  const distribution = distributionQuery.data?.distribution;
  const myAllocation = distributionQuery.data?.myAllocation;

  if (distributionQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading distribution...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (distributionQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={distributionQuery.error} onRetry={distributionQuery.refetch} />
        </div>
      </LPLayout>
    );
  }

  if (!distribution) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Distribution Not Found</h2>
            <p className="text-gray-500 mb-4">This distribution may not exist or you may not have access.</p>
            <Button onClick={() => navigate(`/investments/${dealId}/distributions`)}>
              Back to Distributions
            </Button>
          </div>
        </div>
      </LPLayout>
    );
  }

  return (
    <LPLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <button
          onClick={() => navigate(`/investments/${dealId}/distributions`)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to distributions</span>
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{distribution.title}</h1>
            <p className="text-gray-500">
              {getTypeLabel(distribution.type)}
              {distribution.period && ` • ${distribution.period}`}
            </p>
          </div>
          <Badge className={cn('text-sm', getStatusColor(myAllocation?.status))}>
            {getStatusLabel(myAllocation?.status)}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Amount Breakdown */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Distribution</h2>

              <div className="space-y-4">
                <div className="flex justify-between items-center py-3 border-b border-gray-100">
                  <div>
                    <div className="font-medium text-gray-900">Gross Amount</div>
                    <div className="text-sm text-gray-500">Your share of the total distribution</div>
                  </div>
                  <div className="text-xl font-semibold text-gray-900">
                    {formatCurrency(myAllocation?.grossAmount)}
                  </div>
                </div>

                {myAllocation?.withholdingAmount > 0 && (
                  <div className="flex justify-between items-center py-3 border-b border-gray-100">
                    <div>
                      <div className="font-medium text-gray-900">Tax Withholding</div>
                      <div className="text-sm text-gray-500">Required withholding amount</div>
                    </div>
                    <div className="text-lg font-medium text-red-600">
                      -{formatCurrency(myAllocation?.withholdingAmount)}
                    </div>
                  </div>
                )}

                <div className="flex justify-between items-center py-3">
                  <div>
                    <div className="font-medium text-gray-900">Net Amount</div>
                    <div className="text-sm text-gray-500">Amount you will receive</div>
                  </div>
                  <div className="text-2xl font-bold text-green-600">
                    {formatCurrency(myAllocation?.netAmount)}
                  </div>
                </div>
              </div>
            </div>

            {/* Payment Status */}
            {myAllocation?.status === 'PAID' && (
              <div className="bg-green-50 rounded-xl border border-green-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                  <div>
                    <h2 className="text-lg font-semibold text-green-900">Payment Complete</h2>
                    <p className="text-green-700">This distribution has been paid</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-green-600">Payment Method</div>
                    <div className="font-semibold text-green-900">
                      {getPaymentMethodLabel(myAllocation.paymentMethod)}
                    </div>
                  </div>
                  <div>
                    <div className="text-green-600">Paid On</div>
                    <div className="font-semibold text-green-900">
                      {formatDate(myAllocation.paidAt)}
                    </div>
                  </div>
                  {myAllocation.confirmationRef && (
                    <div className="col-span-2">
                      <div className="text-green-600">Confirmation Reference</div>
                      <div className="font-mono text-green-900">
                        {myAllocation.confirmationRef}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {myAllocation?.status === 'PROCESSING' && (
              <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
                <div className="flex items-center gap-3">
                  <Clock className="w-8 h-8 text-blue-600" />
                  <div>
                    <h2 className="text-lg font-semibold text-blue-900">Payment Processing</h2>
                    <p className="text-blue-700">
                      Your payment is being processed via {getPaymentMethodLabel(myAllocation.paymentMethod).toLowerCase()}.
                      This typically takes 1-3 business days.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {myAllocation?.status === 'PENDING' && (
              <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-6">
                <div className="flex items-center gap-3">
                  <Clock className="w-8 h-8 text-yellow-600" />
                  <div>
                    <h2 className="text-lg font-semibold text-yellow-900">Payment Pending</h2>
                    <p className="text-yellow-700">
                      This distribution has been approved and payment will be processed soon.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Description */}
            {distribution.description && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Description</h2>
                <p className="text-gray-700">{distribution.description}</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Distribution Summary */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Distribution Summary</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Distribution</span>
                  <span className="font-medium">{formatCurrency(distribution.totalAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Your Share</span>
                  <span className="font-medium">{formatCurrency(myAllocation?.netAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Distribution Date</span>
                  <span className="font-medium">{formatDate(distribution.distributionDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Type</span>
                  <span className="font-medium">{getTypeLabel(distribution.type)}</span>
                </div>
                {distribution.period && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Period</span>
                    <span className="font-medium">{distribution.period}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Documents */}
            {distribution.documentId && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Documents</h3>
                <button className="flex items-center gap-3 w-full p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <FileText className="w-5 h-5 text-gray-400" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900">Distribution Statement</div>
                    <div className="text-xs text-gray-500">PDF Document</div>
                  </div>
                </button>
              </div>
            )}

            {/* Help */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
              <div className="flex items-start gap-3 mb-4">
                <HelpCircle className="w-5 h-5 text-gray-400 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-gray-900">Why This Amount?</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    Your distribution amount is calculated based on your ownership percentage
                    in the investment and the waterfall structure defined in your partnership agreement.
                  </p>
                </div>
              </div>
              <Button variant="outline" className="w-full">
                View Waterfall Details
              </Button>
            </div>

            {/* Contact */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-2">Questions?</h3>
              <p className="text-sm text-gray-500 mb-4">
                Contact your GP if you have questions about this distribution.
              </p>
              <Button variant="outline" className="w-full">
                Contact GP
              </Button>
            </div>
          </div>
        </div>
      </div>
    </LPLayout>
  );
}
