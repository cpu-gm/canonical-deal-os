import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useRole } from '../Layout';
import { bff } from '@/api/bffClient';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  Plus,
  Calculator,
  Send,
  Briefcase,
  BarChart3,
  Shield,
  Check,
  FileText,
  Upload,
  Folder,
  Newspaper,
  ExternalLink,
  MessageSquare,
  Loader2,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  Building2,
  Scale,
  Mail,
  FileCheck,
  Eye,
  Hourglass
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import ActivityFeed from '@/components/ActivityFeed';

// Icon mapping for quick starts
const iconMap = {
  plus: Plus,
  calculator: Calculator,
  send: Send,
  briefcase: Briefcase,
  chart: BarChart3,
  shield: Shield,
  check: Check,
  file: FileText,
  upload: Upload,
  folder: Folder
};

// Status colors for decision cards
const statusColors = {
  urgent: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: 'text-red-600',
    badge: 'bg-red-100 text-red-700'
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: 'text-amber-600',
    badge: 'bg-amber-100 text-amber-700'
  },
  ready: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: 'text-green-600',
    badge: 'bg-green-100 text-green-700'
  }
};

// Impact icons for news
const impactIcons = {
  positive: { icon: TrendingUp, color: 'text-green-600' },
  negative: { icon: TrendingDown, color: 'text-red-600' },
  neutral: { icon: Minus, color: 'text-slate-500' }
};

