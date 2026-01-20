import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { X, UserPlus, Trash2, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { bff } from '@/api/bffClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

export default function AssignAnalystModal({ dealId, dealName, isOpen, onClose }) {
  const queryClient = useQueryClient();
  const [newAnalystName, setNewAnalystName] = useState('');
  const [newAnalystId, setNewAnalystId] = useState('');

  // Fetch current assignments
  const { data: assignmentsData, isLoading } = useQuery({
    queryKey: ['deal-assignments', dealId],
    queryFn: () => bff.deals.assignments.list(dealId),
    enabled: isOpen && !!dealId
  });

  // Assign mutation
  const assignMutation = useMutation({
    mutationFn: ({ userId, userName }) =>
      bff.deals.assignments.assign(dealId, userId, userName, 'analyst'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-assignments', dealId] });
      setNewAnalystName('');
      setNewAnalystId('');
    }
  });

  // Unassign mutation
  const unassignMutation = useMutation({
    mutationFn: (userId) => bff.deals.assignments.unassign(dealId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deal-assignments', dealId] });
    }
  });

  const handleAssign = (e) => {
    e.preventDefault();
    if (!newAnalystId.trim()) return;

    assignMutation.mutate({
      userId: newAnalystId.trim(),
      userName: newAnalystName.trim() || newAnalystId.trim()
    });
  };

  if (!isOpen) return null;

  const assignments = assignmentsData?.assignments || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E5E5]">
          <div>
            <h2 className="text-lg font-semibold text-[#171717]">Assign Analysts</h2>
            <p className="text-sm text-[#737373]">{dealName}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-[#F5F5F5] rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-[#737373]" />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {/* Add New Analyst Form */}
          <form onSubmit={handleAssign} className="mb-6">
            <label className="block text-sm font-medium text-[#171717] mb-2">
              Add Analyst
            </label>
            <div className="space-y-2">
              <Input
                value={newAnalystId}
                onChange={(e) => setNewAnalystId(e.target.value)}
                placeholder="Analyst ID (e.g., analyst-1)"
                className="h-9"
              />
              <Input
                value={newAnalystName}
                onChange={(e) => setNewAnalystName(e.target.value)}
                placeholder="Display name (optional)"
                className="h-9"
              />
              <Button
                type="submit"
                disabled={!newAnalystId.trim() || assignMutation.isPending}
                className="w-full h-9"
              >
                {assignMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <UserPlus className="w-4 h-4 mr-2" />
                )}
                Assign to Deal
              </Button>
            </div>
            {assignMutation.isError && (
              <p className="text-sm text-red-600 mt-2">
                {assignMutation.error?.message || 'Failed to assign analyst'}
              </p>
            )}
          </form>

          {/* Current Assignments */}
          <div>
            <label className="block text-sm font-medium text-[#171717] mb-2">
              Current Analysts
            </label>

            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-[#A3A3A3]" />
              </div>
            ) : assignments.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-[#A3A3A3]">No analysts assigned yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {assignments.map((assignment) => (
                  <div
                    key={assignment.id}
                    className="flex items-center justify-between p-3 bg-[#FAFAFA] rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                        <span className="text-sm font-medium text-teal-700">
                          {(assignment.userName || assignment.userId).charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-[#171717]">
                          {assignment.userName || assignment.userId}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs capitalize">
                            {assignment.role}
                          </Badge>
                          <span className="text-xs text-[#A3A3A3]">
                            Assigned {new Date(assignment.assignedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => unassignMutation.mutate(assignment.userId)}
                      disabled={unassignMutation.isPending}
                      className={cn(
                        "p-2 rounded-lg transition-colors",
                        "hover:bg-red-50 text-[#A3A3A3] hover:text-red-600"
                      )}
                    >
                      {unassignMutation.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#E5E5E5] bg-[#FAFAFA]">
          <p className="text-xs text-[#737373]">
            Assigned analysts can view and edit this deal. Only GPs can assign or remove analysts.
          </p>
        </div>
      </div>
    </div>
  );
}
