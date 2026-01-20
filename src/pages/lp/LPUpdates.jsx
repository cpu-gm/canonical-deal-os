import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import {
  ArrowLeft, Loader2, FileText, Calendar, ChevronRight,
  AlertTriangle, TrendingUp, Bell
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageError } from '@/components/ui/page-state';
import { debugLog } from '@/lib/debug';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function formatRelativeDate(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  return formatDate(dateString);
}

function getTypeIcon(type) {
  switch (type) {
    case 'QUARTERLY_UPDATE':
      return <FileText className="w-5 h-5" />;
    case 'MILESTONE':
      return <TrendingUp className="w-5 h-5" />;
    case 'ISSUE_ALERT':
      return <AlertTriangle className="w-5 h-5" />;
    default:
      return <Bell className="w-5 h-5" />;
  }
}

function getTypeColor(type) {
  switch (type) {
    case 'QUARTERLY_UPDATE':
      return 'bg-blue-100 text-blue-600';
    case 'MILESTONE':
      return 'bg-green-100 text-green-600';
    case 'ISSUE_ALERT':
      return 'bg-red-100 text-red-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function getTypeLabel(type) {
  switch (type) {
    case 'QUARTERLY_UPDATE':
      return 'Quarterly Update';
    case 'MILESTONE':
      return 'Milestone';
    case 'ISSUE_ALERT':
      return 'Issue Alert';
    case 'GENERAL':
      return 'General Update';
    default:
      return type;
  }
}

function UpdateCard({ update, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex items-start gap-4">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
          getTypeColor(update.updateType)
        )}>
          {getTypeIcon(update.updateType)}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <div>
              <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
                {update.title}
              </h3>
              <p className="text-sm text-gray-500">
                {getTypeLabel(update.updateType)}
                {update.period && ` • ${update.period}`}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 flex-shrink-0" />
          </div>

          {update.headline && (
            <p className="text-gray-600 text-sm line-clamp-2 mb-3">
              {update.headline}
            </p>
          )}

          <div className="flex items-center gap-4 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{formatRelativeDate(update.publishedAt)}</span>
            </div>
            {update.createdByName && (
              <span>by {update.createdByName}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LPUpdates() {
  const { dealId } = useParams();
  const navigate = useNavigate();
  const { authToken } = useAuth();

  const updatesQuery = useQuery({
    queryKey: ['lp-updates', dealId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/updates`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 404) return { updates: [] };
        throw new Error('Failed to fetch updates');
      }
      return res.json();
    },
    enabled: !!dealId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Updates load failed', { message: error?.message, dealId });
    }
  });

  const updates = updatesQuery.data?.updates || [];

  // Group updates by type
  const quarterlyUpdates = updates.filter(u => u.updateType === 'QUARTERLY_UPDATE');
  const milestones = updates.filter(u => u.updateType === 'MILESTONE');
  const alerts = updates.filter(u => u.updateType === 'ISSUE_ALERT');
  const other = updates.filter(u => !['QUARTERLY_UPDATE', 'MILESTONE', 'ISSUE_ALERT'].includes(u.updateType));

  if (updatesQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading updates...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (updatesQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={updatesQuery.error} onRetry={updatesQuery.refetch} />
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
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Investor Updates</h1>
          <p className="text-gray-500">
            {updates.length} update{updates.length !== 1 ? 's' : ''}
          </p>
        </div>

        {/* Updates List */}
        {updates.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="font-medium text-gray-900 mb-2">No Updates Yet</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              There are no investor updates for this investment yet. You'll be notified when new updates are published.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Issue Alerts (show first if any) */}
            {alerts.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-red-600 uppercase tracking-wide mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  Alerts ({alerts.length})
                </h2>
                <div className="space-y-4">
                  {alerts.map(update => (
                    <UpdateCard
                      key={update.id}
                      update={update}
                      onClick={() => navigate(`/investments/${dealId}/updates/${update.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Quarterly Updates */}
            {quarterlyUpdates.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Quarterly Reports ({quarterlyUpdates.length})
                </h2>
                <div className="space-y-4">
                  {quarterlyUpdates.map(update => (
                    <UpdateCard
                      key={update.id}
                      update={update}
                      onClick={() => navigate(`/investments/${dealId}/updates/${update.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Milestones */}
            {milestones.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Milestones ({milestones.length})
                </h2>
                <div className="space-y-4">
                  {milestones.map(update => (
                    <UpdateCard
                      key={update.id}
                      update={update}
                      onClick={() => navigate(`/investments/${dealId}/updates/${update.id}`)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Other Updates */}
            {other.length > 0 && (
              <div>
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                  Other Updates ({other.length})
                </h2>
                <div className="space-y-4">
                  {other.map(update => (
                    <UpdateCard
                      key={update.id}
                      update={update}
                      onClick={() => navigate(`/investments/${dealId}/updates/${update.id}`)}
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