function DecisionCard({ card }) {
  const colors = statusColors[card.status] || statusColors.ready;
  const StatusIcon = card.status === 'urgent' ? AlertTriangle :
                     card.status === 'warning' ? AlertCircle : CheckCircle2;

  return (
    <Link
      to={createPageUrl(`DealOverview?id=${card.dealId}`)}
      className={cn(
        "block p-4 rounded-xl border transition-all duration-200 hover:shadow-md",
        colors.bg,
        colors.border
      )}
    >
      <div className="flex items-start gap-3">
        <StatusIcon className={cn("w-5 h-5 mt-0.5 flex-shrink-0", colors.icon)} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-[#171717] truncate">{card.dealName}</h3>
            <Badge className={cn("text-xs", colors.badge)}>
              {card.status === 'urgent' ? 'Blocked' :
               card.status === 'warning' ? 'Attention' : 'Ready'}
            </Badge>
          </div>
          <p className="text-sm text-[#737373] mb-2 line-clamp-2">{card.summary}</p>
          {card.consequence && (
            <p className="text-xs text-[#A3A3A3] mb-3">{card.consequence}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" className="h-7 text-xs">
              {card.primaryAction?.label || 'Review'}
            </Button>
            {card.secondaryActions?.map((action, i) => (
              <Button key={i} size="sm" variant="outline" className="h-7 text-xs">
                {action.label}
              </Button>
            ))}
          </div>
        </div>
        <ChevronRight className="w-5 h-5 text-[#A3A3A3] flex-shrink-0" />
      </div>
    </Link>
  );
}

function ChangeFeedItem({ change }) {
  const severityIcon = {
    critical: { icon: AlertTriangle, color: 'text-red-600' },
    warning: { icon: AlertCircle, color: 'text-amber-500' },
    info: { icon: CheckCircle2, color: 'text-green-600' }
  };

  const { icon: Icon, color } = severityIcon[change.severity] || severityIcon.info;
  const timeAgo = formatTimeAgo(change.timestamp);

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className={cn("w-4 h-4 mt-0.5 flex-shrink-0", color)} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-[#171717]">
          <Link
            to={createPageUrl(`DealOverview?id=${change.dealId}`)}
            className="font-medium hover:underline"
          >
            {change.dealName}
          </Link>
          {' — '}{change.summary}
        </p>
        <p className="text-xs text-[#A3A3A3]">{timeAgo}</p>
      </div>
    </div>
  );
}

function QuickStartButton({ item, href }) {
  const Icon = iconMap[item.icon] || Plus;

  return (
    <Link
      to={href || '#'}
      className="flex items-center gap-3 p-3 rounded-lg border border-[#E5E5E5] bg-white hover:border-[#171717] hover:shadow-sm transition-all duration-200"
    >
      <div className="w-8 h-8 rounded-lg bg-[#F5F5F5] flex items-center justify-center">
        <Icon className="w-4 h-4 text-[#737373]" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#171717]">{item.label}</p>
        {item.description && (
          <p className="text-xs text-[#A3A3A3] truncate">{item.description}</p>
        )}
      </div>
      <ChevronRight className="w-4 h-4 text-[#A3A3A3]" />
    </Link>
  );
}

function TruthBar({ truthBar, prominent = false }) {
  if (!truthBar) return null;

  const items = [
    { label: 'stale data', count: truthBar.staleDataCount, color: 'text-amber-600', icon: Clock },
    { label: 'overrides', count: truthBar.unresolvedOverrides, color: 'text-orange-600', icon: AlertCircle },
    { label: 'disputed', count: truthBar.disputedDocuments, color: 'text-red-600', icon: AlertTriangle }
  ];

  const totalIssues = items.reduce((sum, item) => sum + (item.count || 0), 0);
  const hasIssues = totalIssues > 0;

  // Prominent version for top of page
  if (prominent) {
    if (!hasIssues) {
      return (
        <div className="flex items-center gap-3 px-4 py-3 bg-green-50 border border-green-200 rounded-xl mb-6">
          <CheckCircle2 className="w-5 h-5 text-green-600" />
          <div className="flex-1">
            <span className="text-sm font-medium text-green-800">Data Quality: All Clear</span>
            <span className="text-xs text-green-600 ml-2">No stale data, overrides, or disputes</span>
          </div>
        </div>
      );
    }

    return (
      <div className="flex items-center gap-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl mb-6">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <div className="flex-1">
          <span className="text-sm font-medium text-amber-800">Data Quality Issues ({totalIssues})</span>
          <div className="flex items-center gap-4 mt-1">
            {items.map((item, i) => {
              const Icon = item.icon;
              return (
                <span key={i} className={cn(
                  "flex items-center gap-1 text-xs font-medium",
                  item.count > 0 ? item.color : "text-[#A3A3A3]"
                )}>
                  <Icon className="w-3 h-3" />
                  {item.count} {item.label}
                </span>
              );
            })}
          </div>
        </div>
        <Link
          to={createPageUrl('Deals')}
          className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
        >
          Review Issues
        </Link>
      </div>
    );
  }

  // Compact footer version (legacy)
  return (
    <div className="flex items-center gap-4 px-4 py-2 bg-slate-50 border-t border-[#E5E5E5] text-xs">
      <span className="text-[#737373] font-medium">TRUTH BAR:</span>
      {items.map((item, i) => (
        <span key={i} className={cn("font-medium", item.count > 0 ? item.color : "text-[#A3A3A3]")}>
          {item.count} {item.label}
        </span>
      ))}
    </div>
  );
}

function NewsInsightCard({ insight, onAsk, onDismiss, isAsking }) {
  const [question, setQuestion] = useState('');
  const [showAskInput, setShowAskInput] = useState(false);
  const [answer, setAnswer] = useState(null);

  const { icon: ImpactIcon, color: impactColor } = impactIcons[insight.impact] || impactIcons.neutral;
  const timeAgo = formatTimeAgo(insight.publishedAt);

  const handleAsk = async () => {
    if (!question.trim()) return;
    const result = await onAsk(insight.id, question);
    if (result?.answer) {
      setAnswer(result);
      setQuestion('');
      setShowAskInput(false);
    }
  };

  return (
    <div className="p-4 rounded-xl border border-[#E5E5E5] bg-white hover:border-[#D4D4D4] transition-colors">
      <div className="flex items-start gap-3">
        <Newspaper className="w-5 h-5 text-violet-500 mt-0.5 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h3 className="font-semibold text-[#171717] text-sm">{insight.headline}</h3>
            <button
              onClick={() => onDismiss(insight.id)}
              className="p-1 hover:bg-slate-100 rounded"
            >
              <X className="w-4 h-4 text-[#A3A3A3]" />
            </button>
          </div>

          <p className="text-sm text-[#737373] mb-2">{insight.summary}</p>

          {insight.roleSpecificInsight && (
            <div className="bg-violet-50 rounded-lg p-3 mb-3">
              <p className="text-sm text-violet-900">{insight.roleSpecificInsight}</p>
            </div>
          )}

          {answer && (
            <div className="bg-blue-50 rounded-lg p-3 mb-3 border border-blue-100">
              <p className="text-sm text-blue-900 mb-2">{answer.answer}</p>
              {answer.sources?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {answer.sources.map((s, i) => (
                    <span key={i} className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                      {s.reference}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 text-xs text-[#A3A3A3]">
            <div className="flex items-center gap-1">
              <ImpactIcon className={cn("w-3 h-3", impactColor)} />
              <span className="capitalize">{insight.impact}</span>
            </div>
            <span>•</span>
            <a
              href={insight.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 hover:text-[#171717]"
            >
              {insight.source}
              <ExternalLink className="w-3 h-3" />
            </a>
            <span>•</span>
            <span>{timeAgo}</span>
          </div>

          <div className="flex items-center gap-2 mt-3">
            {showAskInput ? (
              <div className="flex-1 flex gap-2">
                <Input
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="Ask a follow-up question..."
                  className="h-8 text-sm"
                  onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                />
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleAsk}
                  disabled={isAsking || !question.trim()}
                >
                  {isAsking ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Ask'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-8"
                  onClick={() => setShowAskInput(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => setShowAskInput(true)}
                >
                  <MessageSquare className="w-3 h-3 mr-1" />
                  Tell me more
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatTimeAgo(timestamp) {
  const now = new Date();
  const then = new Date(timestamp);
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return then.toLocaleDateString();
}

// =============================================================================
// LENDER HOME COMPONENT
// "Risk-aware exposure console"
// =============================================================================

function LenderHome({ homeData, newsData, handleAsk, handleDismiss, askMutation, newsLoading }) {
  const { currentRole } = useRole();

  // Mock data for demo - in production this comes from homeData
  const exposure = homeData?.exposure || { dealCount: 3, totalOutstanding: 127500000 };
  const riskBuckets = homeData?.riskBuckets || { needsAttention: 1, monitoring: 1, stable: 1 };
  const dealList = homeData?.dealList || [];
  const riskSignals = homeData?.riskSignals || [];
  const actionsRequired = homeData?.actionsRequired || [];
  const changeFeed = homeData?.changeFeed || [];
  const insights = newsData?.insights || [];

  const formatCurrency = (value) => {
    if (value >= 1000000000) return `$${(value / 1000000000).toFixed(1)}B`;
    if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`;
    return `$${value.toLocaleString()}`;
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header - Exposure Summary */}
      <div className="bg-white border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-5 h-5 text-[#737373]" />
                <span className="text-sm text-[#737373]">Bank X — Credit Team</span>
              </div>
              <h1 className="text-2xl font-semibold text-[#171717]">
                Active Exposure: {exposure.dealCount} Deals · {formatCurrency(exposure.totalOutstanding)}
              </h1>
            </div>
            <Badge variant="outline" className="text-xs">
              {currentRole}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-8 py-6 space-y-8">

        {/* Risk Snapshot - Three Buckets */}
        <section>
          <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
            Risk Snapshot
          </h2>
          <div className="grid grid-cols-3 gap-4">
            <div className={cn(
              "bg-white rounded-xl border p-6 text-center",
              riskBuckets.needsAttention > 0 ? "border-red-200 bg-red-50" : "border-[#E5E5E5]"
            )}>
              <p className="text-3xl font-bold text-[#171717]">{riskBuckets.needsAttention}</p>
              <p className={cn(
                "text-sm font-medium mt-1",
                riskBuckets.needsAttention > 0 ? "text-red-700" : "text-[#737373]"
              )}>Needs Attention</p>
            </div>
            <div className={cn(
              "bg-white rounded-xl border p-6 text-center",
              riskBuckets.monitoring > 0 ? "border-amber-200 bg-amber-50" : "border-[#E5E5E5]"
            )}>
              <p className="text-3xl font-bold text-[#171717]">{riskBuckets.monitoring}</p>
              <p className={cn(
                "text-sm font-medium mt-1",
                riskBuckets.monitoring > 0 ? "text-amber-700" : "text-[#737373]"
              )}>Monitoring</p>
            </div>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 text-center">
              <p className="text-3xl font-bold text-[#171717]">{riskBuckets.stable}</p>
              <p className="text-sm font-medium text-green-700 mt-1">Stable</p>
            </div>
          </div>
        </section>

        {/* Deal List Table */}
        <section>
          <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
            Deal Portfolio
          </h2>
          <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
            <table className="w-full">
              <thead className="bg-[#F5F5F5]">
                <tr>
                  <th className="text-left text-xs font-semibold text-[#737373] uppercase tracking-wider px-4 py-3">Deal</th>
                  <th className="text-left text-xs font-semibold text-[#737373] uppercase tracking-wider px-4 py-3">Sponsor</th>
                  <th className="text-right text-xs font-semibold text-[#737373] uppercase tracking-wider px-4 py-3">Exposure</th>
                  <th className="text-center text-xs font-semibold text-[#737373] uppercase tracking-wider px-4 py-3">DSCR</th>
                  <th className="text-left text-xs font-semibold text-[#737373] uppercase tracking-wider px-4 py-3">Last Update</th>
                  <th className="text-left text-xs font-semibold text-[#737373] uppercase tracking-wider px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F5F5]">
                {dealList.length > 0 ? dealList.map((deal) => (
                  <tr key={deal.dealId} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-3">
                      <Link to={createPageUrl(`DealOverview?id=${deal.dealId}`)} className="font-medium text-[#171717] hover:underline">
                        {deal.dealName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#737373]">{deal.sponsor}</td>
                    <td className="px-4 py-3 text-sm text-[#171717] text-right font-medium">{formatCurrency(deal.exposure)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        "inline-flex items-center gap-1 text-sm font-medium",
                        deal.dscrStatus === 'warning' ? "text-amber-600" :
                        deal.dscrStatus === 'danger' ? "text-red-600" : "text-green-600"
                      )}>
                        {deal.dscrStatus === 'warning' && <AlertCircle className="w-3 h-3" />}
                        {deal.dscrStatus === 'danger' && <AlertTriangle className="w-3 h-3" />}
                        {deal.dscrStatus === 'healthy' && <CheckCircle2 className="w-3 h-3" />}
                        {deal.dscr?.toFixed(2)}x
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-[#A3A3A3]">{deal.lastUpdate}</td>
                    <td className="px-4 py-3">
                      {deal.actionRequired ? (
                        <Button size="sm" variant="outline" className="h-7 text-xs">
                          {deal.actionRequired.label}
                        </Button>
                      ) : (
                        <span className="text-sm text-[#A3A3A3]">—</span>
                      )}
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-sm text-[#A3A3A3]">
                      No deals in portfolio
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Two Column: Changes + Actions Required */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* What Changed */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Since Your Last Review
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              {changeFeed.length > 0 ? (
                <div className="divide-y divide-[#F5F5F5]">
                  {changeFeed.slice(0, 5).map((change) => (
                    <ChangeFeedItem key={change.id} change={change} />
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-800">No recent changes</p>
                    <p className="text-xs text-blue-600">Your deals have been stable since your last review</p>
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Decisions Required */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Your Decisions Required
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              {actionsRequired.length > 0 ? (
                <div className="space-y-3">
                  {actionsRequired.map((action, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-[#FAFAFA] rounded-lg">
                      <div>
                        <p className="text-sm font-medium text-[#171717]">{action.dealName}</p>
                        <p className="text-xs text-[#737373]">{action.summary}</p>
                      </div>
                      <Button size="sm" className="h-7 text-xs">
                        {action.actionLabel || 'Review'}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">All caught up!</p>
                    <p className="text-xs text-green-600">No pending decisions - your portfolio is in good standing</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Portfolio Risk Signals */}
        {riskSignals.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Portfolio Risk Signals
            </h2>
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <ul className="space-y-2">
                {riskSignals.map((signal, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-amber-900">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-600" />
                    {signal.message}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        )}

        {/* Recent Activity */}
        <section>
          <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
            Recent Activity
          </h2>
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-2">
            <ActivityFeed
              limit={6}
              onActivityClick={(activity) => {
                if (activity.dealId) {
                  window.location.href = createPageUrl(`DealOverview?id=${activity.dealId}`);
                }
              }}
            />
          </div>
        </section>

        {/* AI News & Insights (Credit Risk Focus) */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider">
              AI News & Insights — Credit Risk Focus
            </h2>
            {newsData?._mock && (
              <Badge variant="outline" className="text-xs text-violet-600 border-violet-200">
                Demo Data
              </Badge>
            )}
          </div>

          {newsLoading ? (
            <div className="h-40 bg-slate-100 rounded-xl animate-pulse" />
          ) : insights.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {insights.slice(0, 2).map((insight) => (
                <NewsInsightCard
                  key={insight.id}
                  insight={insight}
                  onAsk={handleAsk}
                  onDismiss={handleDismiss}
                  isAsking={askMutation?.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-8 text-center">
              <Newspaper className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
              <p className="text-sm font-medium text-[#737373]">No news insights yet</p>
              <p className="text-xs text-[#A3A3A3] mt-1">We'll surface relevant market news as it becomes available</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// COUNSEL HOME COMPONENT
// "Work obligation dashboard"
// =============================================================================

function CounselHome({ homeData, newsData, handleAsk, handleDismiss, askMutation, newsLoading }) {
  const { currentRole } = useRole();

  // Mock data for demo
  const firmName = homeData?.firmName || "Smith & Carter LLP";
  const openRequests = homeData?.openRequests || [];
  const inProgress = homeData?.inProgress || [];
  const teamActivity = homeData?.teamActivity || [];
  const emailStatus = homeData?.emailStatus || [];
  const allClear = homeData?.allClear ?? (openRequests.length === 0);

  const requestStatusColors = {
    draft_requested: { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', label: 'Draft Requested' },
    clarification_requested: { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', label: 'Clarification Needed' },
    review_pending: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', label: 'Review Pending' },
    urgent: { bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700', label: 'Urgent' }
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header - Firm & Role Framing */}
      <div className="bg-white border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Scale className="w-5 h-5 text-[#737373]" />
                <span className="text-lg font-semibold text-[#171717]">{firmName}</span>
                <span className="text-sm text-[#737373]">— External Counsel Workspace</span>
              </div>
              <p className="text-sm text-[#737373] italic">
                "You are participating as external legal counsel. Drafting and commentary only. No approval authority."
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              {currentRole}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-8 py-6 space-y-8">

        {/* All Clear State */}
        {allClear && (
          <section className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
            <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-green-800">No open requests.</h2>
            <p className="text-sm text-green-700 mt-1">We'll notify you if further input is needed.</p>
          </section>
        )}

        {/* Requests Requiring Attention */}
        {!allClear && openRequests.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Requests Requiring Attention
            </h2>
            <div className="space-y-4">
              {openRequests.map((req) => {
                const statusStyle = requestStatusColors[req.status] || requestStatusColors.review_pending;
                return (
                  <div key={req.id} className={cn("rounded-xl border p-5", statusStyle.bg, statusStyle.border)}>
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-[#171717]">
                          {req.dealName} — {req.matterType}
                        </h3>
                        <p className="text-sm text-[#737373] mt-0.5">
                          Requested by: {req.requestedBy} · <span className={cn("font-medium", statusStyle.text)}>{statusStyle.label}</span>
                          {req.dueDate && <span className="ml-2">· Due: {req.dueDate}</span>}
                        </p>
                      </div>
                      <FileText className="w-5 h-5 text-[#A3A3A3]" />
                    </div>
                    <p className="text-sm text-[#525252] mb-4">{req.summary}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Button size="sm" className="h-8 text-xs">
                        <Eye className="w-3 h-3 mr-1" />
                        Review documents
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 text-xs">
                        <Upload className="w-3 h-3 mr-1" />
                        Upload draft
                      </Button>
                      <Button size="sm" variant="ghost" className="h-8 text-xs">
                        <Mail className="w-3 h-3 mr-1" />
                        Email instead
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Two Column: In Progress + Team Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* In Progress / Waiting */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              In Progress / Awaiting Response
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              {inProgress.length > 0 ? (
                <div className="space-y-3">
                  {inProgress.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-3 py-2">
                      <Hourglass className="w-4 h-4 text-[#A3A3A3] mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm text-[#171717]">
                          <span className="font-medium">{item.dealName}</span> — {item.summary}
                        </p>
                        <p className="text-xs text-[#A3A3A3]">
                          Awaiting: {item.waitingOn}
                          {item.lastTouched && (
                            <span> · Last: {item.lastTouched.user}</span>
                          )}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#A3A3A3] py-4 text-center">
                  Nothing in progress
                </p>
              )}
            </div>
          </section>

          {/* Recent Activity */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Recent Activity
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-2">
              <ActivityFeed
                limit={6}
                onActivityClick={(activity) => {
                  if (activity.dealId) {
                    window.location.href = createPageUrl(`DealOverview?id=${activity.dealId}`);
                  }
                }}
              />
            </div>
          </section>
        </div>

        {/* Documents Sent by Email */}
        {emailStatus.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Documents Sent by Email
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              <div className="space-y-3">
                {emailStatus.map((email, idx) => (
                  <div key={idx} className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-3">
                      <Mail className="w-4 h-4 text-[#A3A3A3]" />
                      <div>
                        <p className="text-sm text-[#171717]">"{email.subject}"</p>
                        <p className="text-xs text-[#A3A3A3]">{email.deal} · {email.receivedAt}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className={cn(
                      "text-xs",
                      email.status === 'confirmed' ? "text-green-600 border-green-200" : "text-amber-600 border-amber-200"
                    )}>
                      {email.status === 'confirmed' ? 'Confirmed' : 'Pending Confirmation'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* AI News (Legal Focus) - Optional, minimal */}
        {newsData?.insights?.length > 0 && !newsLoading && (
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider">
                Regulatory & Legal Updates
              </h2>
              {newsData?._mock && (
                <Badge variant="outline" className="text-xs text-violet-600 border-violet-200">
                  Demo Data
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4">
              {newsData.insights.slice(0, 1).map((insight) => (
                <NewsInsightCard
                  key={insight.id}
                  insight={insight}
                  onAsk={handleAsk}
                  onDismiss={handleDismiss}
                  isAsking={askMutation?.isPending}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// GP ANALYST HOME COMPONENT
// "Task-focused analyst dashboard - assigned deals only"
// =============================================================================

function GPAnalystHome({ homeData, newsData, handleAsk, handleDismiss, askMutation, newsLoading }) {
  const { currentRole } = useRole();

  // GP Analyst sees only assigned deals
  const assignedDeals = homeData?.assignedDeals || [];
  const myTasks = homeData?.myTasks || [];
  const dataQualityIssues = homeData?.dataQualityIssues || [];
  const pendingReviews = homeData?.pendingReviews || [];

  const greeting = homeData?.greeting || `Good ${getTimeOfDay()}`;

  const taskStatusColors = {
    OPEN: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'Open' },
    IN_PROGRESS: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'In Progress' },
    DONE: { bg: 'bg-green-50', text: 'text-green-700', label: 'Done' },
    BLOCKED: { bg: 'bg-red-50', text: 'text-red-700', label: 'Blocked' }
  };

  const priorityColors = {
    LOW: 'text-slate-500',
    MEDIUM: 'text-blue-600',
    HIGH: 'text-amber-600',
    URGENT: 'text-red-600'
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header - Analyst Dashboard */}
      <div className="bg-white border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#171717]">{greeting}</h1>
              <p className="text-sm text-[#737373] mt-1">
                Analyst Dashboard — {assignedDeals.length} assigned {assignedDeals.length === 1 ? 'deal' : 'deals'}
              </p>
            </div>
            <Badge variant="outline" className="text-xs bg-teal-50 text-teal-700 border-teal-200">
              {currentRole}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-8 py-6 space-y-8">

        {/* Empty State: No Assigned Deals */}
        {assignedDeals.length === 0 && (
          <section className="bg-slate-50 border border-slate-200 rounded-xl p-8 text-center">
            <Briefcase className="w-12 h-12 text-slate-400 mx-auto mb-3" />
            <h2 className="text-lg font-semibold text-slate-700">No deals assigned yet</h2>
            <p className="text-sm text-slate-500 mt-1">
              A GP will assign you to deals when there's work to be done.
            </p>
          </section>
        )}

        {/* My Assigned Tasks */}
        {myTasks.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              My Tasks
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
              <div className="divide-y divide-[#F5F5F5]">
                {myTasks.slice(0, 8).map((task) => {
                  const statusStyle = taskStatusColors[task.status] || taskStatusColors.OPEN;
                  return (
                    <div key={task.id} className="p-4 hover:bg-[#FAFAFA] transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={cn(
                          "w-2 h-2 rounded-full mt-2 flex-shrink-0",
                          priorityColors[task.priority]?.replace('text-', 'bg-') || 'bg-slate-400'
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="font-medium text-[#171717] truncate">{task.title}</h3>
                            <Badge className={cn("text-xs", statusStyle.bg, statusStyle.text)}>
                              {statusStyle.label}
                            </Badge>
                          </div>
                          {task.dealName && (
                            <Link
                              to={createPageUrl(`DealOverview?id=${task.dealId}`)}
                              className="text-sm text-blue-600 hover:underline"
                            >
                              {task.dealName}
                            </Link>
                          )}
                          {task.description && (
                            <p className="text-sm text-[#737373] mt-1 line-clamp-2">{task.description}</p>
                          )}
                          {task.dueDate && (
                            <p className="text-xs text-[#A3A3A3] mt-2 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Due: {new Date(task.dueDate).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-[#A3A3A3] flex-shrink-0" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {/* Deals I'm Working On */}
        {assignedDeals.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Deals I'm Working On
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {assignedDeals.map((deal) => (
                <Link
                  key={deal.id}
                  to={createPageUrl(`DealOverview?id=${deal.id}`)}
                  className="block p-5 bg-white rounded-xl border border-[#E5E5E5] hover:border-[#A3A3A3] hover:shadow-sm transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-semibold text-[#171717]">{deal.name}</h3>
                      <p className="text-sm text-[#737373]">{deal.propertyType || 'Real Estate'}</p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {deal.phase || 'Active'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-[#A3A3A3]">
                    {deal.openTasks > 0 && (
                      <span className="flex items-center gap-1">
                        <FileCheck className="w-3 h-3" />
                        {deal.openTasks} open tasks
                      </span>
                    )}
                    {deal.dataIssues > 0 && (
                      <span className="flex items-center gap-1 text-amber-600">
                        <AlertCircle className="w-3 h-3" />
                        {deal.dataIssues} data issues
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Two Column: Data Quality + Pending Reviews */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Data Quality Issues */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Data Quality Issues
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              {dataQualityIssues.length > 0 ? (
                <div className="space-y-3">
                  {dataQualityIssues.slice(0, 5).map((issue, idx) => (
                    <div key={idx} className="flex items-start gap-3 p-3 bg-amber-50 rounded-lg border border-amber-100">
                      <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-[#171717]">{issue.fieldName}</p>
                        <p className="text-xs text-[#737373]">{issue.dealName} — {issue.reason}</p>
                      </div>
                      <Button size="sm" variant="outline" className="h-7 text-xs">
                        Fix
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <p className="text-sm text-green-700">All data fields are up to date</p>
                </div>
              )}
            </div>
          </section>

          {/* Pending Reviews from GP */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Awaiting GP Review
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
              {pendingReviews.length > 0 ? (
                <div className="space-y-3">
                  {pendingReviews.map((review, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-[#FAFAFA] rounded-lg">
                      <div className="flex items-center gap-3">
                        <Hourglass className="w-4 h-4 text-[#A3A3A3]" />
                        <div>
                          <p className="text-sm font-medium text-[#171717]">{review.dealName}</p>
                          <p className="text-xs text-[#737373]">{review.requestType}</p>
                        </div>
                      </div>
                      <p className="text-xs text-[#A3A3A3]">
                        Submitted {review.submittedAgo}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-3 p-4 bg-green-50 rounded-lg">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-800">Reviews cleared!</p>
                    <p className="text-xs text-green-600">All your submitted work has been reviewed</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Quick Actions */}
        <section>
          <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Link
              to={createPageUrl('CreateDeal')}
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-[#E5E5E5] hover:border-[#A3A3A3] hover:shadow-sm transition-all"
            >
              <Upload className="w-5 h-5 text-[#737373]" />
              <span className="text-sm font-medium text-[#171717]">Upload Document</span>
            </Link>
            <button
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-[#E5E5E5] hover:border-[#A3A3A3] hover:shadow-sm transition-all"
            >
              <FileText className="w-5 h-5 text-[#737373]" />
              <span className="text-sm font-medium text-[#171717]">Update Deal Field</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-[#E5E5E5] hover:border-[#A3A3A3] hover:shadow-sm transition-all"
            >
              <Send className="w-5 h-5 text-[#737373]" />
              <span className="text-sm font-medium text-[#171717]">Request GP Review</span>
            </button>
            <button
              className="flex flex-col items-center gap-2 p-4 bg-white rounded-xl border border-[#E5E5E5] hover:border-[#A3A3A3] hover:shadow-sm transition-all"
            >
              <Plus className="w-5 h-5 text-[#737373]" />
              <span className="text-sm font-medium text-[#171717]">Create Task</span>
            </button>
          </div>
        </section>

        {/* Recent Activity */}
        <section>
          <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
            Recent Activity
          </h2>
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-2">
            <ActivityFeed
              limit={6}
              onActivityClick={(activity) => {
                if (activity.dealId) {
                  window.location.href = createPageUrl(`DealOverview?id=${activity.dealId}`);
                }
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// GP HOME COMPONENT (existing, refactored into separate function)
// =============================================================================

function GPHome({ homeData, newsData, handleAsk, handleDismiss, askMutation, newsLoading, pendingReviews }) {
  const { currentRole } = useRole();

  const quickStartHrefs = {
    'create-deal': createPageUrl('CreateDeal'),
    'model-scenario': createPageUrl('Explain'),
    'lender-update': createPageUrl('AuditExport'),
    'ic-materials': createPageUrl('AuditExport'),
    'portfolio-review': createPageUrl('Deals'),
    'covenant-check': createPageUrl('Compliance'),
    'consent-queue': createPageUrl('Inbox'),
    'document-queue': createPageUrl('Inbox'),
    'upload-draft': createPageUrl('CreateDeal'),
    'matter-status': createPageUrl('Deals')
  };

  const greeting = homeData?.greeting || `Good ${getTimeOfDay()}`;
  const portfolioStatus = homeData?.portfolioStatus || 'Loading...';
  const decisionCards = homeData?.decisionCards || [];
  const changeFeed = homeData?.changeFeed || [];
  const quickStarts = homeData?.quickStarts || [];
  const truthBar = homeData?.truthBar;
  const insights = newsData?.insights || [];

  return (
    <div className="min-h-screen bg-[#FAFAFA]">
      {/* Header Section */}
      <div className="bg-white border-b border-[#E5E5E5]">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-[#171717]">{greeting}</h1>
              <p className="text-sm text-[#737373] mt-1">
                {homeData?.dayOfWeek} • {portfolioStatus}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {currentRole}
              </Badge>
              {homeData?.portfolioSummary && (
                <Badge variant="secondary" className="text-xs">
                  {homeData.portfolioSummary.totalDeals} deals
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-8 py-6 space-y-8">

        {/* Truth Bar - Prominent Position */}
        <TruthBar truthBar={truthBar} prominent />

        {/* Decisions & Actions Section */}
        {decisionCards.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Decisions & Actions — Today
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {decisionCards.map((card) => (
                <DecisionCard key={card.dealId} card={card} />
              ))}
            </div>
          </section>
        )}

        {/* Analyst Review Requests Section */}
        {pendingReviews?.requests?.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Analyst Review Requests
            </h2>
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-4">
              <div className="space-y-3">
                {pendingReviews.requests.map((review) => (
                  <Link
                    key={review.id}
                    to={createPageUrl(`DealOverview?id=${review.dealId}`)}
                    className="flex items-start gap-3 p-3 bg-white rounded-lg border border-amber-100 hover:border-amber-300 hover:shadow-sm transition-all"
                  >
                    <Clock className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-[#171717]">{review.dealName || 'Deal Review'}</h3>
                        <Badge className="bg-amber-100 text-amber-700 text-xs">
                          Pending Review
                        </Badge>
                      </div>
                      <p className="text-sm text-[#737373]">
                        Requested by <span className="font-medium">{review.requestedByName || 'Analyst'}</span>
                        {review.message && <span className="ml-1">— "{review.message}"</span>}
                      </p>
                      <p className="text-xs text-[#A3A3A3] mt-1">
                        {formatTimeAgo(review.requestedAt)}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-[#A3A3A3] flex-shrink-0" />
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Two Column Section: Activity Feed + Quick Starts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Recent Activity Section */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Recent Activity
            </h2>
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-2">
              <ActivityFeed
                limit={8}
                onActivityClick={(activity) => {
                  // Navigate based on activity type
                  if (activity.dealId) {
                    window.location.href = createPageUrl(`DealOverview?id=${activity.dealId}`);
                  } else if (activity.conversationId) {
                    // Open chat panel - handled by ChatContext
                  }
                }}
              />
            </div>
          </section>

          {/* Quick Starts Section */}
          <section>
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider mb-4">
              Start Something New
            </h2>
            <div className="space-y-2">
              {quickStarts.map((item) => (
                <QuickStartButton
                  key={item.id}
                  item={item}
                  href={quickStartHrefs[item.id]}
                />
              ))}
            </div>
          </section>
        </div>

        {/* AI News & Insights Section */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#A3A3A3] uppercase tracking-wider">
              AI News & Insights
            </h2>
            {newsData?._mock && (
              <Badge variant="outline" className="text-xs text-violet-600 border-violet-200">
                Demo Data
              </Badge>
            )}
          </div>

          {newsLoading ? (
            <div className="grid grid-cols-1 gap-4">
              {[1, 2].map(i => (
                <div key={i} className="h-40 bg-slate-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : insights.length > 0 ? (
            <div className="grid grid-cols-1 gap-4">
              {insights.slice(0, 3).map((insight) => (
                <NewsInsightCard
                  key={insight.id}
                  insight={insight}
                  onAsk={handleAsk}
                  onDismiss={handleDismiss}
                  isAsking={askMutation?.isPending}
                />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-8 text-center">
              <Newspaper className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
              <p className="text-sm font-medium text-[#737373]">No news insights yet</p>
              <p className="text-xs text-[#A3A3A3] mt-1">We'll surface relevant market news as it becomes available</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// MAIN HOMEPAGE COMPONENT WITH ROLE SWITCHING
// =============================================================================

export default function HomePage() {
  const { currentRole } = useRole();
  const queryClient = useQueryClient();

  // Fetch homepage data
  const { data: homeData, isLoading: homeLoading } = useQuery({
    queryKey: ['home', currentRole],
    queryFn: () => bff.home.getData(),
    staleTime: 30000 // 30 seconds
  });

  // Fetch news insights
  const { data: newsData, isLoading: newsLoading } = useQuery({
    queryKey: ['news-insights', currentRole],
    queryFn: () => bff.newsInsights.list(),
    staleTime: 60000 // 1 minute
  });

  // Fetch pending review requests (GP only)
  const { data: pendingReviews } = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: () => bff.reviewRequests.list('pending'),
    enabled: currentRole === 'GP',
    staleTime: 30000 // 30 seconds
  });

  // Ask follow-up mutation
  const askMutation = useMutation({
    mutationFn: ({ insightId, question }) => bff.newsInsights.ask(insightId, question),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['news-insights'] });
    }
  });

  // Dismiss insight mutation
  const dismissMutation = useMutation({
    mutationFn: (insightId) => bff.newsInsights.dismiss(insightId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['news-insights'] });
    }
  });

  const handleAsk = async (insightId, question) => {
    return askMutation.mutateAsync({ insightId, question });
  };

  const handleDismiss = (insightId) => {
    dismissMutation.mutate(insightId);
  };

  // Loading state
  if (homeLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-12 bg-slate-100 rounded w-1/3" />
          <div className="h-6 bg-slate-100 rounded w-1/4" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-32 bg-slate-100 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Common props for all home components
  const homeProps = {
    homeData,
    newsData,
    handleAsk,
    handleDismiss,
    askMutation,
    newsLoading,
    pendingReviews
  };

  // Render appropriate home component based on role
  if (currentRole === 'Lender') {
    return <LenderHome {...homeProps} />;
  }

  if (currentRole === 'Counsel') {
    return <CounselHome {...homeProps} />;
  }

  if (currentRole === 'GP Analyst') {
    return <GPAnalystHome {...homeProps} />;
  }

  // Default: GP and all other roles use GPHome
  return <GPHome {...homeProps} />;
}

function getTimeOfDay() {
  const hour = new Date().getHours();
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}
