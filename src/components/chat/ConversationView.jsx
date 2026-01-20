import React, { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useChatContext } from '@/context/ChatContext';
import MessageList from './MessageList';
import MessageInput from './MessageInput';

export default function ConversationView() {
  const {
    messages,
    isLoadingMessages,
    hasMoreMessages,
    loadMessages,
    activeConversationId,
    sendMessage,
    sendMessageWithAttachments,
    askAI
  } = useChatContext();

  const containerRef = useRef(null);
  const isAtBottomRef = useRef(true);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (isAtBottomRef.current && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [messages]);

  // Track if user is at bottom
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 50;
  };

  // Load more messages when scrolling to top
  const handleLoadMore = () => {
    if (hasMoreMessages && !isLoadingMessages && messages.length > 0) {
      const oldestMessage = messages[0];
      loadMessages(activeConversationId, oldestMessage.id);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages area */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
      >
        {/* Load more button */}
        {hasMoreMessages && (
          <div className="p-4 text-center">
            <button
              onClick={handleLoadMore}
              disabled={isLoadingMessages}
              className="text-sm text-[#737373] hover:text-[#171717] transition-colors disabled:opacity-50"
            >
              {isLoadingMessages ? (
                <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
              ) : null}
              Load older messages
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoadingMessages && messages.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 text-[#A3A3A3] animate-spin" />
          </div>
        )}

        {/* Messages */}
        <MessageList messages={messages} />

        {/* Empty state */}
        {!isLoadingMessages && messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full px-6 text-center">
            <p className="text-sm text-[#737373]">
              No messages yet. Start the conversation!
            </p>
          </div>
        )}
      </div>

      {/* Input area */}
      <MessageInput
        onSend={sendMessage}
        onSendWithAttachments={sendMessageWithAttachments}
        onAskAI={askAI}
        aiEnabled={true}
      />
    </div>
  );
}
