import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import {
  Building2, FileText, DollarSign, TrendingUp, ChevronLeft,
  Loader2, AlertCircle, Download, Clock, MessageSquare,
  Wallet, ArrowUpRight, ArrowDownRight, CheckCircle,
  Info, FolderOpen, LogOut
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatDistanceToNow, format } from 'date-fns';
import DealLifecycleProgress, { DEAL_LIFECYCLE_STATES, getStateIndex } from '@/components/lp/DealLifecycleProgress';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

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
  return `${(value * 100).toFixed(1)}%`;
}

// Overview Tab Component
function OverviewTab({ deal, lpActor }) {
  return (
    <div className="space-y-6">
      {/* Property info */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Property Information</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Asset Type</div>
            <div className="font-medium text-gray-900">{deal.asset_type || 'Real Estate'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Status</div>
            <div className="font-medium text-gray-900">{deal.status || 'Active'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Last Update</div>
            <div className="font-medium text-gray-900">
              {deal.last_update ? formatDistanceToNow(new Date(deal.last_update), { addSuffix: true }) : '—'}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Lifecycle Stage</div>
            <div className="font-medium text-gray-900">{getStateIndex(deal.status) + 1} of 16</div>
          </div>
        </div>
      </div>

      {/* Your position */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Your Position</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Entity</div>
            <div className="font-medium text-gray-900">{deal.ownership?.entity || lpActor?.entityName || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Commitment</div>
            <div className="font-semibold text-gray-900 text-lg">
              {formatCurrency(deal.ownership?.commitment || lpActor?.commitment)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Ownership</div>
            <div className="font-semibold text-gray-900 text-lg">
              {formatPercent((deal.ownership?.ownership_pct || lpActor?.ownershipPct) / 100)}
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-500 uppercase tracking-wide">Effective Date</div>
            <div className="font-medium text-gray-900">
              {deal.ownership?.effective_date ? format(new Date(deal.ownership.effective_date), 'MMM d, yyyy') : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Lifecycle progress */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Deal Lifecycle</h3>
        <DealLifecycleProgress
          currentState={deal.status || 'INTAKE_RECEIVED'}
          size="md"
          compact={false}
          showLabels={true}
        />
      </div>

      {/* Key insights */}
      {deal.key_notes && (
        <div className="bg-blue-50 rounded-xl border border-blue-200 p-6">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-medium text-blue-900 mb-1">Key Insights</h4>
              <p className="text-blue-800">{deal.key_notes}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Documents Tab Component
function DocumentsTab({ documents, isLoading }) {
  const categoryIcons = {
    TAX: DollarSign,
    LEGAL: FileText,
    FINANCIAL: TrendingUp,
    PRESENTATION: Building2,
    CLOSING: CheckCircle
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
      </div>
    );
  }

  const categories = documents?.documents || {};
  const hasDocuments = Object.values(categories).some(cat => cat.documents?.length > 0);

  if (!hasDocuments) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <FolderOpen className="w-12 h-12 text-gray-300 mx-auto mb-4" />
        <h4 className="font-medium text-gray-900 mb-2">No Documents Available</h4>
        <p className="text-sm text-gray-500">
          Documents will appear here once they are uploaded by your investment manager.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {Object.entries(categories).map(([categoryId, category]) => {
        if (!category.documents?.length) return null;
        const Icon = categoryIcons[categoryId] || FileText;

        return (
          <div key={categoryId} className="bg-white rounded-xl border border-gray-200">
            <div className="p-4 border-b border-gray-100 flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Icon className="w-4 h-4 text-gray-600" />
              </div>
              <h3 className="font-semibold text-gray-900">{category.label}</h3>
              <span className="text-sm text-gray-500">({category.documents.length})</span>
            </div>
            <div className="divide-y divide-gray-100">
              {category.documents.map((doc) => (
                <div key={doc.id} className="p-4 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex items-center gap-3">
                    <FileText className="w-5 h-5 text-gray-400" />
                    <div>
                      <div className="font-medium text-gray-900">{doc.filename}</div>
                      <div className="text-xs text-gray-500">
                        {doc.year && `${doc.year}`}
                        {doc.quarter && ` Q${doc.quarter}`}
                        {' • '}
                        {formatDistanceToNow(new Date(doc.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                  </div>
                  {doc.canDownload && (
                    <Button variant="ghost" size="sm">
                      <Download className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Capital Tab Component
function CapitalTab({ deal, lpActor }) {
  const capitalEvents = deal.capital_events || [];
  const performance = deal.performance || {};

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Committed</div>
          <div className="text-xl font-bold text-gray-900">
            {formatCurrency(lpActor?.commitment || deal.ownership?.commitment)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Called</div>
          <div className="text-xl font-bold text-gray-900">
            {formatCurrency(performance.cash_in || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Distributed</div>
          <div className="text-xl font-bold text-green-600">
            {formatCurrency(performance.cash_out || 0)}
          </div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Net Position</div>
          <div className="text-xl font-bold text-gray-900">
            {formatCurrency(performance.net_invested || 0)}
          </div>
        </div>
      </div>

      {/* Capital activity timeline */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Capital Activity</h3>
        </div>
        {capitalEvents.length === 0 ? (
          <div className="p-8 text-center">
            <Wallet className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-sm text-gray-500">No capital activity yet</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {capitalEvents.map((event) => (
              <div key={event.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    event.type === 'DISTRIBUTION' ? 'bg-green-100' :
                    event.type === 'CALL' ? 'bg-amber-100' :
                    'bg-blue-100'
                  }`}>
                    {event.type === 'DISTRIBUTION' ? (
                      <ArrowDownRight className="w-4 h-4 text-green-600" />
                    ) : (
                      <ArrowUpRight className="w-4 h-4 text-amber-600" />
                    )}
                  </div>
                  <div>
                    <div className="font-medium text-gray-900">
                      {event.type === 'DISTRIBUTION' ? 'Distribution' :
                       event.type === 'CALL' ? 'Capital Call' : 'Return'}
                    </div>
                    <div className="text-xs text-gray-500">
                      {event.date ? format(new Date(event.date), 'MMM d, yyyy') : '—'}
                      {event.description && ` • ${event.description}`}
                    </div>
                  </div>
                </div>
                <div className={`text-lg font-semibold ${
                  event.type === 'DISTRIBUTION' ? 'text-green-600' : 'text-gray-900'
                }`}>
                  {event.type === 'DISTRIBUTION' ? '+' : ''}{formatCurrency(event.amount)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// AI Insights Tab Component
function AIInsightsTab({ deal }) {
  const [question, setQuestion] = useState('');

  return (
    <div className="space-y-6">
      {/* Chat interface placeholder */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Ask About This Investment</h3>
        <div className="flex gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g., What is the current loan-to-value ratio?"
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          <Button>Ask</Button>
        </div>
        <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm text-gray-600">
          <MessageSquare className="w-4 h-4 inline mr-2" />
          AI-powered insights coming soon. Ask questions about your investment, performance metrics, or deal documents.
        </div>
      </div>

      {/* Sample insights */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Investment Summary</h3>
        <div className="prose prose-sm max-w-none text-gray-600">
          <p>
            This investment is currently in the <strong>{deal.status || 'active'}</strong> phase.
            Your total commitment of {formatCurrency(deal.ownership?.commitment)} represents a
            {' '}{formatPercent((deal.ownership?.ownership_pct || 0) / 100)} ownership stake.
          </p>
          {deal.performance && (
            <p>
              To date, {formatCurrency(deal.performance.cash_in || 0)} has been called and
              {' '}{formatCurrency(deal.performance.cash_out || 0)} has been distributed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// Timeline Tab Component
function TimelineTab({ deal }) {
  const stateIndex = getStateIndex(deal.status || 'INTAKE_RECEIVED');

  return (
    <div className="space-y-6">
      {/* Lifecycle visualization */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="font-semibold text-gray-900 mb-4">Deal Lifecycle</h3>
        <DealLifecycleProgress
          currentState={deal.status || 'INTAKE_RECEIVED'}
          size="lg"
          compact={false}
          showLabels={true}
        />
      </div>

      {/* State history */}
      <div className="bg-white rounded-xl border border-gray-200">
        <div className="p-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Stage History</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {DEAL_LIFECYCLE_STATES.slice(0, stateIndex + 1).reverse().map((state, idx) => {
            const isCurrent = idx === 0;
            return (
              <div key={state.id} className="p-4 flex items-start gap-3">
                <div className={`p-2 rounded-full ${isCurrent ? 'bg-blue-100' : 'bg-gray-100'}`}>
                  {isCurrent ? (
                    <Clock className="w-4 h-4 text-blue-600" />
                  ) : (
                    <CheckCircle className="w-4 h-4 text-green-600" />
                  )}
                </div>
                <div className="flex-1">
                  <div className={`font-medium ${isCurrent ? 'text-blue-900' : 'text-gray-900'}`}>
                    {state.label}
                  </div>
                  <div className="text-xs text-gray-500">
                    {isCurrent ? 'Current stage' : 'Completed'}
                  </div>
                </div>
                <div className="text-xs text-gray-400">
                  Stage {stateIndex - idx + 1}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Main component - Authenticated version
export default function LPInvestmentDetailAuth() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, authToken, logout } = useAuth();
  const dealId = searchParams.get('dealId');

  // Fetch deal detail via authenticated API
  const detailQuery = useQuery({
    queryKey: ['lp-investment-detail-auth', dealId, user?.id],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        // Return mock data if endpoint doesn't exist yet
        if (res.status === 404) {
          return {
            deal: {
              name: 'Investment',
              status: 'DD_ACTIVE',
              asset_type: 'Real Estate'
            },
            lpActor: {}
          };
        }
        throw new Error('Failed to fetch investment detail');
      }
      return res.json();
    },
    enabled: !!dealId && !!user && !!authToken,
    staleTime: 30 * 1000
  });

  // Fetch documents via authenticated API
  const documentsQuery = useQuery({
    queryKey: ['lp-documents-auth', dealId, user?.id],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/documents`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 404) return { documents: {} };
        throw new Error('Failed to fetch documents');
      }
      return res.json();
    },
    enabled: !!dealId && !!user && !!authToken,
    staleTime: 60 * 1000
  });

  const handleBack = () => {
    navigate('/');
  };

  const handleLogout = () => {
    logout(false);
    window.location.href = '/Login';
  };

  // Error states
  if (!dealId) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Invalid Access</h1>
          <p className="text-gray-600">No deal ID provided.</p>
          <Button className="mt-4" onClick={handleBack}>Go Back</Button>
        </div>
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading investment details...</p>
        </div>
      </div>
    );
  }

  const deal = detailQuery.data?.deal || {
    name: 'Investment',
    status: 'DD_ACTIVE',
    asset_type: 'Real Estate'
  };
  const lpActor = detailQuery.data?.lpActor || {};

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center h-16 gap-4">
            <Button variant="ghost" size="sm" onClick={handleBack}>
              <ChevronLeft className="w-4 h-4 mr-1" />
              Back to Portfolio
            </Button>
            <div className="flex-1">
              <h1 className="font-semibold text-gray-900">{deal.name || 'Investment Detail'}</h1>
              <p className="text-xs text-gray-500">{deal.asset_type}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">{user?.name}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
            <TabsTrigger value="capital">Capital</TabsTrigger>
            <TabsTrigger value="insights">AI Insights</TabsTrigger>
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewTab deal={deal} lpActor={lpActor} />
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab
              documents={documentsQuery.data}
              isLoading={documentsQuery.isLoading}
            />
          </TabsContent>

          <TabsContent value="capital">
            <CapitalTab deal={deal} lpActor={lpActor} />
          </TabsContent>

          <TabsContent value="insights">
            <AIInsightsTab deal={deal} />
          </TabsContent>

          <TabsContent value="timeline">
            <TimelineTab deal={deal} />
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
