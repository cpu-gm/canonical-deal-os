import React from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Building2, FileText, DollarSign, TrendingUp, ChevronRight,
  Loader2, AlertCircle, Bell, Clock, Download, Settings,
  PieChart, Wallet, ArrowUpRight, ArrowDownRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDistanceToNow } from 'date-fns';
import DealLifecycleProgress from '@/components/lp/DealLifecycleProgress';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

// LP Portal API (token-based, no auth required)
const lpPortalApi = {
  validateSession: async (token) => {
    const res = await fetch(`${BFF_BASE}/api/lp/portal/session/${encodeURIComponent(token)}`);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw { status: res.status, data };
    }
    return res.json();
  },
  getPortfolio: async (email) => {
    const res = await fetch(`${BFF_BASE}/api/lp/portal`, {
      headers: { 'X-User-Id': email }
    });
    if (!res.ok) throw { status: res.status, data: await res.json() };
    return res.json();
  },
  getDocuments: async (dealId, lpActorId) => {
    const url = lpActorId
      ? `${BFF_BASE}/api/lp/documents/${dealId}?lpActorId=${lpActorId}`
      : `${BFF_BASE}/api/lp/documents/${dealId}`;
    const res = await fetch(url);
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
  return `${(value * 100).toFixed(1)}%`;
}

// Summary card component
function SummaryCard({ icon: Icon, label, value, subtext, trend }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-blue-50 rounded-lg">
          <Icon className="w-5 h-5 text-blue-600" />
        </div>
        <span className="text-sm text-gray-500 font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {subtext && (
        <div className="flex items-center gap-1 mt-1 text-sm">
          {trend === 'up' && <ArrowUpRight className="w-4 h-4 text-green-500" />}
          {trend === 'down' && <ArrowDownRight className="w-4 h-4 text-red-500" />}
          <span className={trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-600' : 'text-gray-500'}>
            {subtext}
          </span>
        </div>
      )}
    </div>
  );
}

