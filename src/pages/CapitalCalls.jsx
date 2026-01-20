import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useAuth } from '@/lib/AuthContext';
import {
  DollarSign, Plus, Search, ChevronDown, ChevronUp,
  Loader2, AlertCircle, CheckCircle2, Clock, Send, X,
  ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || '';

function formatCurrency(value) {
  if (!value) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

const STATUS_CONFIG = {
  DRAFT: { label: 'Draft', color: 'bg-gray-100 text-gray-700', icon: Clock },
  ISSUED: { label: 'Issued', color: 'bg-blue-100 text-blue-700', icon: Send },
  PARTIALLY_FUNDED: { label: 'Partially Funded', color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
  FUNDED: { label: 'Funded', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-100 text-red-700', icon: X }
};

const PURPOSE_OPTIONS = [
  { value: 'INITIAL_FUNDING', label: 'Initial Funding' },
  { value: 'CAPEX', label: 'Capital Expenditure' },
  { value: 'OPERATING_SHORTFALL', label: 'Operating Shortfall' },
  { value: 'OTHER', label: 'Other' }
];

function CapitalCallRow({ call, deal, onIssue, onMarkFunded, onExpand, isExpanded }) {
  const config = STATUS_CONFIG[call.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = config.icon;

  const fundedAmount = call.allocations?.reduce((sum, a) => sum + (a.fundedAmount || 0), 0) || 0;
  const fundedPercent = call.totalAmount ? ((fundedAmount / call.totalAmount) * 100).toFixed(0) : 0;

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="py-4 px-4">
          <button
            onClick={() => onExpand(call.id)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>
        <td className="py-4 px-4">
          <div className="font-medium text-gray-900">{call.title}</div>
          <div className="text-sm text-gray-500">{PURPOSE_OPTIONS.find(p => p.value === call.purpose)?.label || call.purpose}</div>
        </td>
        <td className="py-4 px-4">
          <div className="text-gray-900">{deal?.name || call.dealId}</div>
        </td>
        <td className="py-4 px-4 text-right font-medium">
          {formatCurrency(call.totalAmount)}
        </td>
        <td className="py-4 px-4">
          {formatDate(call.dueDate)}
        </td>
        <td className="py-4 px-4">
          <Badge className={cn("gap-1", config.color)}>
            <StatusIcon className="w-3 h-3" />
            {config.label}
          </Badge>
        </td>
        <td className="py-4 px-4">
          {call.status !== 'DRAFT' && call.status !== 'CANCELLED' && (
            <div className="w-24">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{fundedPercent}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${fundedPercent}%` }}
                />
              </div>
            </div>
          )}
        </td>
        <td className="py-4 px-4">
          <div className="flex gap-2 justify-end">
            {call.status === 'DRAFT' && (
              <Button size="sm" onClick={() => onIssue(call)}>
                <Send className="w-3 h-3 mr-1" />
                Issue
              </Button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={8} className="px-4 py-4">
            <div className="pl-8">
              <h4 className="font-medium text-gray-900 mb-3">LP Allocations</h4>
              {call.allocations && call.allocations.length > 0 ? (
                <table className="w-full">
                  <thead>
                    <tr className="text-sm text-gray-500">
                      <th className="text-left py-2">Investor</th>
                      <th className="text-right py-2">Amount</th>
                      <th className="text-left py-2">Status</th>
                      <th className="text-right py-2">Funded</th>
                      <th className="py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {call.allocations.map(alloc => (
                      <tr key={alloc.id} className="border-t border-gray-200">
                        <td className="py-2 text-gray-900">{alloc.lpEntityName || alloc.lpActorId}</td>
                        <td className="py-2 text-right">{formatCurrency(alloc.amount)}</td>
                        <td className="py-2">
                          <Badge variant={alloc.status === 'FUNDED' ? 'default' : 'secondary'}>
                            {alloc.status}
                          </Badge>
                        </td>
                        <td className="py-2 text-right">{formatCurrency(alloc.fundedAmount)}</td>
                        <td className="py-2 text-right">
                          {alloc.status !== 'FUNDED' && call.status !== 'CANCELLED' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onMarkFunded(call, alloc)}
                            >
                              Mark Funded
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="text-gray-500 text-sm">No allocations yet. Issue the capital call to create LP allocations.</p>
              )}

              {call.wireInstructions && (
                <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
                  <h5 className="font-medium text-gray-900 mb-2">Wire Instructions</h5>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Bank:</span>
                      <span className="ml-2 text-gray-900">{call.wireInstructions.bankName}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Account:</span>
                      <span className="ml-2 text-gray-900">{call.wireInstructions.accountNumber}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Routing:</span>
                      <span className="ml-2 text-gray-900">{call.wireInstructions.routingNumber}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Reference:</span>
                      <span className="ml-2 text-gray-900">{call.wireInstructions.reference}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CreateCapitalCallDialog({ open, onClose, deals, onSuccess }) {
  const { authToken } = useAuth();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    dealId: '',
    title: '',
    purpose: 'INITIAL_FUNDING',
    totalAmount: '',
    dueDate: '',
    description: '',
    wireInstructions: {
      bankName: '',
      accountNumber: '',
      routingNumber: '',
      reference: ''
    }
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${data.dealId}/capital-calls`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({
          title: data.title,
          purpose: data.purpose,
          totalAmount: parseFloat(data.totalAmount),
          dueDate: data.dueDate,
          description: data.description,
          wireInstructions: data.wireInstructions
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create capital call');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['capital-calls']);
      toast({ title: 'Capital call created', description: 'You can now issue it to LPs.' });
      onSuccess?.();
      onClose();
      setFormData({
        dealId: '',
        title: '',
        purpose: 'INITIAL_FUNDING',
        totalAmount: '',
        dueDate: '',
        description: '',
        wireInstructions: { bankName: '', accountNumber: '', routingNumber: '', reference: '' }
      });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.dealId || !formData.title || !formData.totalAmount || !formData.dueDate) {
      toast({ title: 'Missing fields', description: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Capital Call</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Deal *</label>
              <Select value={formData.dealId} onValueChange={(v) => setFormData({ ...formData, dealId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a deal" />
                </SelectTrigger>
                <SelectContent>
                  {deals.map(deal => (
                    <SelectItem key={deal.id} value={deal.id}>{deal.name || deal.id}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Q1 2026 Capital Call"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Purpose *</label>
              <Select value={formData.purpose} onValueChange={(v) => setFormData({ ...formData, purpose: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount *</label>
              <Input
                type="number"
                value={formData.totalAmount}
                onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
                placeholder="500000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date *</label>
              <Input
                type="date"
                value={formData.dueDate}
                onChange={(e) => setFormData({ ...formData, dueDate: e.target.value })}
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description for LPs..."
                rows={2}
              />
            </div>
          </div>

          <div className="border-t pt-4">
            <h4 className="font-medium text-gray-900 mb-3">Wire Instructions</h4>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bank Name</label>
                <Input
                  value={formData.wireInstructions.bankName}
                  onChange={(e) => setFormData({
                    ...formData,
                    wireInstructions: { ...formData.wireInstructions, bankName: e.target.value }
                  })}
                  placeholder="First National Bank"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Account Number</label>
                <Input
                  value={formData.wireInstructions.accountNumber}
                  onChange={(e) => setFormData({
                    ...formData,
                    wireInstructions: { ...formData.wireInstructions, accountNumber: e.target.value }
                  })}
                  placeholder="123456789"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Routing Number</label>
                <Input
                  value={formData.wireInstructions.routingNumber}
                  onChange={(e) => setFormData({
                    ...formData,
                    wireInstructions: { ...formData.wireInstructions, routingNumber: e.target.value }
                  })}
                  placeholder="021000021"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Reference</label>
                <Input
                  value={formData.wireInstructions.reference}
                  onChange={(e) => setFormData({
                    ...formData,
                    wireInstructions: { ...formData.wireInstructions, reference: e.target.value }
                  })}
                  placeholder="DEAL-001-CC-001"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Capital Call
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function CapitalCalls() {
  const navigate = useNavigate();
  const { authToken } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeal, setSelectedDeal] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Fetch all deals
  const dealsQuery = useQuery({
    queryKey: ['deals'],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/deals`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to fetch deals');
      return res.json();
    }
  });

  // Fetch all capital calls
  const capitalCallsQuery = useQuery({
    queryKey: ['capital-calls', selectedDeal],
    queryFn: async () => {
      // If specific deal selected, fetch for that deal
      if (selectedDeal !== 'all') {
        const res = await fetch(`${BFF_BASE}/api/deals/${selectedDeal}/capital-calls`, {
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          }
        });
        if (!res.ok) {
          if (res.status === 404) return { capitalCalls: [] };
          throw new Error('Failed to fetch capital calls');
        }
        return res.json();
      }

      // Fetch for all deals
      const deals = dealsQuery.data || [];
      const allCalls = await Promise.all(
        deals.map(async (deal) => {
          try {
            const res = await fetch(`${BFF_BASE}/api/deals/${deal.id}/capital-calls`, {
              headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
              }
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.capitalCalls || []).map(cc => ({ ...cc, dealId: deal.id }));
          } catch {
            return [];
          }
        })
      );
      return { capitalCalls: allCalls.flat() };
    },
    enabled: !!dealsQuery.data
  });

  const issueMutation = useMutation({
    mutationFn: async (call) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${call.dealId}/capital-calls/${call.id}/issue`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to issue capital call');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['capital-calls']);
      toast({ title: 'Capital call issued', description: 'LPs have been notified.' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const markFundedMutation = useMutation({
    mutationFn: async ({ call, alloc }) => {
      const res = await fetch(
        `${BFF_BASE}/api/deals/${call.dealId}/capital-calls/${call.id}/allocations/${alloc.lpActorId}/mark-funded`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({ amount: alloc.amount })
        }
      );
      if (!res.ok) throw new Error('Failed to mark as funded');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['capital-calls']);
      toast({ title: 'Marked as funded' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const deals = dealsQuery.data || [];
  const capitalCalls = capitalCallsQuery.data?.capitalCalls || [];

  // Filter capital calls
  const filteredCalls = capitalCalls.filter(call => {
    const matchesSearch = !searchQuery ||
      call.title?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDeal = selectedDeal === 'all' || call.dealId === selectedDeal;
    const matchesStatus = selectedStatus === 'all' || call.status === selectedStatus;
    return matchesSearch && matchesDeal && matchesStatus;
  });

  const isLoading = dealsQuery.isLoading || capitalCallsQuery.isLoading;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate(createPageUrl('Investors'))}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Capital Calls</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage capital calls across all deals</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Capital Call
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search capital calls..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={selectedDeal} onValueChange={setSelectedDeal}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All Deals" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Deals</SelectItem>
            {deals.map(deal => (
              <SelectItem key={deal.id} value={deal.id}>{deal.name || deal.id}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={selectedStatus} onValueChange={setSelectedStatus}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            {Object.entries(STATUS_CONFIG).map(([key, config]) => (
              <SelectItem key={key} value={key}>{config.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Capital Calls Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="text-center py-12">
            <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Capital Calls</h3>
            <p className="text-gray-500 mb-4">Create your first capital call to request funds from LPs.</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Capital Call
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-3 px-4 w-10"></th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Title</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Deal</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">Amount</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Due Date</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Funded</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filteredCalls.map(call => (
                <CapitalCallRow
                  key={call.id}
                  call={call}
                  deal={deals.find(d => d.id === call.dealId)}
                  onIssue={(c) => issueMutation.mutate(c)}
                  onMarkFunded={(c, a) => markFundedMutation.mutate({ call: c, alloc: a })}
                  onExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                  isExpanded={expandedId === call.id}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Dialog */}
      <CreateCapitalCallDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        deals={deals}
        onSuccess={() => queryClient.invalidateQueries(['capital-calls'])}
      />
    </div>
  );
}
