import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, Loader2, Sparkles, AlertTriangle, Info, CheckCircle, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bff } from '@/api/bffClient';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

/**
 * DealChat - Context-aware AI chat for a specific deal
 *
 * Features:
 * - Loads full deal context (model, extractions, scenarios, etc.)
 * - AI has access to all deal data and can cite sources
 * - Maintains conversation history
 * - Shows auto-generated insights
 */
export default function DealChat({ dealId, dealName }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [insights, setInsights] = useState(null);
  const [isLoadingInsights, setIsLoadingInsights] = useState(true);
  const [error, setError] = useState(null);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Load chat history and insights on mount
  useEffect(() => {
    if (dealId) {
      loadChatHistory();
      loadInsights();
    }
  }, [dealId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const loadChatHistory = async () => {
    setIsLoadingHistory(true);
    try {
      const response = await bff.dealAI.getChatHistory(dealId, { limit: 50 });
      if (response.messages) {
        setMessages(response.messages);
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
      // Don't show error, just start fresh
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadInsights = async () => {
    setIsLoadingInsights(true);
    try {
      const response = await bff.dealAI.getInsights(dealId);
      setInsights(response);
    } catch (err) {
      console.error('Failed to load insights:', err);
    } finally {
      setIsLoadingInsights(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = {
      role: 'user',
      content: inputValue.trim(),
      timestamp: new Date().toISOString()
    };

    // Add user message to UI immediately
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    setError(null);

    try {
      // Build conversation history for context
      const conversationHistory = messages.map(m => ({
        role: m.role,
        content: m.content
      }));

      const response = await bff.dealAI.chat(dealId, {
        message: userMessage.content,
        conversationHistory
      });

      // Add assistant response
      const assistantMessage = {
        role: 'assistant',
        content: response.response || response.message,
        timestamp: new Date().toISOString(),
        sources: response.sources || []
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (err) {
      console.error('Chat error:', err);
      setError(err.message || 'Failed to get response');

      // Add error message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date().toISOString(),
        isError: true
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestedQuestion = (question) => {
    setInputValue(question);
    inputRef.current?.focus();
  };

  const getInsightIcon = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return <AlertTriangle className="w-4 h-4 text-red-500" />;
      case 'WARNING':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'POSITIVE':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'INFO':
      default:
        return <Info className="w-4 h-4 text-blue-500" />;
    }
  };

  const getInsightBadgeVariant = (severity) => {
    switch (severity) {
      case 'CRITICAL':
        return 'destructive';
      case 'WARNING':
        return 'warning';
      case 'POSITIVE':
        return 'success';
      default:
        return 'secondary';
    }
  };

  // Suggested questions based on deal context
  const suggestedQuestions = [
    "What are the key risks in this deal?",
    "How does the cap rate compare to market?",
    "What would IRR be if we exit in year 3?",
    "Explain the debt service coverage ratio",
    "What assumptions drive the returns?"
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Insights Panel (collapsible) */}
      {insights && insights.insights && insights.insights.length > 0 && (
        <div className="p-4 border-b border-[#E5E5E5] bg-[#FAFAFA]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-600" />
              <span className="text-sm font-medium text-[#171717]">AI Insights</span>
              {insights.summary && (
                <Badge variant="secondary" className="text-xs">
                  {insights.summary.total} insights
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadInsights}
              disabled={isLoadingInsights}
            >
              <RefreshCw className={cn("w-3 h-3", isLoadingInsights && "animate-spin")} />
            </Button>
          </div>

          <div className="space-y-2 max-h-40 overflow-y-auto">
            {insights.insights.slice(0, 3).map((insight, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex items-start gap-2 p-2 rounded-md text-sm",
                  insight.severity === 'CRITICAL' && "bg-red-50",
                  insight.severity === 'WARNING' && "bg-amber-50",
                  insight.severity === 'POSITIVE' && "bg-green-50",
                  insight.severity === 'INFO' && "bg-blue-50"
                )}
              >
                {getInsightIcon(insight.severity)}
                <div className="flex-1">
                  <span className="text-[#171717]">{insight.message}</span>
                  {insight.recommendation && (
                    <p className="text-xs text-[#737373] mt-1">{insight.recommendation}</p>
                  )}
                </div>
                <Badge variant={getInsightBadgeVariant(insight.severity)} className="text-xs flex-shrink-0">
                  {insight.category}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4">
        {/* Loading history */}
        {isLoadingHistory ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-6 h-6 text-[#A3A3A3] animate-spin" />
          </div>
        ) : messages.length === 0 ? (
          /* Empty state with suggested questions */
          <div className="flex flex-col items-center justify-center h-full py-8">
            <div className="w-12 h-12 rounded-full bg-purple-100 flex items-center justify-center mb-4">
              <Bot className="w-6 h-6 text-purple-600" />
            </div>
            <h3 className="text-lg font-medium text-[#171717] mb-2">
              Ask about {dealName || 'this deal'}
            </h3>
            <p className="text-sm text-[#737373] text-center mb-6 max-w-md">
              I have full context on this deal including the underwriting model,
              extracted documents, scenarios, and market benchmarks.
            </p>

            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {suggestedQuestions.map((question, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestedQuestion(question)}
                  className="px-3 py-1.5 text-sm bg-[#F5F5F5] hover:bg-[#E5E5E5] rounded-full text-[#525252] transition-colors"
                >
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Message list */
          <div className="space-y-4">
            {messages.map((message, idx) => (
              <div
                key={idx}
                className={cn(
                  "flex gap-3",
                  message.role === 'user' ? "justify-end" : "justify-start"
                )}
              >
                {message.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-purple-600" />
                  </div>
                )}

                <div
                  className={cn(
                    "max-w-[80%] rounded-lg px-4 py-2",
                    message.role === 'user'
                      ? "bg-[#0A0A0A] text-white"
                      : message.isError
                        ? "bg-red-50 text-red-800"
                        : "bg-[#F5F5F5] text-[#171717]"
                  )}
                >
                  <div className="text-sm whitespace-pre-wrap">{message.content}</div>

                  {/* Show sources if available */}
                  {message.sources && message.sources.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-[#E5E5E5]">
                      <p className="text-xs text-[#737373] mb-1">Sources:</p>
                      <div className="flex flex-wrap gap-1">
                        {message.sources.map((source, sidx) => (
                          <Badge key={sidx} variant="outline" className="text-xs">
                            {source}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {message.role === 'user' && (
                  <div className="w-8 h-8 rounded-full bg-[#0A0A0A] flex items-center justify-center flex-shrink-0">
                    <span className="text-xs text-white font-medium">You</span>
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-purple-600" />
                </div>
                <div className="bg-[#F5F5F5] rounded-lg px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-purple-600" />
                    <span className="text-sm text-[#737373]">Analyzing deal data...</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </ScrollArea>

      {/* Input Area */}
      <div className="border-t border-[#E5E5E5] bg-white p-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this deal..."
              rows={1}
              disabled={isLoading}
              className={cn(
                "w-full resize-none rounded-lg border border-[#E5E5E5] px-3 py-2",
                "text-sm text-[#171717] placeholder:text-[#A3A3A3]",
                "focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent",
                "transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              )}
              style={{ minHeight: '40px', maxHeight: '120px' }}
            />
          </div>

          <Button
            onClick={handleSend}
            disabled={!inputValue.trim() || isLoading}
            className="bg-purple-600 hover:bg-purple-700 text-white"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>

        <p className="text-xs text-[#A3A3A3] mt-2">
          Press <kbd className="px-1 py-0.5 bg-[#F5F5F5] rounded text-[10px]">Enter</kbd> to send,{' '}
          <kbd className="px-1 py-0.5 bg-[#F5F5F5] rounded text-[10px]">Shift + Enter</kbd> for new line
        </p>
      </div>
    </div>
  );
}
