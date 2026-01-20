import React from 'react';
import { Hash, MessageSquare, Users, Loader2, Lock } from 'lucide-react';
import { useChatContext } from '@/context/ChatContext';
import { cn } from '@/lib/utils';

function formatTimestamp(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ConversationListItem({ conversation, onClick }) {
  const { unreadCounts } = useChatContext();
  const unreadCount = unreadCounts[conversation.id] || 0;

  const getIcon = () => {
    if (conversation.type === 'CHANNEL') {
      return conversation.visibility === 'ROLE_BASED' ? (
        <Lock className="w-4 h-4 text-[#A3A3A3]" />
      ) : (
        <Hash className="w-4 h-4 text-[#A3A3A3]" />
      );
    }
    if (conversation.type === 'DIRECT') {
      return <MessageSquare className="w-4 h-4 text-[#A3A3A3]" />;
    }
    return <Users className="w-4 h-4 text-[#A3A3A3]" />;
  };

  const getName = () => {
    if (conversation.type === 'DIRECT' && conversation.participants) {
      // For DMs, show other participant's name
      const otherParticipants = conversation.participants.filter(
        p => p.participantName !== 'You'
      );
      if (otherParticipants.length > 0) {
        return otherParticipants.map(p => p.participantName).join(', ');
      }
    }
    return conversation.name || 'Untitled';
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full px-4 py-3 flex items-start gap-3 text-left",
        "hover:bg-[#F5F5F5] transition-colors",
        "border-b border-[#F5F5F5]",
        unreadCount > 0 && "bg-[#FAFAFA]"
      )}
    >
      {/* Icon */}
      <div className="mt-0.5 flex-shrink-0">
        {getIcon()}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className={cn(
            "truncate",
            unreadCount > 0 ? "font-semibold text-[#171717]" : "font-medium text-[#171717]"
          )}>
            {getName()}
          </span>
          <span className="text-xs text-[#A3A3A3] flex-shrink-0">
            {formatTimestamp(conversation.lastMessage?.createdAt || conversation.updatedAt)}
          </span>
        </div>

        {conversation.lastMessage && (
          <p className={cn(
            "text-sm truncate mt-0.5",
            unreadCount > 0 ? "text-[#171717]" : "text-[#737373]"
          )}>
            {conversation.lastMessage.contentType === 'system' ? (
              <span className="italic">{conversation.lastMessage.content}</span>
            ) : (
              <>
                <span className="font-medium">{conversation.lastMessage.senderName}:</span>{' '}
                {conversation.lastMessage.content}
              </>
            )}
          </p>
        )}

        {!conversation.lastMessage && conversation.description && (
          <p className="text-sm text-[#A3A3A3] truncate mt-0.5">
            {conversation.description}
          </p>
        )}
      </div>

      {/* Unread badge */}
      {unreadCount > 0 && (
        <span className="flex-shrink-0 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-semibold rounded-full flex items-center justify-center">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}

      {/* Not joined indicator */}
      {!conversation.isJoined && (
        <span className="text-xs text-[#A3A3A3] flex-shrink-0">
          Join
        </span>
      )}
    </button>
  );
}

export default function ConversationList({ onNewClick }) {
  const {
    conversations,
    isLoadingConversations,
    selectConversation,
    joinConversation
  } = useChatContext();

  // Group conversations
  const channels = conversations.filter(c => c.type === 'CHANNEL');
  const directMessages = conversations.filter(c => c.type === 'DIRECT');
  const dealThreads = conversations.filter(c => c.type === 'DEAL_THREAD');

  const handleClick = async (conversation) => {
    if (!conversation.isJoined) {
      try {
        await joinConversation(conversation.id);
      } catch (error) {
        console.error('Failed to join:', error);
        return;
      }
    }
    selectConversation(conversation.id);
  };

  if (isLoadingConversations && conversations.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 text-[#A3A3A3] animate-spin" />
      </div>
    );
  }

  if (conversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 text-center">
        <MessageSquare className="w-12 h-12 text-[#E5E5E5] mb-4" />
        <h3 className="font-semibold text-[#171717] mb-2">No conversations yet</h3>
        <p className="text-sm text-[#737373] mb-4">
          Start a conversation to collaborate with your team.
        </p>
        <button
          onClick={onNewClick}
          className="px-4 py-2 bg-[#0A0A0A] text-white text-sm font-medium rounded-lg hover:bg-[#171717] transition-colors"
        >
          New Conversation
        </button>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Channels */}
      {channels.length > 0 && (
        <div>
          <div className="px-4 py-2 bg-[#FAFAFA] border-b border-[#E5E5E5]">
            <span className="text-xs font-semibold text-[#A3A3A3] uppercase tracking-wider">
              Channels
            </span>
          </div>
          {channels.map(conversation => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              onClick={() => handleClick(conversation)}
            />
          ))}
        </div>
      )}

      {/* Deal Threads */}
      {dealThreads.length > 0 && (
        <div>
          <div className="px-4 py-2 bg-[#FAFAFA] border-b border-[#E5E5E5]">
            <span className="text-xs font-semibold text-[#A3A3A3] uppercase tracking-wider">
              Deal Discussions
            </span>
          </div>
          {dealThreads.map(conversation => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              onClick={() => handleClick(conversation)}
            />
          ))}
        </div>
      )}

      {/* Direct Messages */}
      {directMessages.length > 0 && (
        <div>
          <div className="px-4 py-2 bg-[#FAFAFA] border-b border-[#E5E5E5]">
            <span className="text-xs font-semibold text-[#A3A3A3] uppercase tracking-wider">
              Direct Messages
            </span>
          </div>
          {directMessages.map(conversation => (
            <ConversationListItem
              key={conversation.id}
              conversation={conversation}
              onClick={() => handleClick(conversation)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
