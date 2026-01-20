import React, { useState } from 'react';
import { MoreHorizontal, CheckSquare, FileText, Image as ImageIcon, File, Download, ExternalLink, Bot, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// Get file icon based on type
function getFileIcon(mimeType) {
  if (mimeType?.startsWith('image/')) return ImageIcon;
  if (mimeType?.includes('pdf')) return FileText;
  return File;
}

// Format file size
function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatDateSeparator(isoString) {
  const date = new Date(isoString);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === now.toDateString()) {
    return 'Today';
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric'
  });
}

function MessageItem({ message, showHeader, showActions, onAction }) {
  const [showMenu, setShowMenu] = useState(false);
  const isSystem = message.contentType === 'system';
  const isTask = message.contentType === 'task';
  const isAIResponse = message.contentType === 'ai_response' || message.senderId === 'ai-assistant';
  const isPending = message.isPending;

  if (isSystem || isTask) {
    return (
      <div className="px-4 py-2 text-center">
        <span className={cn(
          "text-xs italic",
          isTask ? "text-green-600" : "text-[#A3A3A3]"
        )}>
          {isTask && <CheckSquare className="w-3 h-3 inline mr-1" />}
          {message.content}
        </span>
      </div>
    );
  }

  // Special rendering for AI responses
  if (isAIResponse) {
    return (
      <div className={cn(
        "px-4 py-3 my-2 mx-4 rounded-lg",
        "bg-gradient-to-br from-purple-50 to-indigo-50",
        "border border-purple-200",
        isPending && "opacity-60"
      )}>
        <div className="flex items-center gap-2 mb-2">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <span className="font-medium text-sm text-purple-700">AI Assistant</span>
          {isPending && (
            <span className="flex items-center gap-1 text-xs text-purple-500">
              <Sparkles className="w-3 h-3 animate-pulse" />
              Thinking...
            </span>
          )}
          <span className="text-xs text-purple-400 ml-auto">
            {formatTime(message.createdAt)}
          </span>
        </div>
        <div className="text-sm text-[#171717] whitespace-pre-wrap break-words pl-9">
          {message.content}
        </div>
      </div>
    );
  }

  // Get initials for avatar
  const initials = message.senderName
    .split(' ')
    .map(n => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();

  // Generate consistent color based on sender name
  const colors = [
    'bg-blue-500',
    'bg-green-500',
    'bg-purple-500',
    'bg-orange-500',
    'bg-pink-500',
    'bg-teal-500',
    'bg-indigo-500',
    'bg-red-500'
  ];
  const colorIndex = message.senderName.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % colors.length;
  const avatarColor = colors[colorIndex];

  // Parse attachments
  const attachments = message.attachments ? JSON.parse(message.attachments) : [];

  // Render @mentions with highlighting
  const renderContent = (content) => {
    const mentionRegex = /@(\w+)/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = mentionRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(content.slice(lastIndex, match.index));
      }
      parts.push(
        <span key={match.index} className="bg-blue-100 text-blue-700 px-1 rounded">
          @{match[1]}
        </span>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(content.slice(lastIndex));
    }

    return parts.length > 0 ? parts : content;
  };

  return (
    <div
      className={cn(
        "px-4 py-1 hover:bg-[#FAFAFA] transition-colors group relative",
        showHeader && "pt-3"
      )}
      onMouseLeave={() => setShowMenu(false)}
    >
      <div className="flex gap-3">
        {/* Avatar - only show for first message in group */}
        <div className="w-8 flex-shrink-0">
          {showHeader && (
            <div className={cn(
              "w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold",
              avatarColor
            )}>
              {initials}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {showHeader && (
            <div className="flex items-baseline gap-2 mb-0.5">
              <span className="font-semibold text-sm text-[#171717]">
                {message.senderName}
              </span>
              <span className="text-xs text-[#A3A3A3]">
                {formatTime(message.createdAt)}
              </span>
              {message.isEdited && (
                <span className="text-xs text-[#A3A3A3]">(edited)</span>
              )}
            </div>
          )}

          <p className={cn(
            "text-sm text-[#171717] whitespace-pre-wrap break-words",
            isPending && "opacity-50"
          )}>
            {renderContent(message.content)}
          </p>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="mt-2 space-y-2">
              {/* Image grid for image attachments */}
              {attachments.filter(att => att.type?.startsWith('image/')).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.filter(att => att.type?.startsWith('image/')).map((att, idx) => (
                    <a
                      key={idx}
                      href={att.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block relative group"
                    >
                      <img
                        src={att.thumbnailUrl || att.url}
                        alt={att.name}
                        className="max-w-[200px] max-h-[150px] rounded-lg border border-[#E5E5E5] object-cover"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors flex items-center justify-center">
                        <ExternalLink className="w-5 h-5 text-white opacity-0 group-hover:opacity-100 drop-shadow-lg transition-opacity" />
                      </div>
                    </a>
                  ))}
                </div>
              )}
              {/* File list for non-image attachments */}
              {attachments.filter(att => !att.type?.startsWith('image/')).map((att, idx) => {
                const FileIcon = getFileIcon(att.type);
                return (
                  <a
                    key={idx}
                    href={att.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={att.name}
                    className="flex items-center gap-3 p-3 bg-[#F5F5F5] rounded-lg border border-[#E5E5E5] hover:border-[#A3A3A3] hover:bg-[#EFEFEF] transition-colors max-w-[300px]"
                  >
                    <div className="w-10 h-10 bg-[#E5E5E5] rounded flex items-center justify-center flex-shrink-0">
                      <FileIcon className="w-5 h-5 text-[#737373]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[#171717] truncate">
                        {att.name}
                      </p>
                      <p className="text-xs text-[#A3A3A3]">
                        {formatFileSize(att.size)}
                      </p>
                    </div>
                    <Download className="w-4 h-4 text-[#A3A3A3] flex-shrink-0" />
                  </a>
                );
              })}
            </div>
          )}

          {message.replyCount > 0 && (
            <button className="mt-1 text-xs text-blue-600 hover:underline">
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>

        {/* Actions menu */}
        {showActions && !isPending && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="p-1 hover:bg-[#E5E5E5] rounded transition-colors"
            >
              <MoreHorizontal className="w-4 h-4 text-[#737373]" />
            </button>

            {showMenu && (
              <div className="absolute right-4 top-full mt-1 bg-white border border-[#E5E5E5] rounded-lg shadow-lg py-1 z-10">
                <button
                  onClick={() => {
                    onAction?.(message, 'createTask');
                    setShowMenu(false);
                  }}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[#171717] hover:bg-[#F5F5F5] w-full text-left"
                >
                  <CheckSquare className="w-4 h-4" />
                  Create Task
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MessageList({ messages, showActions = false, onMessageAction }) {
  if (!messages || messages.length === 0) {
    return null;
  }

  // Group messages and add date separators
  const elements = [];
  let currentDate = null;
  let lastSenderId = null;
  let lastMessageTime = null;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    const messageDate = new Date(message.createdAt).toDateString();

    // Add date separator if date changed
    if (messageDate !== currentDate) {
      currentDate = messageDate;
      elements.push(
        <div key={`date-${messageDate}`} className="flex items-center gap-4 px-4 py-4">
          <div className="flex-1 h-px bg-[#E5E5E5]" />
          <span className="text-xs font-medium text-[#A3A3A3]">
            {formatDateSeparator(message.createdAt)}
          </span>
          <div className="flex-1 h-px bg-[#E5E5E5]" />
        </div>
      );
      lastSenderId = null;
      lastMessageTime = null;
    }

    // Determine if we should show the header (sender info)
    // Show header if:
    // 1. Different sender from last message
    // 2. More than 5 minutes since last message
    // 3. System message before/after
    const timeDiff = lastMessageTime
      ? (new Date(message.createdAt) - new Date(lastMessageTime)) / 60000
      : Infinity;

    const showHeader =
      message.senderId !== lastSenderId ||
      timeDiff > 5 ||
      message.contentType === 'system' ||
      (i > 0 && messages[i - 1].contentType === 'system');

    elements.push(
      <MessageItem
        key={message.id}
        message={message}
        showHeader={showHeader}
        showActions={showActions}
        onAction={onMessageAction}
      />
    );

    lastSenderId = message.senderId;
    lastMessageTime = message.createdAt;
  }

  return <div className="py-2">{elements}</div>;
}
