import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import DealLifecycleProgress from '@/components/lp/DealLifecycleProgress';
import {
  Building2, ChevronRight, Loader2, Search, Filter,
  SortAsc, SortDesc, List, LayoutGrid
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { PageError } from '@/components/ui/page-state';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { debugLog } from '@/lib/debug';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

function formatCurrency(value) {
  if (value === null || value === undefined) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function formatPercent(value) {
  if (value === null || value === undefined) return '0%';
  return `${(value * 100).toFixed(1)}%`;
}

// Get status category for filtering
function getStatusCategory(status) {
  const activeStates = ['DD_ACTIVE', 'DD_COMPLETE', 'FINANCING_IN_PROGRESS', 'FINANCING_COMMITTED', 'CLEAR_TO_CLOSE'];
  const closedStates = ['CLOSED'];
  const earlyStates = ['INTAKE_RECEIVED', 'DATA_ROOM_INGESTED', 'EXTRACTION_COMPLETE', 'UNDERWRITING_DRAFT', 'IC_READY', 'LOI_DRAFT', 'LOI_SENT', 'LOI_ACCEPTED', 'PSA_DRAFT', 'PSA_EXECUTED'];

  if (closedStates.includes(status)) return 'closed';
  if (activeStates.includes(status)) return 'active';
  if (earlyStates.includes(status)) return 'early';
  return 'all';
}

// Investment card for grid view
function InvestmentGridCard({ investment, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group"
    >
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors">
            {investment.dealName || investment.entityName || 'Investment'}
          </h3>
          <p className="text-sm text-gray-500">{investment.assetType || 'Real Estate'}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Commitment</div>
          <div className="font-semibold text-gray-900">{formatCurrency(investment.commitment)}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500 uppercase tracking-wide mb-1">Ownership</div>
          <div className="font-semibold text-gray-900">{formatPercent(investment.ownershipPct)}</div>
        </div>
      </div>

      <DealLifecycleProgress
        currentState={investment.dealStatus || 'INTAKE_RECEIVED'}
        size="sm"
      />

      {investment.lastUpdate && (
        <p className="text-xs text-gray-400 mt-3">
          Last updated: {new Date(investment.lastUpdate).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// Investment row for list view
function InvestmentListRow({ investment, onClick }) {
  return (
    <div
      onClick={onClick}
      className="bg-white border-b border-gray-100 px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer group flex items-center gap-6"
    >
      <div className="flex-1 min-w-0">
        <h3 className="font-medium text-gray-900 group-hover:text-blue-600 transition-colors truncate">
          {investment.dealName || investment.entityName || 'Investment'}
        </h3>
        <p className="text-sm text-gray-500">{investment.assetType || 'Real Estate'}</p>
      </div>

      <div className="w-32 text-right">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Commitment</div>
        <div className="font-semibold text-gray-900">{formatCurrency(investment.commitment)}</div>
      </div>

      <div className="w-24 text-right">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Ownership</div>
        <div className="font-semibold text-gray-900">{formatPercent(investment.ownershipPct)}</div>
      </div>

      <div className="w-48">
        <DealLifecycleProgress
          currentState={investment.dealStatus || 'INTAKE_RECEIVED'}
          size="sm"
          compact
        />
      </div>

      <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-blue-500 transition-colors flex-shrink-0" />
    </div>
  );
}

export default function LPInvestments() {
  const navigate = useNavigate();
  const { user, authToken } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name');
  const [sortOrder, setSortOrder] = useState('asc');
  const [viewMode, setViewMode] = useState('grid'); // 'grid' or 'list'

  // Fetch LP's investments
  const portfolioQuery = useQuery({
    queryKey: ['lp-investments', user?.id],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) {
        if (res.status === 404) {
          return { investments: [] };
        }
        throw new Error('Failed to fetch investments');
      }
      return res.json();
    },
    enabled: !!user && !!authToken,
    staleTime: 30 * 1000,
    onError: (error) => {
      debugLog('lp', 'Investments load failed', { message: error?.message });
    }
  });

  const investments = portfolioQuery.data?.investments || [];

  // Filter and sort investments
  const filteredInvestments = investments
    .filter(inv => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const name = (inv.dealName || inv.entityName || '').toLowerCase();
        const type = (inv.assetType || '').toLowerCase();
        if (!name.includes(query) && !type.includes(query)) {
          return false;
        }
      }
      // Status filter
      if (statusFilter !== 'all') {
        const category = getStatusCategory(inv.dealStatus);
        if (category !== statusFilter) {
          return false;
        }
      }
      return true;
    })
    .sort((a, b) => {
      let aVal, bVal;
      switch (sortBy) {
        case 'name':
          aVal = (a.dealName || a.entityName || '').toLowerCase();
          bVal = (b.dealName || b.entityName || '').toLowerCase();
          break;
        case 'commitment':
          aVal = a.commitment || 0;
          bVal = b.commitment || 0;
          break;
        case 'ownership':
          aVal = a.ownershipPct || 0;
          bVal = b.ownershipPct || 0;
          break;
        case 'updated':
          aVal = new Date(a.lastUpdate || 0).getTime();
          bVal = new Date(b.lastUpdate || 0).getTime();
          break;
        default:
          return 0;
      }
      if (sortOrder === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });

  const handleInvestmentClick = (investment) => {
    navigate(`/investments/${investment.dealId || investment.id}`);
  };

  const toggleSortOrder = () => {
    setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
  };

  // Calculate summary stats
  const totalCommitment = investments.reduce((sum, i) => sum + (i.commitment || 0), 0);
  const avgOwnership = investments.length > 0
    ? investments.reduce((sum, i) => sum + (i.ownershipPct || 0), 0) / investments.length
    : 0;

  if (portfolioQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading your investments...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (portfolioQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={portfolioQuery.error} onRetry={portfolioQuery.refetch} />
        </div>
      </LPLayout>
    );
  }

  return (
    <LPLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Your Investments</h2>
          <p className="text-gray-500 mt-1">
            {investments.length} investment{investments.length !== 1 ? 's' : ''} • {formatCurrency(totalCommitment)} total committed
          </p>
        </div>

        {/* Filters and controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search investments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <Filter className="w-4 h-4 mr-2" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="early">Early Stage</SelectItem>
                <SelectItem value="active">Due Diligence</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort */}
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">Name</SelectItem>
                <SelectItem value="commitment">Commitment</SelectItem>
                <SelectItem value="ownership">Ownership</SelectItem>
                <SelectItem value="updated">Last Updated</SelectItem>
              </SelectContent>
            </Select>

            {/* Sort order */}
            <Button variant="outline" size="icon" onClick={toggleSortOrder}>
              {sortOrder === 'asc' ? (
                <SortAsc className="w-4 h-4" />
              ) : (
                <SortDesc className="w-4 h-4" />
              )}
            </Button>

            {/* View toggle */}
            <div className="flex border border-gray-200 rounded-lg">
              <Button
                variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setViewMode('grid')}
                className="rounded-r-none"
              >
                <LayoutGrid className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === 'list' ? 'secondary' : 'ghost'}
                size="icon"
                onClick={() => setViewMode('list')}
                className="rounded-l-none"
              >
                <List className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Active filters */}
          {(searchQuery || statusFilter !== 'all') && (
            <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
              <span className="text-sm text-gray-500">Filters:</span>
              {searchQuery && (
                <Badge variant="secondary" className="gap-1">
                  Search: {searchQuery}
                  <button onClick={() => setSearchQuery('')} className="ml-1 hover:text-red-500">×</button>
                </Badge>
              )}
              {statusFilter !== 'all' && (
                <Badge variant="secondary" className="gap-1">
                  Status: {statusFilter}
                  <button onClick={() => setStatusFilter('all')} className="ml-1 hover:text-red-500">×</button>
                </Badge>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
                className="text-xs"
              >
                Clear all
              </Button>
            </div>
          )}
        </div>

        {/* Results count */}
        <div className="mb-4">
          <p className="text-sm text-gray-500">
            Showing {filteredInvestments.length} of {investments.length} investments
          </p>
        </div>

        {/* Investments */}
        {investments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="font-medium text-gray-900 mb-2">No Investments Yet</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              You don't have any active investments yet. Your GP will add you to deals as they become available.
            </p>
          </div>
        ) : filteredInvestments.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
            <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="font-medium text-gray-900 mb-2">No Matching Investments</h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto">
              No investments match your current filters. Try adjusting your search or filters.
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}
            >
              Clear Filters
            </Button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredInvestments.map((investment) => (
              <InvestmentGridCard
                key={investment.id || investment.dealId}
                investment={investment}
                onClick={() => handleInvestmentClick(investment)}
              />
            ))}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {/* List header */}
            <div className="bg-gray-50 border-b border-gray-200 px-6 py-3 flex items-center gap-6 text-xs font-medium text-gray-500 uppercase tracking-wide">
              <div className="flex-1">Investment</div>
              <div className="w-32 text-right">Commitment</div>
              <div className="w-24 text-right">Ownership</div>
              <div className="w-48">Progress</div>
              <div className="w-5"></div>
            </div>
            {/* List items */}
            {filteredInvestments.map((investment) => (
              <InvestmentListRow
                key={investment.id || investment.dealId}
                investment={investment}
                onClick={() => handleInvestmentClick(investment)}
              />
            ))}
          </div>
        )}
      </div>
    </LPLayout>
  );
}
