import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import {
  ArrowLeft, Loader2, Clock, CheckCircle2,
  AlertCircle, Copy, Check, FileText
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
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
    month: 'long',
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
      return 'Wire Initiated';
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

function CopyableField({ label, value }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
      <div>
        <div className="text-xs text-gray-500">{label}</div>
        <div className="font-mono text-sm">{value}</div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="text-gray-400 hover:text-gray-600"
      >
        {copied ? (
          <Check className="w-4 h-4 text-green-500" />
        ) : (
          <Copy className="w-4 h-4" />
        )}
      </Button>
    </div>
  );
}

export default function LPCapitalCallDetail() {
  const { dealId, callId } = useParams();
  const navigate = useNavigate();
  const { authToken } = useAuth();
  const queryClient = useQueryClient();
  const [wireReference, setWireReference] = useState('');

  const capitalCallQuery = useQuery({
    queryKey: ['lp-capital-call', dealId, callId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/capital-calls/${callId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch capital call');
      return res.json();
    },
    enabled: !!dealId && !!callId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Capital call load failed', { message: error?.message, dealId, callId });
    }
  });

  const markWireMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/capital-calls/${callId}/wire-initiated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ wireReference: wireReference || undefined })
      });
      if (!res.ok) throw new Error('Failed to mark wire initiated');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['lp-capital-call', dealId, callId]);
      queryClient.invalidateQueries(['lp-capital-calls', dealId]);
    }
  });

  const capitalCall = capitalCallQuery.data?.capitalCall;
  const myAllocation = capitalCallQuery.data?.myAllocation;

  const isOverdue = myAllocation?.status === 'PENDING' &&
    capitalCall?.dueDate && new Date(capitalCall.dueDate) < new Date();

  if (capitalCallQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading capital call...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (capitalCallQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={capitalCallQuery.error} onRetry={capitalCallQuery.refetch} />
        </div>
      </LPLayout>
    );
  }

  if (!capitalCall) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Capital Call Not Found</h2>
            <p className="text-gray-500 mb-4">This capital call may not exist or you may not have access.</p>
            <Button onClick={() => navigate(`/investments/${dealId}/capital-calls`)}>
              Back to Capital Calls
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
          onClick={() => navigate(`/investments/${dealId}/capital-calls`)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to capital calls</span>
        </button>

        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{capitalCall.title}</h1>
            <p className="text-gray-500">{getPurposeLabel(capitalCall.purpose)}</p>
          </div>
          <Badge className={cn('text-sm', getStatusColor(isOverdue ? 'OVERDUE' : myAllocation?.status))}>
            {getStatusLabel(isOverdue ? 'OVERDUE' : myAllocation?.status)}
          </Badge>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Amount & Due Date */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Capital Call</h2>

              <div className="grid grid-cols-2 gap-6">
                <div>
                  <div className="text-sm text-gray-500 mb-1">Amount Due</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {formatCurrency(myAllocation?.amount)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-500 mb-1">Due Date</div>
                  <div className={cn(
                    "text-xl font-semibold",
                    isOverdue ? "text-red-600" : "text-gray-900"
                  )}>
                    {formatDate(capitalCall.dueDate)}
                  </div>
                  {isOverdue && (
                    <div className="text-sm text-red-600 mt-1">Overdue - please fund immediately</div>
                  )}
                </div>
              </div>

              {capitalCall.description && (
                <div className="mt-6 pt-6 border-t border-gray-100">
                  <div className="text-sm text-gray-500 mb-2">Description</div>
                  <p className="text-gray-700">{capitalCall.description}</p>
                </div>
              )}
            </div>

            {/* Wire Instructions */}
            {capitalCall.wireInstructions && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">Wire Instructions</h2>

                <div className="bg-gray-50 rounded-lg p-4">
                  {typeof capitalCall.wireInstructions === 'string' ? (
                    <pre className="text-sm whitespace-pre-wrap font-mono">{capitalCall.wireInstructions}</pre>
                  ) : (
                    <div className="space-y-1">
                      {capitalCall.wireInstructions.bankName && (
                        <CopyableField label="Bank Name" value={capitalCall.wireInstructions.bankName} />
                      )}
                      {capitalCall.wireInstructions.accountName && (
                        <CopyableField label="Account Name" value={capitalCall.wireInstructions.accountName} />
                      )}
                      {capitalCall.wireInstructions.accountNumber && (
                        <CopyableField label="Account Number" value={capitalCall.wireInstructions.accountNumber} />
                      )}
                      {capitalCall.wireInstructions.routingNumber && (
                        <CopyableField label="Routing Number" value={capitalCall.wireInstructions.routingNumber} />
                      )}
                      {capitalCall.wireInstructions.reference && (
                        <CopyableField label="Reference" value={capitalCall.wireInstructions.reference} />
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Funding Status */}
            {myAllocation?.status === 'FUNDED' && (
              <div className="bg-green-50 rounded-xl border border-green-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <CheckCircle2 className="w-8 h-8 text-green-600" />
                  <div>
                    <h2 className="text-lg font-semibold text-green-900">Funding Complete</h2>
                    <p className="text-green-700">Thank you for your contribution</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-green-600">Amount Funded</div>
                    <div className="font-semibold text-green-900">
                      {formatCurrency(myAllocation.fundedAmount || myAllocation.amount)}
                    </div>
                  </div>
                  <div>
                    <div className="text-green-600">Funded On</div>
                    <div className="font-semibold text-green-900">
                      {formatDate(myAllocation.fundedAt)}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Wire Initiated Status */}
            {myAllocation?.status === 'WIRE_INITIATED' && (
              <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="w-8 h-8 text-blue-600" />
                  <div>
                    <h2 className="text-lg font-semibold text-blue-900">Wire Pending Confirmation</h2>
                    <p className="text-blue-700">Your wire has been sent and is awaiting confirmation</p>
                  </div>
                </div>
                {myAllocation.wireReference && (
                  <div className="text-sm">
                    <div className="text-blue-600">Wire Reference</div>
                    <div className="font-mono text-blue-900">{myAllocation.wireReference}</div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Sidebar - Actions */}
          <div className="space-y-6">
            {/* Action Card */}
            {myAllocation?.status === 'PENDING' && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Mark Wire Sent</h3>
                <p className="text-sm text-gray-500 mb-4">
                  After sending your wire transfer, mark it here so we can track your funding status.
                </p>

                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-gray-700 mb-1 block">
                      Wire Reference (optional)
                    </label>
                    <Input
                      placeholder="e.g., Wire confirmation number"
                      value={wireReference}
                      onChange={(e) => setWireReference(e.target.value)}
                    />
                  </div>

                  <Button
                    className="w-full"
                    onClick={() => markWireMutation.mutate()}
                    disabled={markWireMutation.isPending}
                  >
                    {markWireMutation.isPending ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4 mr-2" />
                        Mark Wire Sent
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {/* Call Summary */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Call Summary</h3>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Total Call Amount</span>
                  <span className="font-medium">{formatCurrency(capitalCall.totalAmount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Your Share</span>
                  <span className="font-medium">{formatCurrency(myAllocation?.amount)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Issue Date</span>
                  <span className="font-medium">{formatDate(capitalCall.issuedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Due Date</span>
                  <span className={cn("font-medium", isOverdue && "text-red-600")}>
                    {formatDate(capitalCall.dueDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Documents */}
            {capitalCall.documentId && (
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="font-semibold text-gray-900 mb-4">Documents</h3>
                <button className="flex items-center gap-3 w-full p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                  <FileText className="w-5 h-5 text-gray-400" />
                  <div className="text-left">
                    <div className="text-sm font-medium text-gray-900">Capital Call Notice</div>
                    <div className="text-xs text-gray-500">PDF Document</div>
                  </div>
                </button>
              </div>
            )}

            {/* Need Help */}
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-2">Need Help?</h3>
              <p className="text-sm text-gray-500 mb-4">
                If you have questions about this capital call or need assistance, contact your GP.
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
