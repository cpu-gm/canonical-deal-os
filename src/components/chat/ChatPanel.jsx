import React, { useState } from 'react';
import { X, ArrowLeft, Plus, Hash, MessageSquare, Users } from 'lucide-react';
import { useChatContext } from '@/context/ChatContext';
import { cn } from '@/lib/utils';
import ConversationList from './ConversationList';
import ConversationView from './ConversationView';
import NewConversationModal from './NewConversationModal';

export default function ChatPanel() {
  const {
    isPanelOpen,
    closePanel,
    activeConversationId,
    selectConversation,
    conversations
  } = useChatContext();

  const [showNewModal, setShowNewModal] = useState(false);

  const activeConversation = conversations.find(c => c.id === activeConversationId);

  return (
    <>
      {/* Backdrop overlay for mobile */}
      {isPanelOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={closePanel}
        />
      )}

      {/* Chat Panel */}
      <aside
        className={cn(
          "fixed right-0 top-0 h-full w-96 bg-white border-l border-[#E5E5E5] shadow-xl z-50",
          "flex flex-col transition-transform duration-300 ease-in-out",
          isPanelOpen ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Header */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-[#E5E5E5] bg-white">
          {activeConversationId ? (
            <>
              <button
                onClick={() => selectConversation(null)}
                className="p-2 -ml-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
              >
                <ArrowLeft className="w-5 h-5 text-[#737373]" />
              </button>
              <div className="flex-1 ml-2 min-w-0">
                <div className="flex items-center gap-2">
                  {activeConversation?.type === 'CHANNEL' ? (
                    <Hash className="w-4 h-4 text-[#737373] flex-shrink-0" />
                  ) : activeConversation?.type === 'DIRECT' ? (
                    <MessageSquare className="w-4 h-4 text-[#737373] flex-shrink-0" />
                  ) : (
                    <Users className="w-4 h-4 text-[#737373] flex-shrink-0" />
                  )}
                  <span className="font-semibold text-[#171717] truncate">
                    {activeConversation?.name || 'Direct Message'}
                  </span>
                </div>
                {activeConversation?.description && (
                  <p className="text-xs text-[#A3A3A3] truncate mt-0.5">
                    {activeConversation.description}
                  </p>
                )}
              </div>
              <button
                onClick={closePanel}
                className="p-2 -mr-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-[#737373]" />
              </button>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-[#171717]">Messages</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowNewModal(true)}
                  className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
                  title="New conversation"
                >
                  <Plus className="w-5 h-5 text-[#737373]" />
                </button>
                <button
                  onClick={closePanel}
                  className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
                >
                  <X className="w-5 h-5 text-[#737373]" />
                </button>
              </div>
            </>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden">
          {activeConversationId ? (
            <ConversationView />
          ) : (
            <ConversationList onNewClick={() => setShowNewModal(true)} />
          )}
        </div>
      </aside>

      {/* New Conversation Modal */}
      <NewConversationModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
      />
    </>
  );
}
