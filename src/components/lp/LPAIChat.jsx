import React, { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import { X, Send, Loader2, Bot, User, Sparkles, Minimize2, Maximize2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

const SUGGESTED_QUESTIONS = [
  "What's the current status of my investment?",
  "When was the last distribution?",
  "Are there any pending capital calls?",
  "What were the key highlights from the last update?",
  "How is the investment performing vs plan?"
];

function ChatMessage({ message, isUser }) {
  return (
    <div className={cn(
      "flex gap-3 mb-4",
      isUser && "flex-row-reverse"
    )}>
      <div className={cn(
        "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
        isUser ? "bg-blue-100" : "bg-purple-100"
      )}>
        {isUser ? (
          <User className="w-4 h-4 text-blue-600" />
        ) : (
          <Bot className="w-4 h-4 text-purple-600" />
        )}
      </div>
      <div className={cn(
        "flex-1 max-w-[80%] rounded-xl px-4 py-3",
        isUser ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-900"
      )}>
        <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        <div className={cn(
          "text-xs mt-1",
          isUser ? "text-blue-200" : "text-gray-400"
        )}>
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

export default function LPAIChat() {
  const { dealId } = useParams();
  const { authToken, user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  // Add initial greeting when chat opens
  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([{
        id: 'greeting',
        content: `Hi ${user?.name?.split(' ')[0] || 'there'}! I'm your AI assistant. I can help you understand your investment, answer questions about capital calls, distributions, and updates. What would you like to know?`,
        isUser: false,
        timestamp: new Date()
      }]);
    }
  }, [isOpen, messages.length, user?.name]);

  const chatMutation = useMutation({
    mutationFn: async (question) => {
      // For now, return a mock response. In production, this would call the AI endpoint.
      // The AI would have full context about the LP's investments, capital calls, distributions, etc.

      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

      // Mock responses based on question keywords
      const lowerQuestion = question.toLowerCase();

      if (lowerQuestion.includes('status') || lowerQuestion.includes('investment')) {
        return {
          response: "Your investment is currently in active management. Based on the latest quarterly update, the property is performing well with occupancy at 94% and NOI tracking slightly above plan. There are no outstanding issues requiring your attention."
        };
      }

      if (lowerQuestion.includes('distribution')) {
        return {
          response: "The last distribution was processed in Q4 2025 for $12,500. The next scheduled distribution is expected in Q1 2026. Distributions are typically made quarterly, approximately 45 days after quarter-end."
        };
      }

      if (lowerQuestion.includes('capital call')) {
        return {
          response: "You have no pending capital calls at this time. Your total capital commitment of $500,000 has been fully funded. If any additional capital is needed for improvements or opportunities, you'll receive advance notice via email and through this portal."
        };
      }

      if (lowerQuestion.includes('update') || lowerQuestion.includes('highlight')) {
        return {
          response: "The latest quarterly update (Q4 2025) highlighted:\n\n• Property occupancy increased to 94% (+2% from Q3)\n• NOI is 3% above original underwriting\n• Major tenant renewed for 5 additional years\n• Planned HVAC upgrade completed under budget\n\nOverall, the investment is performing above expectations."
        };
      }

      if (lowerQuestion.includes('perform') || lowerQuestion.includes('plan')) {
        return {
          response: "Your investment is outperforming the original business plan:\n\n• IRR is tracking at 14.2% vs 12.5% projected\n• Cash-on-cash return: 8.1% vs 7.5% projected\n• Equity multiple trending toward 1.8x vs 1.65x projected\n\nThe variance is primarily due to better-than-expected rent growth and lower operating costs."
        };
      }

      return {
        response: "I'd be happy to help with that question. Based on your investment data, let me provide some context. Could you provide a bit more detail about what specific aspect you'd like to know more about? I have access to your investment details, capital events, distributions, and quarterly updates."
      };
    },
    onSuccess: (data) => {
      setMessages(prev => [...prev, {
        id: `ai-${Date.now()}`,
        content: data.response,
        isUser: false,
        timestamp: new Date()
      }]);
      setIsTyping(false);
    },
    onError: () => {
      setMessages(prev => [...prev, {
        id: `error-${Date.now()}`,
        content: "I'm sorry, I encountered an error processing your request. Please try again.",
        isUser: false,
        timestamp: new Date()
      }]);
      setIsTyping(false);
    }
  });

  const handleSend = () => {
    if (!message.trim()) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      content: message.trim(),
      isUser: true,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setMessage('');
    setIsTyping(true);

    chatMutation.mutate(message.trim());
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestionClick = (question) => {
    setMessage(question);
    setTimeout(() => {
      handleSend();
    }, 100);
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-gradient-to-r from-purple-600 to-blue-600 rounded-full shadow-lg hover:shadow-xl transition-all flex items-center justify-center group z-50"
      >
        <Sparkles className="w-6 h-6 text-white group-hover:scale-110 transition-transform" />
        <span className="absolute -top-2 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white animate-pulse" />
      </button>
    );
  }

  return (
    <div className={cn(
      "fixed bottom-6 right-6 bg-white rounded-2xl shadow-2xl border border-gray-200 z-50 flex flex-col transition-all duration-200",
      isMinimized ? "w-80 h-14" : "w-96 h-[500px]"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-purple-600 to-blue-600 rounded-t-2xl">
        <div className="flex items-center gap-2 text-white">
          <Sparkles className="w-5 h-5" />
          <span className="font-semibold">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white"
          >
            {isMinimized ? (
              <Maximize2 className="w-4 h-4" />
            ) : (
              <Minimize2 className="w-4 h-4" />
            )}
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="p-1.5 hover:bg-white/20 rounded-lg transition-colors text-white"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4">
            {messages.map(msg => (
              <ChatMessage key={msg.id} message={msg} isUser={msg.isUser} />
            ))}

            {isTyping && (
              <div className="flex gap-3 mb-4">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-purple-600" />
                </div>
                <div className="bg-gray-100 rounded-xl px-4 py-3">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions (only show if no user messages yet) */}
          {messages.filter(m => m.isUser).length === 0 && (
            <div className="px-4 pb-2">
              <div className="text-xs text-gray-500 mb-2">Suggested questions:</div>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.slice(0, 3).map((q, i) => (
                  <button
                    key={i}
                    onClick={() => handleSuggestionClick(q)}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-full transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <div className="p-4 border-t border-gray-100">
            <div className="flex gap-2">
              <Textarea
                ref={inputRef}
                placeholder="Ask about your investment..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                className="resize-none min-h-[40px] max-h-[100px]"
                rows={1}
              />
              <Button
                onClick={handleSend}
                disabled={!message.trim() || chatMutation.isPending}
                size="icon"
                className="h-10 w-10 flex-shrink-0"
              >
                {chatMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
