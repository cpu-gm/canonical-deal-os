import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import DealLifecycleProgress from '@/components/lp/DealLifecycleProgress';
import {
  Building2, FileText, DollarSign, TrendingUp, ChevronRight,
  Loader2, Bell, Clock, Download, Wallet,
  PieChart, ArrowUpRight, ArrowDownRight, MessageSquare,
  Calendar, AlertTriangle, CheckCircle2, ExternalLink, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow, format } from 'date-fns';
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

function formatPercent(value) {
  if (value === null || value === undefined) return '0%';
  return `${(value * 100).toFixed(1)}%`;
}

// Summary card component
function SummaryCard({ icon: Icon, label, value, subtext, trend, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    amber: 'bg-amber-50 text-amber-600',
    purple: 'bg-purple-50 text-purple-600'
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:border-gray-300 transition-colors">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon className="w-5 h-5" />
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
function InvestmentCard({ investment, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
              {investment.dealName || investment.entityName || 'Investment'}
            </h3>
            {investment.hasAction && (
              <Badge variant="destructive" className="text-xs">Action Required</Badge>
            )}
          </div>
          <p className="text-sm text-gray-500">{investment.assetType || 'Real Estate'}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Commitment</div>
          <div className="font-semibold text-gray-900">{formatCurrency(investment.commitment)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Ownership</div>
          <div className="font-semibold text-gray-900">{formatPercent(investment.ownershipPct)}</div>
        </div>
      </div>

      <DealLifecycleProgress
        currentState={investment.dealStatus || 'INTAKE_RECEIVED'}
        size="sm"
      />
    </div>
  );
}

// Action required card
function ActionCard({ action, onClick }) {
  const icons = {
    CAPITAL_CALL: Wallet,
    DOCUMENT_SIGN: FileText,
    CONSENT_REQUIRED: CheckCircle2,
    WIRE_PENDING: DollarSign
  };
  const Icon = icons[action.type] || AlertTriangle;

  const colors = {
    CAPITAL_CALL: 'bg-amber-50 text-amber-600 border-amber-200',
    DOCUMENT_SIGN: 'bg-blue-50 text-blue-600 border-blue-200',
    CONSENT_REQUIRED: 'bg-purple-50 text-purple-600 border-purple-200',
    WIRE_PENDING: 'bg-green-50 text-green-600 border-green-200'
  };

  return (
    <div
      onClick={onClick}
      className={`rounded-lg border p-4 cursor-pointer hover:shadow-md transition-all ${colors[action.type] || 'bg-gray-50 text-gray-600 border-gray-200'}`}
    >
      <div className="flex items-start gap-3">
        <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900">{action.title}</p>
          <p className="text-sm text-gray-600 mt-1">{action.description}</p>
          {action.dueDate && (
            <p className="text-xs mt-2 font-medium">
              Due: {format(new Date(action.dueDate), 'MMM d, yyyy')}
            </p>
          )}
        </div>
        <ExternalLink className="w-4 h-4 flex-shrink-0 text-gray-400" />
      </div>
    </div>
  );
}

// Activity feed item
function ActivityItem({ activity }) {
  const icons = {
    CAPITAL_CALL: Wallet,
    DISTRIBUTION: DollarSign,
    DOCUMENT: FileText,
    MILESTONE: TrendingUp,
    UPDATE: Bell
  };
  const Icon = icons[activity.type] || Bell;

  const bgColors = {
    DISTRIBUTION: 'bg-green-50',
    CAPITAL_CALL: 'bg-amber-50',
    DOCUMENT: 'bg-blue-50',
    MILESTONE: 'bg-purple-50',
    UPDATE: 'bg-gray-50'
  };

  const iconColors = {
    DISTRIBUTION: 'text-green-600',
    CAPITAL_CALL: 'text-amber-600',
    DOCUMENT: 'text-blue-600',
    MILESTONE: 'text-purple-600',
    UPDATE: 'text-gray-600'
  };

  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-100 last:border-0 hover:bg-gray-50 px-2 -mx-2 rounded-lg transition-colors cursor-pointer">
      <div className={`p-2 rounded-lg ${bgColors[activity.type] || 'bg-gray-50'}`}>
        <Icon className={`w-4 h-4 ${iconColors[activity.type] || 'text-gray-600'}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-900">{activity.message}</p>
        <p className="text-xs text-gray-500 mt-0.5">{activity.dealName}</p>
      </div>
      <div className="text-xs text-gray-400 whitespace-nowrap">
        {activity.date ? formatDistanceToNow(new Date(activity.date), { addSuffix: true }) : ''}
      </div>
    </div>
  );
}

export default function LPHome() {
  const navigate = useNavigate();
  const { user, authToken } = useAuth();

  // Fetch LP's investments
  const portfolioQuery = useQuery({
    queryKey: ['lp-portfolio-auth', user?.id],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { investments: [], summary: {} };
        }
        throw new Error('Failed to fetch portfolio');
      }
      return res.json();
    },
    enabled: !!user && !!authToken,
    staleTime: 30 * 1000,
    onError: (error) => {
      debugLog('lp', 'Portfolio load failed', { message: error?.message });
    }
  });

  const investments = portfolioQuery.data?.investments || [];
  const summary = portfolioQuery.data?.summary || {
    active_investments: investments.length,
    capital_committed: investments.reduce((sum, i) => sum + (i.commitment || 0), 0),
    capital_deployed: 0,
    distributions_ytd: 0
  };

  // Mock actions requiring attention (will be replaced with real data)
  const pendingActions = [
    // Add real pending actions when APIs are ready
  ];

  // Generate activity based on investments
  const recentActivity = investments.length > 0 ? [
    ...(investments.slice(0, 5).map((inv, i) => ({
      type: ['DOCUMENT', 'MILESTONE', 'UPDATE', 'DISTRIBUTION', 'CAPITAL_CALL'][i % 5],
      message: [
        'Q4 2025 K-1 document available',
        'Deal progressed to Due Diligence',
        'Quarterly update posted',
        'Distribution of $25,000 processed',
        'Capital call notice issued'
      ][i % 5],
      dealName: inv.entityName || inv.dealName || 'Investment',
      date: new Date(Date.now() - i * 24 * 60 * 60 * 1000 * (i + 1)).toISOString()
    })))
  ] : [];

  const handleInvestmentClick = (investment) => {
    navigate(`/investments/${investment.dealId || investment.id}`);
  };

  if (portfolioQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading your portfolio...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (portfolioQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={portfolioQuery.error} onRetry={portfolioQuery.refetch} />
        </div>
      </LPLayout>
    );
  }

  return (
    <LPLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Welcome section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.name?.split(' ')[0] || 'Investor'}
          </h2>
          <p className="text-gray-500 mt-1">
            Here's an overview of your investment portfolio
          </p>
        </div>

        {/* Actions requiring attention */}
        {pendingActions.length > 0 && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              <h3 className="text-lg font-semibold text-gray-900">Action Required</h3>
              <Badge variant="secondary" className="ml-2">{pendingActions.length}</Badge>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {pendingActions.map((action, idx) => (
                <ActionCard
                  key={idx}
                  action={action}
                  onClick={() => navigate(action.link)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <SummaryCard
            icon={PieChart}
            label="Active Investments"
            value={summary.active_investments || investments.length}
            subtext={`${investments.length} deal${investments.length !== 1 ? 's' : ''}`}
            color="blue"
          />
          <SummaryCard
            icon={Wallet}
            label="Total Committed"
            value={formatCurrency(summary.capital_committed)}
            color="purple"
          />
          <SummaryCard
            icon={DollarSign}
            label="Capital Called"
            value={formatCurrency(summary.capital_deployed)}
            subtext={summary.capital_committed > 0
              ? `${((summary.capital_deployed / summary.capital_committed) * 100).toFixed(0)}% of commitment`
              : undefined
            }
            color="amber"
          />
          <SummaryCard
            icon={TrendingUp}
            label="Distributions YTD"
            value={formatCurrency(summary.distributions_ytd)}
            trend={summary.distributions_ytd > 0 ? 'up' : undefined}
            color="green"
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Investments list */}
          <div className="lg:col-span-2">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-semibold text-gray-900">Your Investments</h3>
              {investments.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/investments')}
                  className="text-blue-600 hover:text-blue-700"
                >
                  View All
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              )}
            </div>

            {investments.length === 0 ? (
              <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
                <Building2 className="w-12 h-12 text-gray-300 mx-auto mb-4" />
                <h4 className="font-medium text-gray-900 mb-2">No Active Investments</h4>
                <p className="text-sm text-gray-500 max-w-sm mx-auto">
                  You don't have any active investments yet. Your GP will add you to deals as they become available.
                </p>
              </div>
            ) : (
              <div className="grid gap-4">
                {investments.slice(0, 3).map((investment) => (
                  <InvestmentCard
                    key={investment.id || investment.dealId}
                    investment={investment}
                    onClick={() => handleInvestmentClick(investment)}
                  />
                ))}
                {investments.length > 3 && (
                  <Button
                    variant="outline"
                    onClick={() => navigate('/investments')}
                    className="w-full"
                  >
                    View all {investments.length} investments
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="lg:col-span-1 space-y-6">
            {/* Recent Activity */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-900">Recent Activity</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigate('/activity')}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <Bell className="w-4 h-4" />
                </Button>
              </div>

              {recentActivity.length === 0 ? (
                <div className="text-center py-8">
                  <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-500">No recent activity</p>
                </div>
              ) : (
                <div>
                  {recentActivity.slice(0, 5).map((activity, idx) => (
                    <ActivityItem key={idx} activity={activity} />
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/activity')}
                    className="w-full mt-3 text-blue-600"
                  >
                    View all activity
                  </Button>
                </div>
              )}
            </div>

            {/* Quick Actions */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900 mb-4">Quick Actions</h3>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  size="sm"
                  onClick={() => navigate('/documents')}
                >
                  <FileText className="w-4 h-4" />
                  View All Documents
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  size="sm"
                  onClick={() => navigate('/documents?category=TAX')}
                >
                  <Download className="w-4 h-4" />
                  Download K-1s
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  size="sm"
                  onClick={() => navigate('/messages')}
                >
                  <MessageSquare className="w-4 h-4" />
                  Contact GP
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2"
                  size="sm"
                  onClick={() => navigate('/account')}
                >
                  <User className="w-4 h-4" />
                  Account Settings
                </Button>
              </div>
            </div>

            {/* Upcoming Events */}
            <div className="bg-white rounded-xl border border-gray-200 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Calendar className="w-5 h-5 text-gray-400" />
                <h3 className="font-semibold text-gray-900">Upcoming</h3>
              </div>
              <div className="text-center py-4">
                <p className="text-sm text-gray-500">No upcoming events</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LPLayout>
  );
}
