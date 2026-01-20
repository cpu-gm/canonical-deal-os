import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useAuth } from '@/lib/AuthContext';
import {
  Banknote, Plus, Search, ChevronDown, ChevronUp,
  Loader2, AlertCircle, CheckCircle2, Clock, X,
  ArrowLeft
} from 'lucide-react';
import { PerClassBreakdown } from '@/components/underwriting/PerClassBreakdown';
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
  APPROVED: { label: 'Approved', color: 'bg-blue-100 text-blue-700', icon: CheckCircle2 },
  PROCESSING: { label: 'Processing', color: 'bg-amber-100 text-amber-700', icon: AlertCircle },
  PAID: { label: 'Paid', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', color: 'bg-red-100 text-red-700', icon: X }
};

const TYPE_OPTIONS = [
  { value: 'CASH_DISTRIBUTION', label: 'Cash Distribution' },
  { value: 'RETURN_OF_CAPITAL', label: 'Return of Capital' },
  { value: 'TAX_DISTRIBUTION', label: 'Tax Distribution' }
];

function DistributionRow({ distribution, deal, onApprove, onProcess, onMarkPaid, onExpand, isExpanded }) {
  const config = STATUS_CONFIG[distribution.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = config.icon;

  const paidAmount = distribution.allocations?.filter(a => a.status === 'PAID').reduce((sum, a) => sum + (a.netAmount || 0), 0) || 0;
  const paidPercent = distribution.totalAmount ? ((paidAmount / distribution.totalAmount) * 100).toFixed(0) : 0;

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="py-4 px-4">
          <button
            onClick={() => onExpand(distribution.id)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>
        <td className="py-4 px-4">
          <div className="font-medium text-gray-900">{distribution.title}</div>
          <div className="text-sm text-gray-500 flex items-center gap-2 flex-wrap">
            <span>{TYPE_OPTIONS.find(t => t.value === distribution.type)?.label || distribution.type}</span>
            {distribution.period && <span>• {distribution.period}</span>}
            {distribution.allocationMethod && (
              <Badge
                variant="outline"
                className={cn(
                  "text-xs",
                  distribution.allocationMethod === 'WATERFALL'
                    ? "border-violet-200 bg-violet-50 text-violet-700"
                    : "border-gray-200"
                )}
              >
                {distribution.allocationMethod === 'WATERFALL' ? '📊 Waterfall' : '⚖️ Pro-rata'}
              </Badge>
            )}
          </div>
        </td>
        <td className="py-4 px-4">
          <div className="text-gray-900">{deal?.name || distribution.dealId}</div>
        </td>
        <td className="py-4 px-4 text-right font-medium">
          {formatCurrency(distribution.totalAmount)}
        </td>
        <td className="py-4 px-4">
          {formatDate(distribution.distributionDate)}
        </td>
        <td className="py-4 px-4">
          <Badge className={cn("gap-1", config.color)}>
            <StatusIcon className="w-3 h-3" />
            {config.label}
          </Badge>
        </td>
        <td className="py-4 px-4">
          {distribution.status !== 'DRAFT' && distribution.status !== 'CANCELLED' && (
            <div className="w-24">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>{paidPercent}%</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all"
                  style={{ width: `${paidPercent}%` }}
                />
              </div>
            </div>
          )}
        </td>
        <td className="py-4 px-4">
          <div className="flex gap-2 justify-end">
            {distribution.status === 'DRAFT' && (
              <Button size="sm" onClick={() => onApprove(distribution)}>
                Approve
              </Button>
            )}
            {distribution.status === 'APPROVED' && (
              <Button size="sm" onClick={() => onProcess(distribution)}>
                Process
              </Button>
            )}
            {distribution.status === 'PROCESSING' && (
              <Button size="sm" variant="outline" onClick={() => onMarkPaid(distribution)}>
                Mark All Paid
              </Button>
            )}
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={8} className="px-4 py-4">
            <div className="pl-8 space-y-6">
              {/* Per-Class Breakdown */}
              {distribution.byClass && Object.keys(distribution.byClass).length > 1 && (
                <PerClassBreakdown
                  byClass={distribution.byClass}
                  totalAmount={distribution.totalAmount}
                />
              )}

              {/* LP Allocations */}
              <div>
                <h4 className="font-medium text-gray-900 mb-3">LP Allocations</h4>
                {distribution.allocations && distribution.allocations.length > 0 ? (
                  <table className="w-full">
                    <thead>
                      <tr className="text-sm text-gray-500">
                        <th className="text-left py-2">Investor</th>
                        <th className="text-left py-2">Class</th>
                        <th className="text-right py-2">Gross</th>
                        <th className="text-right py-2">Withholding</th>
                        <th className="text-right py-2">Net</th>
                        <th className="text-left py-2">Method</th>
                        <th className="text-left py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {distribution.allocations.map(alloc => (
                        <tr key={alloc.id} className="border-t border-gray-200">
                          <td className="py-2 text-gray-900">{alloc.lpEntityName || alloc.lpActorId}</td>
                          <td className="py-2">
                            {alloc.shareClassCode ? (
                              <Badge variant="outline" className="text-xs">{alloc.shareClassCode}</Badge>
                            ) : (
                              <span className="text-gray-400">-</span>
                            )}
                          </td>
                          <td className="py-2 text-right">{formatCurrency(alloc.grossAmount)}</td>
                          <td className="py-2 text-right text-red-600">
                            {alloc.withholdingAmount > 0 ? `-${formatCurrency(alloc.withholdingAmount)}` : '-'}
                          </td>
                          <td className="py-2 text-right font-medium">{formatCurrency(alloc.netAmount)}</td>
                          <td className="py-2">{alloc.paymentMethod || 'WIRE'}</td>
                          <td className="py-2">
                            <Badge variant={alloc.status === 'PAID' ? 'default' : 'secondary'}>
                              {alloc.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-gray-300">
                      <tr className="font-medium">
                        <td className="py-2">Total</td>
                        <td className="py-2"></td>
                        <td className="py-2 text-right">
                          {formatCurrency(distribution.allocations.reduce((s, a) => s + (a.grossAmount || 0), 0))}
                        </td>
                        <td className="py-2 text-right text-red-600">
                          -{formatCurrency(distribution.allocations.reduce((s, a) => s + (a.withholdingAmount || 0), 0))}
                        </td>
                        <td className="py-2 text-right">
                          {formatCurrency(distribution.allocations.reduce((s, a) => s + (a.netAmount || 0), 0))}
                        </td>
                        <td colSpan={2}></td>
                      </tr>
                    </tfoot>
                  </table>
                ) : (
                  <p className="text-gray-500 text-sm">No allocations yet. Approve the distribution to calculate LP allocations.</p>
                )}
              </div>

              {distribution.description && (
                <div className="mt-4 p-4 bg-white rounded-lg border border-gray-200">
                  <h5 className="font-medium text-gray-900 mb-2">Notes</h5>
                  <p className="text-sm text-gray-600">{distribution.description}</p>
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function CreateDistributionDialog({ open, onClose, deals, onSuccess }) {
  const { authToken } = useAuth();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    dealId: '',
    title: '',
    type: 'CASH_DISTRIBUTION',
    totalAmount: '',
    distributionDate: '',
    period: '',
    description: ''
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${data.dealId}/distributions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({
          title: data.title,
          type: data.type,
          totalAmount: parseFloat(data.totalAmount),
          distributionDate: data.distributionDate,
          period: data.period,
          description: data.description
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create distribution');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['distributions']);
      toast({ title: 'Distribution created', description: 'You can now approve and process it.' });
      onSuccess?.();
      onClose();
      setFormData({
        dealId: '',
        title: '',
        type: 'CASH_DISTRIBUTION',
        totalAmount: '',
        distributionDate: '',
        period: '',
        description: ''
      });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.dealId || !formData.title || !formData.totalAmount || !formData.distributionDate) {
      toast({ title: 'Missing fields', description: 'Please fill in all required fields', variant: 'destructive' });
      return;
    }
    createMutation.mutate(formData);
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Distribution</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., Q4 2025 Distribution"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Period</label>
              <Input
                value={formData.period}
                onChange={(e) => setFormData({ ...formData, period: e.target.value })}
                placeholder="Q4 2025"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Total Amount *</label>
              <Input
                type="number"
                value={formData.totalAmount}
                onChange={(e) => setFormData({ ...formData, totalAmount: e.target.value })}
                placeholder="100000"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Distribution Date *</label>
              <Input
                type="date"
                value={formData.distributionDate}
                onChange={(e) => setFormData({ ...formData, distributionDate: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <Textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional notes about this distribution..."
              rows={2}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Distribution
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Distributions() {
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

  // Fetch all distributions
  const distributionsQuery = useQuery({
    queryKey: ['distributions', selectedDeal],
    queryFn: async () => {
      if (selectedDeal !== 'all') {
        const res = await fetch(`${BFF_BASE}/api/deals/${selectedDeal}/distributions`, {
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          }
        });
        if (!res.ok) {
          if (res.status === 404) return { distributions: [] };
          throw new Error('Failed to fetch distributions');
        }
        return res.json();
      }

      const deals = dealsQuery.data || [];
      const allDistributions = await Promise.all(
        deals.map(async (deal) => {
          try {
            const res = await fetch(`${BFF_BASE}/api/deals/${deal.id}/distributions`, {
              headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
              }
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.distributions || []).map(d => ({ ...d, dealId: deal.id }));
          } catch {
            return [];
          }
        })
      );
      return { distributions: allDistributions.flat() };
    },
    enabled: !!dealsQuery.data
  });

  const approveMutation = useMutation({
    mutationFn: async (dist) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${dist.dealId}/distributions/${dist.id}/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to approve distribution');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['distributions']);
      toast({ title: 'Distribution approved' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const processMutation = useMutation({
    mutationFn: async (dist) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${dist.dealId}/distributions/${dist.id}/process`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to process distribution');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['distributions']);
      toast({ title: 'Distribution processing started' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const markPaidMutation = useMutation({
    mutationFn: async (dist) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${dist.dealId}/distributions/${dist.id}/mark-paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to mark as paid');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['distributions']);
      toast({ title: 'Distribution marked as paid' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const deals = dealsQuery.data || [];
  const distributions = distributionsQuery.data?.distributions || [];

  const filteredDistributions = distributions.filter(dist => {
    const matchesSearch = !searchQuery ||
      dist.title?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDeal = selectedDeal === 'all' || dist.dealId === selectedDeal;
    const matchesStatus = selectedStatus === 'all' || dist.status === selectedStatus;
    return matchesSearch && matchesDeal && matchesStatus;
  });

  const isLoading = dealsQuery.isLoading || distributionsQuery.isLoading;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate(createPageUrl('Investors'))}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Distributions</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage distributions to LPs</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Distribution
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search distributions..."
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

      {/* Distributions Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : filteredDistributions.length === 0 ? (
          <div className="text-center py-12">
            <Banknote className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Distributions</h3>
            <p className="text-gray-500 mb-4">Create your first distribution to send returns to LPs.</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Distribution
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
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Date</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Paid</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filteredDistributions.map(dist => (
                <DistributionRow
                  key={dist.id}
                  distribution={dist}
                  deal={deals.find(d => d.id === dist.dealId)}
                  onApprove={(d) => approveMutation.mutate(d)}
                  onProcess={(d) => processMutation.mutate(d)}
                  onMarkPaid={(d) => markPaidMutation.mutate(d)}
                  onExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                  isExpanded={expandedId === dist.id}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Dialog */}
      <CreateDistributionDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        deals={deals}
        onSuccess={() => queryClient.invalidateQueries(['distributions'])}
      />
    </div>
  );
}
