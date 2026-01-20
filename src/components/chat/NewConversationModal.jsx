import React, { useState } from 'react';
import { X, Hash, Lock, Loader2 } from 'lucide-react';
import { useChatContext } from '@/context/ChatContext';
import { useRole } from '@/Layout';
import { cn } from '@/lib/utils';

export default function NewConversationModal({ isOpen, onClose }) {
  const { createConversation, selectConversation } = useChatContext();
  const { currentRole } = useRole();

  const [type, setType] = useState('CHANNEL');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('PUBLIC');
  const [allowedRoles, setAllowedRoles] = useState([currentRole]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const availableRoles = ['GP', 'Lender', 'Counsel', 'Regulator', 'Auditor', 'LP'];

  const handleRoleToggle = (role) => {
    setAllowedRoles(prev => {
      if (prev.includes(role)) {
        // Don't allow removing all roles
        if (prev.length === 1) return prev;
        return prev.filter(r => r !== role);
      }
      return [...prev, role];
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (type === 'CHANNEL' && !name.trim()) {
      setError('Channel name is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const payload = {
        type,
        name: name.trim() || null,
        description: description.trim() || null,
        visibility,
        allowedRoles: visibility === 'ROLE_BASED' ? allowedRoles : null
      };

      const conversation = await createConversation(payload);
      selectConversation(conversation.id);
      onClose();

      // Reset form
      setName('');
      setDescription('');
      setVisibility('PUBLIC');
      setAllowedRoles([currentRole]);
    } catch (err) {
      setError(err.message || 'Failed to create conversation');
    } finally {
      setIsSubmitting(false);
    }
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
            <h2 className="text-lg font-semibold text-[#171717]">New Channel</h2>
            <button
              onClick={onClose}
              className="p-2 -mr-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#737373]" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-1">
                Channel Name <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A3A3A3]" />
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))}
                  placeholder="team-updates"
                  className="w-full pl-9 pr-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A0A0A]"
                  maxLength={50}
                />
              </div>
              <p className="mt-1 text-xs text-[#A3A3A3]">
                Lowercase letters, numbers, and hyphens only
              </p>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-1">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's this channel about?"
                rows={2}
                className="w-full px-3 py-2 border border-[#E5E5E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#0A0A0A] resize-none"
                maxLength={200}
              />
            </div>

            {/* Visibility */}
            <div>
              <label className="block text-sm font-medium text-[#171717] mb-2">
                Visibility
              </label>
              <div className="space-y-2">
                <label className={cn(
                  "flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors",
                  visibility === 'PUBLIC'
                    ? "border-[#0A0A0A] bg-[#FAFAFA]"
                    : "border-[#E5E5E5] hover:bg-[#FAFAFA]"
                )}>
                  <input
                    type="radio"
                    name="visibility"
                    value="PUBLIC"
                    checked={visibility === 'PUBLIC'}
                    onChange={(e) => setVisibility(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <Hash className="w-4 h-4 text-[#737373]" />
                      <span className="font-medium text-sm text-[#171717]">Public</span>
                    </div>
                    <p className="text-xs text-[#737373] mt-0.5">
                      Anyone in the organization can view and join
                    </p>
                  </div>
                </label>

                <label className={cn(
                  "flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors",
                  visibility === 'ROLE_BASED'
                    ? "border-[#0A0A0A] bg-[#FAFAFA]"
                    : "border-[#E5E5E5] hover:bg-[#FAFAFA]"
                )}>
                  <input
                    type="radio"
                    name="visibility"
                    value="ROLE_BASED"
                    checked={visibility === 'ROLE_BASED'}
                    onChange={(e) => setVisibility(e.target.value)}
                    className="mt-1"
                  />
                  <div>
                    <div className="flex items-center gap-2">
                      <Lock className="w-4 h-4 text-[#737373]" />
                      <span className="font-medium text-sm text-[#171717]">Role-based</span>
                    </div>
                    <p className="text-xs text-[#737373] mt-0.5">
                      Only users with specific roles can view
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Role selection (if role-based) */}
            {visibility === 'ROLE_BASED' && (
              <div>
                <label className="block text-sm font-medium text-[#171717] mb-2">
                  Allowed Roles
                </label>
                <div className="flex flex-wrap gap-2">
                  {availableRoles.map(role => (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleRoleToggle(role)}
                      className={cn(
                        "px-3 py-1.5 text-sm rounded-full border transition-colors",
                        allowedRoles.includes(role)
                          ? "bg-[#0A0A0A] text-white border-[#0A0A0A]"
                          : "bg-white text-[#737373] border-[#E5E5E5] hover:border-[#A3A3A3]"
                      )}
                    >
                      {role}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <p className="text-sm text-red-500">{error}</p>
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
                disabled={isSubmitting || !name.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#0A0A0A] rounded-lg hover:bg-[#171717] transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Creating...
                  </>
                ) : (
                  'Create Channel'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
