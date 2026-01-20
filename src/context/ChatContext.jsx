import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { bff } from '@/api/bffClient';
import { useRole } from '@/Layout';

const ChatContext = createContext(null);

export const useChatContext = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChatContext must be used within a ChatProvider');
  }
  return context;
};

const POLLING_INTERVAL_ACTIVE = 3000; // 3 seconds when panel is open
const POLLING_INTERVAL_BACKGROUND = 30000; // 30 seconds when panel is closed

export function ChatProvider({ children }) {
  const { currentRole } = useRole();

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(() => {
    const stored = localStorage.getItem('chat-panel-open');
    return stored === 'true';
  });

  // Conversations state
  const [conversations, setConversations] = useState([]);
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);

  // Messages state
  const [messages, setMessages] = useState([]);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);

  // Polling state
  const lastPollTimestamp = useRef(new Date().toISOString());
  const pollingIntervalRef = useRef(null);

  // Unread counts
  const [unreadCounts, setUnreadCounts] = useState({});

  // Persist panel state
  useEffect(() => {
    localStorage.setItem('chat-panel-open', isPanelOpen.toString());
  }, [isPanelOpen]);

  // Toggle panel
  const togglePanel = useCallback(() => {
    setIsPanelOpen(prev => !prev);
  }, []);

  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  // Load conversations
  const loadConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const response = await bff.chat.listConversations();
      setConversations(response.conversations || []);
    } catch (error) {
      console.error('Failed to load conversations:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  // Load messages for active conversation
  const loadMessages = useCallback(async (conversationId, cursor = null) => {
    if (!conversationId) return;

    setIsLoadingMessages(true);
    try {
      const response = await bff.chat.listMessages(conversationId, { cursor, limit: 50 });

      if (cursor) {
        // Prepend older messages
        setMessages(prev => [...(response.messages || []), ...prev]);
      } else {
        setMessages(response.messages || []);
      }
      setHasMoreMessages(response.hasMore || false);
    } catch (error) {
      console.error('Failed to load messages:', error);
    } finally {
      setIsLoadingMessages(false);
    }
  }, []);

  // Select conversation
  const selectConversation = useCallback(async (conversationId) => {
    setActiveConversationId(conversationId);
    setMessages([]);

    if (conversationId) {
      await loadMessages(conversationId);

      // Mark as read
      try {
        await bff.chat.markRead(conversationId);
        setUnreadCounts(prev => ({ ...prev, [conversationId]: 0 }));
      } catch (error) {
        console.error('Failed to mark as read:', error);
      }
    }
  }, [loadMessages]);

  // Send message
  const sendMessage = useCallback(async (content, parentId = null) => {
    if (!activeConversationId || !content.trim()) return;

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      conversationId: activeConversationId,
      senderId: 'current-user',
      senderName: 'You',
      content: content.trim(),
      contentType: 'text',
      parentId,
      createdAt: new Date().toISOString(),
      isPending: true
    };

    setMessages(prev => [...prev, optimisticMessage]);

    try {
      const response = await bff.chat.sendMessage(activeConversationId, {
        content: content.trim(),
        contentType: 'text',
        parentId
      });

      // Replace optimistic message with real one
      setMessages(prev => prev.map(msg =>
        msg.id === tempId ? response.message : msg
      ));

      // Update conversation in list
      setConversations(prev => {
        const updated = prev.map(conv => {
          if (conv.id === activeConversationId) {
            return {
              ...conv,
              lastMessage: {
                id: response.message.id,
                content: response.message.content.substring(0, 100),
                senderName: response.message.senderName,
                createdAt: response.message.createdAt
              },
              updatedAt: response.message.createdAt
            };
          }
          return conv;
        });
        // Re-sort by most recent
        return updated.sort((a, b) => {
          const aTime = a.lastMessage?.createdAt ?? a.updatedAt;
          const bTime = b.lastMessage?.createdAt ?? b.updatedAt;
          return new Date(bTime) - new Date(aTime);
        });
      });

    } catch (error) {
      console.error('Failed to send message:', error);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
    }
  }, [activeConversationId]);

  // Send message with attachments
  const sendMessageWithAttachments = useCallback(async (content, attachments, parentId = null) => {
    if (!activeConversationId || ((!content || !content.trim()) && attachments.length === 0)) return;

    // Create optimistic attachment data for display
    const optimisticAttachments = attachments.map(att => ({
      name: att.name,
      type: att.type,
      size: att.size,
      url: att.preview || '#', // Use preview URL temporarily
      thumbnailUrl: att.preview
    }));

    // Optimistic update
    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      id: tempId,
      conversationId: activeConversationId,
      senderId: 'current-user',
      senderName: 'You',
      content: content?.trim() || '',
      contentType: 'text',
      attachments: JSON.stringify(optimisticAttachments),
      parentId,
      createdAt: new Date().toISOString(),
      isPending: true
    };

    setMessages(prev => [...prev, optimisticMessage]);

    try {
      // For now, we'll just send the message with attachment metadata
      // In a real implementation, you'd upload files to a storage service first
      // and then include the URLs in the message

      // Simulate file upload by creating mock URLs
      const uploadedAttachments = attachments.map(att => ({
        name: att.name,
        type: att.type,
        size: att.size,
        // In production, these would be real URLs from file upload
        url: att.preview || `#file-${att.name}`,
        thumbnailUrl: att.type.startsWith('image/') ? att.preview : null
      }));

      const response = await bff.chat.sendMessage(activeConversationId, {
        content: content?.trim() || `Shared ${attachments.length} file(s)`,
        contentType: 'text',
        parentId,
        attachments: JSON.stringify(uploadedAttachments)
      });

      // Replace optimistic message with real one
      setMessages(prev => prev.map(msg =>
        msg.id === tempId ? response.message : msg
      ));

      // Update conversation in list
      setConversations(prev => {
        const updated = prev.map(conv => {
          if (conv.id === activeConversationId) {
            return {
              ...conv,
              lastMessage: {
                id: response.message.id,
                content: response.message.content.substring(0, 100),
                senderName: response.message.senderName,
                createdAt: response.message.createdAt
              },
              updatedAt: response.message.createdAt
            };
          }
          return conv;
        });
        return updated.sort((a, b) => {
          const aTime = a.lastMessage?.createdAt ?? a.updatedAt;
          const bTime = b.lastMessage?.createdAt ?? b.updatedAt;
          return new Date(bTime) - new Date(aTime);
        });
      });

    } catch (error) {
      console.error('Failed to send message with attachments:', error);
      // Remove optimistic message on error
      setMessages(prev => prev.filter(msg => msg.id !== tempId));
    }
  }, [activeConversationId]);

  // Ask AI - sends user's question and AI's response as messages in the chat
  const askAI = useCallback(async (question) => {
    if (!activeConversationId || !question.trim()) return;

    // First, send the user's question as a message
    const userTempId = `temp-user-${Date.now()}`;
    const userMessage = {
      id: userTempId,
      conversationId: activeConversationId,
      senderId: 'current-user',
      senderName: 'You',
      content: `@AI ${question}`,
      contentType: 'text',
      createdAt: new Date().toISOString(),
      isPending: true
    };

    setMessages(prev => [...prev, userMessage]);

    try {
      // Send the user's question message to the server
      const userResponse = await bff.chat.sendMessage(activeConversationId, {
        content: `@AI ${question}`,
        contentType: 'text'
      });

      // Replace optimistic user message with real one
      setMessages(prev => prev.map(msg =>
        msg.id === userTempId ? userResponse.message : msg
      ));

      // Add a thinking indicator for AI
      const aiTempId = `temp-ai-${Date.now()}`;
      const aiThinkingMessage = {
        id: aiTempId,
        conversationId: activeConversationId,
        senderId: 'ai-assistant',
        senderName: 'AI Assistant',
        content: 'Thinking...',
        contentType: 'ai_response',
        createdAt: new Date().toISOString(),
        isPending: true
      };

      setMessages(prev => [...prev, aiThinkingMessage]);

      // Call the AI assistant API
      const aiResult = await bff.aiAssistant.ask({
        question,
        conversationId: activeConversationId
      });

      // Format the AI response
      let aiContent = aiResult.answer || 'I could not generate a response.';

      // Add suggestions if available
      if (aiResult.suggestions && aiResult.suggestions.length > 0) {
        aiContent += '\n\n**Suggestions:**\n';
        aiResult.suggestions.forEach(s => {
          aiContent += `• ${s}\n`;
        });
      }

      // Send the AI response as a message
      const aiMessageResponse = await bff.chat.sendMessage(activeConversationId, {
        content: aiContent,
        contentType: 'ai_response'
      });

      // Replace the thinking message with the real AI response
      setMessages(prev => prev.map(msg =>
        msg.id === aiTempId ? {
          ...aiMessageResponse.message,
          senderName: 'AI Assistant',
          contentType: 'ai_response'
        } : msg
      ));

      // Update conversation in list
      setConversations(prev => {
        const updated = prev.map(conv => {
          if (conv.id === activeConversationId) {
            return {
              ...conv,
              lastMessage: {
                id: aiMessageResponse.message.id,
                content: aiMessageResponse.message.content.substring(0, 100),
                senderName: 'AI Assistant',
                createdAt: aiMessageResponse.message.createdAt
              },
              updatedAt: aiMessageResponse.message.createdAt
            };
          }
          return conv;
        });
        return updated.sort((a, b) => {
          const aTime = a.lastMessage?.createdAt ?? a.updatedAt;
          const bTime = b.lastMessage?.createdAt ?? b.updatedAt;
          return new Date(bTime) - new Date(aTime);
        });
      });

    } catch (error) {
      console.error('Failed to process AI question:', error);
      // Remove both optimistic messages on error
      setMessages(prev => prev.filter(msg =>
        msg.id !== userTempId && !msg.id.startsWith('temp-ai-')
      ));

      // Add an error message
      const errorMessage = {
        id: `error-${Date.now()}`,
        conversationId: activeConversationId,
        senderId: 'ai-assistant',
        senderName: 'AI Assistant',
        content: 'Sorry, I encountered an error processing your question. Please try again.',
        contentType: 'ai_response',
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    }
  }, [activeConversationId]);

  // Create conversation
  const createConversation = useCallback(async (payload) => {
    try {
      const response = await bff.chat.createConversation(payload);
      await loadConversations();
      return response.conversation;
    } catch (error) {
      console.error('Failed to create conversation:', error);
      throw error;
    }
  }, [loadConversations]);

  // Join conversation
  const joinConversation = useCallback(async (conversationId) => {
    try {
      await bff.chat.joinConversation(conversationId);
      await loadConversations();
    } catch (error) {
      console.error('Failed to join conversation:', error);
      throw error;
    }
  }, [loadConversations]);

  // Poll for updates
  const pollForUpdates = useCallback(async () => {
    try {
      const response = await bff.chat.getUpdates(lastPollTimestamp.current);

      // Update timestamp
      lastPollTimestamp.current = response.timestamp;

      // Update unread counts
      if (response.unreadCounts) {
        setUnreadCounts(prev => ({ ...prev, ...response.unreadCounts }));
      }

      // Add new messages to active conversation
      if (response.newMessages && response.newMessages.length > 0) {
        const activeMessages = response.newMessages.filter(
          msg => msg.conversationId === activeConversationId
        );

        if (activeMessages.length > 0) {
          setMessages(prev => {
            // Avoid duplicates
            const existingIds = new Set(prev.map(m => m.id));
            const newOnes = activeMessages.filter(m => !existingIds.has(m.id));
            return [...prev, ...newOnes];
          });
        }

        // Update conversation list with latest messages
        setConversations(prev => {
          const messagesByConv = {};
          for (const msg of response.newMessages) {
            if (!messagesByConv[msg.conversationId] ||
                new Date(msg.createdAt) > new Date(messagesByConv[msg.conversationId].createdAt)) {
              messagesByConv[msg.conversationId] = msg;
            }
          }

          return prev.map(conv => {
            const latestMsg = messagesByConv[conv.id];
            if (latestMsg) {
              return {
                ...conv,
                lastMessage: {
                  id: latestMsg.id,
                  content: latestMsg.content.substring(0, 100),
                  senderName: latestMsg.senderName,
                  createdAt: latestMsg.createdAt
                },
                updatedAt: latestMsg.createdAt
              };
            }
            return conv;
          }).sort((a, b) => {
            const aTime = a.lastMessage?.createdAt ?? a.updatedAt;
            const bTime = b.lastMessage?.createdAt ?? b.updatedAt;
            return new Date(bTime) - new Date(aTime);
          });
        });
      }
    } catch (error) {
      console.error('Failed to poll for updates:', error);
    }
  }, [activeConversationId]);

  // Calculate total unread count
  const totalUnreadCount = Object.values(unreadCounts).reduce((sum, count) => sum + count, 0);

  // Start/stop polling based on panel state
  useEffect(() => {
    const interval = isPanelOpen ? POLLING_INTERVAL_ACTIVE : POLLING_INTERVAL_BACKGROUND;

    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
    }

    pollingIntervalRef.current = setInterval(pollForUpdates, interval);

    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [isPanelOpen, pollForUpdates]);

  // Initial load
  useEffect(() => {
    loadConversations();
    lastPollTimestamp.current = new Date().toISOString();
  }, [loadConversations]);

  // Reload when role changes
  useEffect(() => {
    loadConversations();
  }, [currentRole, loadConversations]);

  const value = {
    // Panel state
    isPanelOpen,
    togglePanel,
    openPanel,
    closePanel,

    // Conversations
    conversations,
    activeConversationId,
    selectConversation,
    createConversation,
    joinConversation,
    isLoadingConversations,

    // Messages
    messages,
    sendMessage,
    sendMessageWithAttachments,
    askAI,
    loadMessages,
    isLoadingMessages,
    hasMoreMessages,

    // Unread
    totalUnreadCount,
    unreadCounts
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

export default ChatContext;
