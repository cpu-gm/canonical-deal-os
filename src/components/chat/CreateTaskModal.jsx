import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, CheckSquare, Loader2, Calendar, AlertCircle } from 'lucide-react';
import { bff } from '@/api/bffClient';
import { cn } from '@/lib/utils';

const PRIORITIES = [
  { value: 'LOW', label: 'Low', color: 'bg-gray-100 text-gray-600' },
  { value: 'MEDIUM', label: 'Medium', color: 'bg-blue-100 text-blue-600' },
  { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-600' },
  { value: 'URGENT', label: 'Urgent', color: 'bg-red-100 text-red-600' }
];

export default function CreateTaskModal({
  isOpen,
  onClose,
  sourceMessage,
  dealId,
  conversationId
}) {
  const queryClient = useQueryClient();

  // Pre-fill title from message content if available
  const defaultTitle = sourceMessage?.content
    ? sourceMessage.content.substring(0, 100).split('\n')[0]
    : '';

  const [title, setTitle] = useState(defaultTitle);
  const [description, setDescription] = useState(
    sourceMessage?.content || ''
  );
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState(null);

  const createMutation = useMutation({
    mutationFn: (payload) => bff.tasks.create(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['deal-messages', conversationId] });
      queryClient.invalidateQueries({ queryKey: ['activity-feed'] });
      onClose();
    },
    onError: (err) => {
      setError(err.message || 'Failed to create task');
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Task title is required');
      return;
    }

    createMutation.mutate({
      title: title.trim(),
      description: description.trim() || null,
      priority,
      dueDate: dueDate || null,
      dealId,
      conversationId,
      sourceMessageId: sourceMessage?.id
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-[60]"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
            <div className="flex items-center gap-2">
              <CheckSquare className="w-5 h-5 text-[#737373]" />
              <h2 className="text-lg font-semibold text-[#171717]">Create Task</h2>
            </div>
            <button
              onClick={onClose}
              className="p-2 -mr-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#737373]" />
            </button>
          </div>

          {/* Source message preview */}
          {sourceMessage && (
            <div className="px-6 py-3 bg-[#FAFAFA] border-b border-[#E5E5E5]">
              <p className="text-xs text-[#A3A3A3] mb-1">Creating task from message:</p>
              <p className="text-sm text-[#737373] line-clamp-2">
                "{sourceMessage.content.substring(0, 150)}{sourceMessage.content.length > 150 ? '...' : ''}"
              </p>
              <p className="text-xs text-[#A3A3A3] mt-1">- {sourceMessage.senderName}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-1">
                Task Title <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs to be done?"
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]"
                maxLength={200}
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add more details..."
                rows={3}
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] resize-none"
                maxLength={1000}
              />
            </div>

            {/* Priority */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-2">
                Priority
              </label>
              <div className="flex gap-2">
                {PRIORITIES.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      "px-3 py-1.5 text-sm rounded-full border transition-colors",
                      priority === p.value
                        ? p.color + " border-current"
                        : "bg-white text-[#737373] border-[#E5E5E5] hover:border-[#A3A3A3]"
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Due Date */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-1">
                Due Date
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A3A3A3]" />
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]"
                />
              </div>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-red-500 text-sm">
                <AlertCircle className="w-4 h-4" />
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 text-sm font-medium text-[#737373] bg-[#F5F5F5] rounded-lg hover:bg-[#E5E5E5] transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending || !title.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#0A0A0A] rounded-lg hover:bg-[#171717] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Task'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