// Investment card component
function InvestmentCard({ investment, lpActor, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-6 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
              {investment.name || 'Unnamed Investment'}
            </h3>
            {lpActor?.shareClass && (
              <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">
                {lpActor.shareClass.code || lpActor.shareClass.name}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500">{investment.asset_type || 'Real Estate'}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Commitment</div>
          <div className="font-semibold text-gray-900">{formatCurrency(lpActor?.commitment || 0)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide">Ownership</div>
          <div className="font-semibold text-gray-900">{formatPercent(lpActor?.ownershipPct || 0)}</div>
        </div>
      </div>

      <DealLifecycleProgress
        currentState={investment.status || 'INTAKE_RECEIVED'}
        size="sm"
      />

      {investment.key_notes && (
        <div className="mt-3 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
          {investment.key_notes}
        </div>
      )}
    </div>
  );
}

// Activity feed item
function ActivityItem({ activity }) {
  const icons = {
    CAPITAL_CALL: Wallet,
    DISTRIBUTION: DollarSign,
    DOCUMENT: FileText,
    MILESTONE: TrendingUp
  };
  const Icon = icons[activity.type] || Bell;

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className={`p-2 rounded-lg ${
        activity.type === 'DISTRIBUTION' ? 'bg-green-50' :
        activity.type === 'CAPITAL_CALL' ? 'bg-amber-50' :
        'bg-blue-50'
      }`}>
        <Icon className={`w-4 h-4 ${
          activity.type === 'DISTRIBUTION' ? 'text-green-600' :
          activity.type === 'CAPITAL_CALL' ? 'text-amber-600' :
          'text-blue-600'
        }`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900">{activity.message}</p>
        <p className="text-xs text-gray-500">{activity.dealName}</p>
      </div>
      <div className="text-xs text-gray-400 whitespace-nowrap">
        {activity.date ? formatDistanceToNow(new Date(activity.date), { addSuffix: true }) : ''}
      </div>
    </div>
  );
}

export default function LPPortal() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token');

  // Validate session from token
  const sessionQuery = useQuery({
    queryKey: ['lp-session', token],
    queryFn: () => lpPortalApi.validateSession(token),
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000 // 5 minutes
  });

  const lpEmail = sessionQuery.data?.lpActor?.email;
  const lpActorId = sessionQuery.data?.lpActor?.id;
  const investments = sessionQuery.data?.investments || [];

  // Fetch portfolio data
  const portfolioQuery = useQuery({
    queryKey: ['lp-portfolio', lpEmail],
    queryFn: () => lpPortalApi.getPortfolio(lpEmail),
    enabled: !!lpEmail,
    staleTime: 30 * 1000
  });

  const handleInvestmentClick = (investment) => {
    navigate(`/LPInvestmentDetail?token=${encodeURIComponent(token)}&dealId=${investment.id}`);
  };

  // No token provided
  if (!token) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Portal Access Required</h1>
          <p className="text-gray-600">
            Please use the link from your email to access the LP Portal.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (sessionQuery.isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading your portal...</p>
        </div>
      </div>
    );
  }

  // Session error
  if (sessionQuery.error) {
    const status = sessionQuery.error?.status;
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-semibold text-gray-900 mb-2">
            {status === 401 ? 'Session Expired' : 'Access Error'}
          </h1>
          <p className="text-gray-600">
            {status === 401
              ? 'Your session has expired. Please request a new portal link.'
              : 'Unable to access the portal. Please contact your investment manager.'}
          </p>
        </div>
      </div>
    );
  }

  const portfolio = portfolioQuery.data;
  const summary = portfolio?.summary || {
    active_investments: investments.length,
    capital_committed: investments.reduce((sum, i) => sum + (i.commitment || 0), 0),
    capital_deployed: 0,
    distributions_ytd: 0
  };

  // Generate sample activity based on investments
  const recentActivity = [
    ...(investments.slice(0, 3).map((inv, i) => ({
      type: i === 0 ? 'DOCUMENT' : i === 1 ? 'MILESTONE' : 'CAPITAL_CALL',
      message: i === 0 ? 'Q4 2024 K-1 now available' : i === 1 ? 'Deal reached Due Diligence phase' : 'Capital call issued for $150,000',
      dealName: inv.entityName || 'Investment',
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString()
    })))
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-600 rounded-lg">
                <Building2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="font-semibold text-gray-900">LP Investor Portal</h1>
                <p className="text-xs text-gray-500">Canonical Capital</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-600">
                {sessionQuery.data?.lpActor?.entityName || 'Welcome'}
              </span>
              <Button variant="ghost" size="sm">
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Welcome back, {sessionQuery.data?.lpActor?.entityName || 'Investor'}
          </h2>
          <p className="text-gray-500 mt-1">
            Here's an overview of your investment portfolio
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            icon={PieChart}
            label="Active Investments"
            value={summary.active_investments}
            subtext={`${investments.length} deal${investments.length !== 1 ? 's' : ''}`}
          />
          <SummaryCard
            icon={Wallet}
            label="Total Committed"
            value={formatCurrency(summary.capital_committed)}
          />
          <SummaryCard
            icon={DollarSign}
            label="Capital Called"
            value={formatCurrency(summary.capital_deployed)}
            subtext={summary.capital_committed > 0
              ? `${((summary.capital_deployed / summary.capital_committed) * 100).toFixed(0)}% of commitment`
              : undefined
            }
          />
          <SummaryCard
            icon={TrendingUp}
            label="Distributions YTD"
            value={formatCurrency(summary.distributions_ytd)}
            trend={summary.distributions_ytd > 0 ? 'up' : undefined}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Investments list */}
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Your Investments</h3>
            </div>

            {investments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h4 className="font-medium text-gray-900 mb-2">No Active Investments</h4>
                <p className="text-sm text-gray-500">
                  You don't have any active investments yet. Contact your investment manager for more information.
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {investments.map((investment) => (
                  <InvestmentCard
                    key={investment.id}
                    investment={{
                      id: investment.dealId,
                      name: investment.entityName,
                      asset_type: 'Real Estate',
                      status: 'DD_ACTIVE', // Would come from deal data
                      key_notes: null
                    }}
                    lpActor={investment}
                    onClick={() => handleInvestmentClick({
                      id: investment.dealId,
                      ...investment
                    })}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Activity feed */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Recent Activity</h3>
                <Bell className="w-4 h-4 text-gray-400" />
              </div>

              {recentActivity.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No recent activity</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {recentActivity.map((activity, idx) => (
                    <ActivityItem key={idx} activity={activity} />
                  ))}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 mt-4">
              <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <Button variant="outline" className="w-full justify-start gap-2" size="sm">
                  <FileText className="w-4 h-4" />
                  View All Documents
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" size="sm">
                  <Download className="w-4 h-4" />
                  Download K-1s
                </Button>
                <Button variant="outline" className="w-full justify-start gap-2" size="sm">
                  <Settings className="w-4 h-4" />
                  Notification Settings
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-sm text-gray-500">
            Canonical Capital LP Portal • Questions? Contact your investment manager
          </p>
        </div>
      </footer>
    </div>
  );
}
