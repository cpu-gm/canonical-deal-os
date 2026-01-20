import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageCircle, CheckSquare, AtSign, Bell, Clock, ChevronRight } from 'lucide-react';
import { bff } from '@/api/bffClient';
import { cn } from '@/lib/utils';

function formatTimestamp(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getActivityIcon(type) {
  switch (type) {
    case 'message':
      return <MessageCircle className="w-4 h-4" />;
    case 'task':
    case 'task_assigned':
      return <CheckSquare className="w-4 h-4" />;
    case 'mention':
      return <AtSign className="w-4 h-4" />;
    default:
      return <Bell className="w-4 h-4" />;
  }
}

function getActivityColor(type) {
  switch (type) {
    case 'message':
      return 'bg-blue-100 text-blue-600';
    case 'task':
    case 'task_assigned':
      return 'bg-green-100 text-green-600';
    case 'mention':
      return 'bg-purple-100 text-purple-600';
    default:
      return 'bg-gray-100 text-gray-600';
  }
}

function ActivityItem({ activity, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-start gap-3 p-3 hover:bg-[#F5F5F5] rounded-lg transition-colors text-left"
    >
      {/* Icon */}
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
        getActivityColor(activity.type)
      )}>
        {getActivityIcon(activity.type)}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-sm text-[#171717] truncate">
            {activity.title}
          </span>
          <span className="text-xs text-[#A3A3A3] flex-shrink-0 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {formatTimestamp(activity.timestamp)}
          </span>
        </div>

        {activity.body && (
          <p className="text-sm text-[#737373] truncate mt-0.5">
            {activity.body}
          </p>
        )}

        {activity.actorName && (
          <p className="text-xs text-[#A3A3A3] mt-1">
            by {activity.actorName}
          </p>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-[#A3A3A3] flex-shrink-0 mt-2" />
    </button>
  );
}

export default function ActivityFeed({ limit = 10, dealId = null, onActivityClick }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['activity-feed', limit, dealId],
    queryFn: () => bff.activityFeed.get({ limit, dealId }),
    refetchInterval: 30000 // Refresh every 30 seconds
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex items-start gap-3 p-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-[#E5E5E5]" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-[#E5E5E5] rounded w-3/4" />
              <div className="h-3 bg-[#E5E5E5] rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-[#737373]">
        <p className="text-sm">Failed to load activity feed</p>
      </div>
    );
  }

  const activities = data?.activities || [];

  if (activities.length === 0) {
    return (
      <div className="text-center py-8 text-[#737373]">
        <Bell className="w-8 h-8 mx-auto mb-2 text-[#E5E5E5]" />
        <p className="text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {activities.map(activity => (
        <ActivityItem
          key={activity.id}
          activity={activity}
          onClick={() => onActivityClick?.(activity)}
        />
      ))}
    </div>
  );
}
