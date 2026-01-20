import React, { useState, useRef, useEffect } from 'react';
import { Send, Paperclip, X, FileText, Image as ImageIcon, File, Bot } from 'lucide-react';
import { cn } from '@/lib/utils';

// Get file icon based on type
function getFileIcon(mimeType) {
  if (mimeType?.startsWith('image/')) return ImageIcon;
  if (mimeType?.includes('pdf')) return FileText;
  return File;
}

// Format file size
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MessageInput({ onSend, onSendWithAttachments, onAskAI, placeholder = "Type a message...", aiEnabled = true }) {
  const [content, setContent] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [showAISuggestions, setShowAISuggestions] = useState(false);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);

  // Check if the current message is an AI query (starts with @AI or /ai)
  const isAIQuery = content.trim().toLowerCase().startsWith('@ai ') || content.trim().toLowerCase().startsWith('/ai ');

  // Extract AI question from the message
  const getAIQuestion = () => {
    const trimmed = content.trim();
    if (trimmed.toLowerCase().startsWith('@ai ')) {
      return trimmed.substring(4).trim();
    }
    if (trimmed.toLowerCase().startsWith('/ai ')) {
      return trimmed.substring(4).trim();
    }
    return trimmed;
  };

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [content]);

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    const maxFileSize = 10 * 1024 * 1024; // 10MB
    const maxFiles = 5;

    // Filter and validate files
    const validFiles = files
      .filter(file => file.size <= maxFileSize)
      .slice(0, maxFiles - attachments.length);

    // Create preview data for each file
    const newAttachments = validFiles.map(file => ({
      file,
      name: file.name,
      size: file.size,
      type: file.type,
      preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    }));

    setAttachments(prev => [...prev, ...newAttachments].slice(0, maxFiles));

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (index) => {
    setAttachments(prev => {
      const updated = [...prev];
      // Revoke object URL if it exists
      if (updated[index].preview) {
        URL.revokeObjectURL(updated[index].preview);
      }
      updated.splice(index, 1);
      return updated;
    });
  };

  const handleSubmit = () => {
    if (!content.trim() && attachments.length === 0) return;

    // Check if this is an AI query
    if (isAIQuery && onAskAI) {
      const question = getAIQuestion();
      if (question) {
        onAskAI(question);
        setContent('');
        setShowAISuggestions(false);
        return;
      }
    }

    if (attachments.length > 0 && onSendWithAttachments) {
      onSendWithAttachments(content.trim(), attachments);
    } else {
      onSend(content.trim());
    }

    // Clear state
    setContent('');
    setShowAISuggestions(false);
    // Clean up previews
    attachments.forEach(att => {
      if (att.preview) URL.revokeObjectURL(att.preview);
    });
    setAttachments([]);
  };

  const handleKeyDown = (e) => {
    // Send on Enter (without Shift)
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const charCount = content.length;
  const maxChars = 10000;
  const isOverLimit = charCount > maxChars;

  return (
    <div className="border-t border-[#E5E5E5] bg-white p-4">
      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {attachments.map((att, idx) => {
            const FileIcon = getFileIcon(att.type);
            return (
              <div
                key={idx}
                className="relative group flex items-center gap-2 px-3 py-2 bg-[#F5F5F5] rounded-lg border border-[#E5E5E5]"
              >
                {att.preview ? (
                  <img
                    src={att.preview}
                    alt={att.name}
                    className="w-10 h-10 object-cover rounded"
                  />
                ) : (
                  <div className="w-10 h-10 bg-[#E5E5E5] rounded flex items-center justify-center">
                    <FileIcon className="w-5 h-5 text-[#737373]" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#171717] truncate max-w-[120px]">
                    {att.name}
                  </p>
                  <p className="text-xs text-[#A3A3A3]">
                    {formatFileSize(att.size)}
                  </p>
                </div>
                <button
                  onClick={() => removeAttachment(idx)}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-[#737373] hover:bg-[#525252] text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-2">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
        />

        {/* Attachment button */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors flex-shrink-0",
            attachments.length >= 5
              ? "text-[#A3A3A3] cursor-not-allowed"
              : "text-[#737373] hover:text-[#171717]"
          )}
          title={attachments.length >= 5 ? "Maximum 5 files" : "Attach file"}
          disabled={attachments.length >= 5}
        >
          <Paperclip className="w-5 h-5" />
        </button>

        {/* Input area */}
        <div className="flex-1 relative">
          <textarea
            ref={textareaRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            className={cn(
              "w-full resize-none rounded-lg border border-[#E5E5E5] px-3 py-2",
              "text-sm text-[#171717] placeholder:text-[#A3A3A3]",
              "focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] focus:border-transparent",
              "transition-colors",
              isOverLimit && "border-red-500 focus:ring-red-500"
            )}
            style={{ minHeight: '40px', maxHeight: '120px' }}
          />

          {/* Character count */}
          {charCount > 9000 && (
            <span className={cn(
              "absolute bottom-1 right-2 text-xs",
              isOverLimit ? "text-red-500" : "text-[#A3A3A3]"
            )}>
              {charCount}/{maxChars}
            </span>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={handleSubmit}
          disabled={(!content.trim() && attachments.length === 0) || isOverLimit}
          className={cn(
            "p-2 rounded-lg transition-colors flex-shrink-0",
            (content.trim() || attachments.length > 0) && !isOverLimit
              ? "bg-[#0A0A0A] text-white hover:bg-[#171717]"
              : "bg-[#F5F5F5] text-[#A3A3A3] cursor-not-allowed"
          )}
        >
          <Send className="w-5 h-5" />
        </button>
      </div>

      {/* AI Indicator */}
      {isAIQuery && (
        <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-purple-50 border border-purple-200 rounded-lg">
          <Bot className="w-4 h-4 text-purple-600" />
          <span className="text-xs text-purple-700">
            AI Assistant will answer your question and post the response in the chat
          </span>
        </div>
      )}

      {/* Hint */}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-xs text-[#A3A3A3]">
          Press <kbd className="px-1 py-0.5 bg-[#F5F5F5] rounded text-[10px]">Enter</kbd> to send,{' '}
          <kbd className="px-1 py-0.5 bg-[#F5F5F5] rounded text-[10px]">Shift + Enter</kbd> for new line
        </p>
        {aiEnabled && (
          <p className="text-xs text-[#A3A3A3]">
            Type <kbd className="px-1 py-0.5 bg-purple-100 text-purple-700 rounded text-[10px]">@AI</kbd> to ask the assistant
          </p>
        )}
      </div>
    </div>
  );
}
