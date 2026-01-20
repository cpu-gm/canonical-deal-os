import React from 'react';
import { MessageCircle } from 'lucide-react';
import { useChatContext } from '@/context/ChatContext';
import { cn } from '@/lib/utils';

export default function ChatFAB() {
  const { togglePanel, isPanelOpen, totalUnreadCount } = useChatContext();

  return (
    <button
      onClick={togglePanel}
      className={cn(
        "fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-lg",
        "flex items-center justify-center z-40",
        "transition-all duration-200 hover:scale-105",
        isPanelOpen
          ? "bg-[#737373] text-white"
          : "bg-[#0A0A0A] text-white hover:bg-[#171717]"
      )}
      aria-label={isPanelOpen ? "Close chat" : "Open chat"}
    >
      <MessageCircle className="w-6 h-6" />

      {/* Unread badge */}
      {totalUnreadCount > 0 && !isPanelOpen && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-xs font-semibold rounded-full flex items-center justify-center">
          {totalUnreadCount > 99 ? '99+' : totalUnreadCount}
        </span>
      )}
    </button>
  );
}
