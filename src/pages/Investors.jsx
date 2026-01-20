import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useAuth } from '@/lib/AuthContext';
import {
  Users, DollarSign, TrendingUp, ChevronRight,
  Plus, Search, Loader2,
  Banknote, PiggyBank, FileText, Send
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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

function SummaryCard({ icon: Icon, label, value, subtext, color = 'blue' }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    amber: 'bg-amber-50 text-amber-600'
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      {subtext && <div className="text-sm text-gray-500 mt-1">{subtext}</div>}
    </div>
  );
}

function InvestorRow({ investor, deals }) {
  const deal = deals.find(d => d.id === investor.dealId);

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="py-4 px-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center">
            <Users className="w-5 h-5 text-gray-500" />
          </div>
          <div>
            <div className="font-medium text-gray-900">{investor.entityName}</div>
            <div className="text-sm text-gray-500">{investor.email}</div>
          </div>
        </div>
      </td>
      <td className="py-4 px-4">
        <Link
          to={createPageUrl('DealOverview') + `?id=${investor.dealId}`}
          className="text-blue-600 hover:underline"
        >
          {deal?.name || investor.dealId}
        </Link>
      </td>
      <td className="py-4 px-4 text-right font-medium">
        {formatCurrency(investor.commitment)}
      </td>
      <td className="py-4 px-4 text-right">
        {investor.ownershipPct?.toFixed(2)}%
      </td>
      <td className="py-4 px-4">
        <Badge variant={investor.status === 'ACTIVE' ? 'default' : 'secondary'}>
          {investor.status}
        </Badge>
      </td>
      <td className="py-4 px-4 text-right">
        <Button variant="ghost" size="sm">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </td>
    </tr>
  );
}

export default function Investors() {
  const navigate = useNavigate();
  const { authToken } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeal, setSelectedDeal] = useState('all');

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

  // Fetch all LP actors across all deals
  const investorsQuery = useQuery({
    queryKey: ['all-investors'],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/actors`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) {
        // If endpoint doesn't exist, return empty
        if (res.status === 404) return { investors: [] };
        throw new Error('Failed to fetch investors');
      }
      return res.json();
    }
  });

  // Fetch capital calls summary
  const capitalCallsQuery = useQuery({
    queryKey: ['capital-calls-summary'],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/capital-calls/summary`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) {
        if (res.status === 404) return { totalCalled: 0, totalFunded: 0 };
        throw new Error('Failed to fetch capital calls');
      }
      return res.json();
    }
  });

  // Fetch distributions summary
  const distributionsQuery = useQuery({
    queryKey: ['distributions-summary'],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/distributions/summary`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) {
        if (res.status === 404) return { totalDistributed: 0 };
        throw new Error('Failed to fetch distributions');
      }
      return res.json();
    }
  });

  const deals = dealsQuery.data || [];
  const investors = investorsQuery.data?.investors || investorsQuery.data || [];
  const capitalSummary = capitalCallsQuery.data || { totalCalled: 0, totalFunded: 0 };
  const distributionSummary = distributionsQuery.data || { totalDistributed: 0 };

  // Filter investors
  const filteredInvestors = investors.filter(inv => {
    const matchesSearch = !searchQuery ||
      inv.entityName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      inv.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDeal = selectedDeal === 'all' || inv.dealId === selectedDeal;
    return matchesSearch && matchesDeal;
  });

  // Calculate summary stats
  const totalCommitment = investors.reduce((sum, inv) => sum + (inv.commitment || 0), 0);

  const isLoading = dealsQuery.isLoading || investorsQuery.isLoading;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Investors</h1>
          <p className="text-sm text-gray-500 mt-1">Manage LP relationships and capital events</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate(createPageUrl('InvestorUpdates'))}>
            <FileText className="w-4 h-4 mr-2" />
            Post Update
          </Button>
          <Button variant="outline" onClick={() => navigate(createPageUrl('Distributions'))}>
            <Banknote className="w-4 h-4 mr-2" />
            Distributions
          </Button>
          <Button onClick={() => navigate(createPageUrl('CapitalCalls'))}>
            <DollarSign className="w-4 h-4 mr-2" />
            Capital Calls
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <SummaryCard
          icon={Users}
          label="Total LPs"
          value={investors.length}
          subtext={`across ${new Set(investors.map(i => i.dealId)).size} deals`}
          color="blue"
        />
        <SummaryCard
          icon={PiggyBank}
          label="Capital Committed"
          value={formatCurrency(totalCommitment)}
          color="purple"
        />
        <SummaryCard
          icon={DollarSign}
          label="Capital Called"
          value={formatCurrency(capitalSummary.totalCalled || 0)}
          subtext={`${formatCurrency(capitalSummary.totalFunded || 0)} funded`}
          color="green"
        />
        <SummaryCard
          icon={TrendingUp}
          label="Distributions YTD"
          value={formatCurrency(distributionSummary.totalDistributed || 0)}
          color="amber"
        />
      </div>

      {/* Quick Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={() => navigate(createPageUrl('CapitalCalls'))}
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <div className="font-medium text-gray-900">Create Capital Call</div>
              <div className="text-sm text-gray-500">Request capital from LPs</div>
            </div>
          </button>

          <button
            onClick={() => navigate(createPageUrl('Distributions'))}
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
              <Banknote className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <div className="font-medium text-gray-900">Create Distribution</div>
              <div className="text-sm text-gray-500">Distribute returns to LPs</div>
            </div>
          </button>

          <button
            onClick={() => navigate(createPageUrl('InvestorUpdates'))}
            className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
              <Send className="w-5 h-5 text-purple-600" />
            </div>
            <div>
              <div className="font-medium text-gray-900">Post Investor Update</div>
              <div className="text-sm text-gray-500">Share quarterly reports</div>
            </div>
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search investors..."
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
              <SelectItem key={deal.id} value={deal.id}>
                {deal.name || deal.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Investors Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : filteredInvestors.length === 0 ? (
          <div className="text-center py-12">
            <Users className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Investors Yet</h3>
            <p className="text-gray-500 mb-4">
              Invite LPs to your deals to start managing investor relationships.
            </p>
            <Button onClick={() => navigate(createPageUrl('Deals'))}>
              <Plus className="w-4 h-4 mr-2" />
              Go to Deals
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Investor</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Deal</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">Commitment</th>
                <th className="text-right py-3 px-4 text-sm font-medium text-gray-500">Ownership</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filteredInvestors.map(investor => (
                <InvestorRow key={investor.id} investor={investor} deals={deals} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
