import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Send, Loader2 } from 'lucide-react';
import { bff } from '@/api/bffClient';
import { cn } from '@/lib/utils';
import MessageList from './MessageList';
import CreateTaskModal from './CreateTaskModal';

export default function DealDiscussion({ dealId, dealName }) {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState('');
  const [selectedMessageForTask, setSelectedMessageForTask] = useState(null);
  const containerRef = useRef(null);
  const isAtBottomRef = useRef(true);

  // Get or create deal thread
  const { data: threadData, isLoading: threadLoading } = useQuery({
    queryKey: ['deal-thread', dealId],
    queryFn: () => bff.chat.getDealThread(dealId, dealName),
    enabled: !!dealId
  });

  const conversationId = threadData?.conversation?.id;

  // Get messages for the thread
  const { data: messagesData, isLoading: messagesLoading, refetch: refetchMessages } = useQuery({
    queryKey: ['deal-messages', conversationId],
    queryFn: () => bff.chat.listMessages(conversationId, { limit: 50 }),
    enabled: !!conversationId,
    refetchInterval: 5000 // Poll every 5 seconds
  });

  // Send message mutation
  const sendMutation = useMutation({
    mutationFn: ({ content }) => bff.chat.sendMessage(conversationId, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-messages', conversationId] });
      setMessage('');
    }
  });

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messagesData?.messages]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  const handleSend = useCallback(() => {
    if (!message.trim() || !conversationId) return;
    sendMutation.mutate({ content: message.trim() });
  }, [message, conversationId, sendMutation]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (threadLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-[#A3A3A3] animate-spin" />
      </div>
    );
  }

  const messages = messagesData?.messages || [];

  return (
    <div className="flex flex-col h-full bg-white rounded-xl border border-[#E5E5E5]">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[#E5E5E5] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-5 h-5 text-[#737373]" />
          <h3 className="font-semibold text-[#171717]">Deal Discussion</h3>
          <span className="text-xs text-[#A3A3A3]">
            {threadData?.conversation?.participantCount || 0} participants
          </span>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto min-h-[200px] max-h-[400px]"
      >
        {messagesLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-[#A3A3A3] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4 py-8">
            <MessageCircle className="w-10 h-10 text-[#E5E5E5] mb-3" />
            <p className="text-sm text-[#737373]">No messages yet</p>
            <p className="text-xs text-[#A3A3A3] mt-1">Start a discussion about this deal</p>
          </div>
        ) : (
          <div className="relative">
            <MessageList
              messages={messages}
              onMessageAction={(msg, action) => {
                if (action === 'createTask') {
                  setSelectedMessageForTask(msg);
                }
              }}
              showActions
            />
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-3 border-t border-[#E5E5E5]">
        <div className="flex items-end gap-2">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Shift+Enter for new line)"
            rows={1}
            className={cn(
              "flex-1 resize-none rounded-lg border border-[#E5E5E5] px-3 py-2",
              "text-sm text-[#171717] placeholder:text-[#A3A3A3]",
              "focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] focus:border-transparent",
              "transition-colors"
            )}
            style={{ minHeight: '40px', maxHeight: '100px' }}
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sendMutation.isPending}
            className={cn(
              "p-2 rounded-lg transition-colors flex-shrink-0",
              message.trim()
                ? "bg-[#0A0A0A] text-white hover:bg-[#171717]"
                : "bg-[#F5F5F5] text-[#A3A3A3] cursor-not-allowed"
            )}
          >
            {sendMutation.isPending ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <Send className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      {/* Create Task Modal */}
      {selectedMessageForTask && (
        <CreateTaskModal
          isOpen={!!selectedMessageForTask}
          onClose={() => setSelectedMessageForTask(null)}
          sourceMessage={selectedMessageForTask}
          dealId={dealId}
          conversationId={conversationId}
        />
      )}
    </div>
  );
}
