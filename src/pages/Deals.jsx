import React, { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useRole } from '../Layout';
import {
  Building2,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Clock,
  Search,
  ArrowUpDown,
  Filter
} from 'lucide-react';
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PageError } from "@/components/ui/page-state";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const lifecycleColors = {
  'Draft': 'bg-slate-100 text-slate-700',
  'Under Review': 'bg-amber-50 text-amber-700',
  'Approved': 'bg-emerald-50 text-emerald-700',
  'Ready to Close': 'bg-blue-50 text-blue-700',
  'Closed': 'bg-violet-50 text-violet-700',
  'Operating': 'bg-green-50 text-green-700',
  'Changed': 'bg-orange-50 text-orange-700',
  'Distressed': 'bg-red-50 text-red-700',
  'Resolved': 'bg-teal-50 text-teal-700',
  'Exited': 'bg-slate-50 text-slate-600'
};

const TruthHealthIcon = ({ health }) => {
  if (health === 'healthy') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (health === 'warning') return <AlertCircle className="w-4 h-4 text-amber-500" />;
  return <AlertTriangle className="w-4 h-4 text-red-500" />;
};

// Lifecycle states for filtering
const LIFECYCLE_STATES = ['all', 'Draft', 'Under Review', 'Approved', 'Ready to Close', 'Closed', 'Operating', 'Distressed', 'Exited'];

export default function DealsPage() {
  const { currentRole } = useRole();
  const [searchQuery, setSearchQuery] = useState('');
  const [lifecycleFilter, setLifecycleFilter] = useState('all');
  const [sortBy, setSortBy] = useState('updated');

  const { data: deals = [], isLoading, error, refetch } = useQuery({
    queryKey: ['deals'],
    queryFn: () => bff.deals.list(),
  });

  // Calculate counts for each lifecycle state
  const lifecycleCounts = useMemo(() => {
    const counts = { all: deals.length };
    LIFECYCLE_STATES.slice(1).forEach(state => {
      counts[state] = deals.filter(d => d.lifecycle_state === state).length;
    });
    return counts;
  }, [deals]);

  // Filter and sort deals
  const filteredAndSortedDeals = useMemo(() => {
    // First filter by lifecycle
    let filtered = deals.filter((deal) => {
      if (lifecycleFilter !== 'all' && deal.lifecycle_state !== lifecycleFilter) {
        return false;
      }
      // Then filter by search query
      const profile = deal.profile ?? {};
      const addressMatch = profile.asset_address
        ?.toLowerCase()
        ?.includes(searchQuery.toLowerCase());
      return (
        deal.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        addressMatch
      );
    });

    // Then sort
    return [...filtered].sort((a, b) => {
      const profileA = a.profile ?? {};
      const profileB = b.profile ?? {};
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'price':
          return (profileB.purchase_price || 0) - (profileA.purchase_price || 0);
        case 'ltv':
          return (profileB.ltv || 0) - (profileA.ltv || 0);
        case 'updated':
        default:
          return new Date(b.updated_date || 0) - new Date(a.updated_date || 0);
      }
    });
  }, [deals, lifecycleFilter, searchQuery, sortBy]);

  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <PageError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Deals</h1>
        <p className="text-sm text-[#737373] mt-1">
          {currentRole === 'Regulator' ? 'Regulatory oversight view' : 
           currentRole === 'Auditor' ? 'Audit compliance view' :
           currentRole === 'Lender' ? 'Lender portfolio view' :
           currentRole === 'LP' ? 'Investment portfolio view' :
           'Active deal portfolio'}
        </p>
      </div>

      {/* Lifecycle Filter Tabs */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-[#737373]" />
        {LIFECYCLE_STATES.filter(state => state === 'all' || lifecycleCounts[state] > 0).map((state) => (
          <button
            key={state}
            onClick={() => setLifecycleFilter(state)}
            className={cn(
              "px-3 py-1.5 text-sm rounded-lg border transition-all duration-200",
              lifecycleFilter === state
                ? "bg-[#0A0A0A] text-white border-[#0A0A0A]"
                : "bg-white text-[#737373] border-[#E5E5E5] hover:border-[#A3A3A3] hover:text-[#171717]"
            )}
          >
            {state === 'all' ? 'All Deals' : state}
            <Badge
              variant="secondary"
              className={cn(
                "ml-2 text-xs px-1.5 py-0",
                lifecycleFilter === state
                  ? "bg-white/20 text-white"
                  : "bg-[#F5F5F5] text-[#737373]"
              )}
            >
              {lifecycleCounts[state] || 0}
            </Badge>
          </button>
        ))}
      </div>

      {/* Search & Sort Row */}
      <div className="mb-6 flex gap-4 items-center">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A3A3A3]" />
          <Input
            placeholder="Search by name or address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-white border-[#E5E5E5] focus:border-[#171717] focus:ring-0"
          />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[180px] bg-white border-[#E5E5E5]">
            <ArrowUpDown className="w-4 h-4 mr-2 text-[#737373]" />
            <SelectValue placeholder="Sort by..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="updated">Last Updated</SelectItem>
            <SelectItem value="name">Deal Name</SelectItem>
            <SelectItem value="price">Purchase Price</SelectItem>
            <SelectItem value="ltv">LTV</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Results Summary */}
      {!isLoading && (
        <div className="mb-4 text-sm text-[#737373]">
          Showing {filteredAndSortedDeals.length} of {deals.length} deals
          {lifecycleFilter !== 'all' && ` in "${lifecycleFilter}"`}
          {searchQuery && ` matching "${searchQuery}"`}
        </div>
      )}

      {/* Deals Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="bg-white rounded-xl border border-[#E5E5E5] p-6 animate-pulse">
              <div className="h-6 bg-slate-100 rounded w-3/4 mb-4"></div>
              <div className="h-4 bg-slate-100 rounded w-1/2 mb-2"></div>
              <div className="h-4 bg-slate-100 rounded w-2/3 mb-4"></div>
              <div className="grid grid-cols-3 gap-2 pt-4 border-t border-[#F5F5F5]">
                <div className="h-8 bg-slate-100 rounded"></div>
                <div className="h-8 bg-slate-100 rounded"></div>
                <div className="h-8 bg-slate-100 rounded"></div>
              </div>
            </div>
          ))}
        </div>
      ) : filteredAndSortedDeals.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-12 text-center">
          <Building2 className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">
            {searchQuery || lifecycleFilter !== 'all' ? 'No matching deals' : 'No deals found'}
          </h3>
          <p className="text-sm text-[#737373] mb-6">
            {searchQuery || lifecycleFilter !== 'all'
              ? 'Try adjusting your filters or search query'
              : 'Create your first deal to get started'}
          </p>
          {lifecycleFilter !== 'all' && (
            <button
              onClick={() => { setLifecycleFilter('all'); setSearchQuery(''); }}
              className="inline-flex items-center gap-2 px-4 py-2 border border-[#E5E5E5] text-[#171717] rounded-lg text-sm font-medium hover:bg-[#F5F5F5] transition-colors mr-3"
            >
              Clear Filters
            </button>
          )}
          <Link
            to={createPageUrl('CreateDeal')}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#0A0A0A] text-white rounded-lg text-sm font-medium hover:bg-[#171717] transition-colors"
          >
            Create Deal
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAndSortedDeals.map((deal) => {
            const profile = deal.profile ?? {};
            return (
              <Link
                key={deal.id}
                to={createPageUrl(`DealOverview?id=${deal.id}`)}
                className="bg-white rounded-xl border border-[#E5E5E5] p-6 hover:border-[#171717] hover:shadow-sm transition-all duration-200 group"
              >
              {/* Stress Mode Banner */}
              {deal.stress_mode && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg mb-4 -mt-2 -mx-2">
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span className="text-xs font-medium text-red-700">Stress Mode Active</span>
                </div>
              )}

              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <h3 className="font-semibold text-[#171717] group-hover:text-[#0A0A0A] transition-colors line-clamp-1">
                    {deal.name}
                  </h3>
                  <p className="text-sm text-[#737373] mt-0.5 line-clamp-1">
                    {profile.asset_address || 'No address'}
                  </p>
                </div>
                <ChevronRight className="w-5 h-5 text-[#E5E5E5] group-hover:text-[#171717] transition-colors flex-shrink-0" />
              </div>

              {/* Status Row */}
              <div className="flex items-center gap-2 mb-4">
                <Badge className={cn("font-medium text-xs", lifecycleColors[deal.lifecycle_state] || 'bg-slate-100 text-slate-700')}>
                  {deal.lifecycle_state || 'Draft'}
                </Badge>
                <TruthHealthIcon health={deal.truth_health || 'healthy'} />
                {profile.ai_derived && (
                  <span className="text-[10px] px-2 py-0.5 bg-violet-50 text-violet-600 rounded font-medium">
                    AI-Derived
                  </span>
                )}
              </div>

              {/* Enhanced Metrics */}
              <div className="grid grid-cols-3 gap-3 pt-4 border-t border-[#F5F5F5]">
                <div>
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Purchase</span>
                  <p className="text-sm font-medium text-[#171717]">
                    {profile.purchase_price ? `$${(profile.purchase_price / 1000000).toFixed(1)}M` : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">LTV</span>
                  <p className={cn(
                    "text-sm font-medium",
                    profile.ltv > 0.75 ? "text-red-600" : profile.ltv > 0.65 ? "text-amber-600" : "text-[#171717]"
                  )}>
                    {profile.ltv ? `${(profile.ltv * 100).toFixed(0)}%` : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">DSCR</span>
                  <p className={cn(
                    "text-sm font-medium",
                    profile.dscr < 1.0 ? "text-red-600" : profile.dscr < 1.25 ? "text-amber-600" : "text-green-600"
                  )}>
                    {profile.dscr ? `${profile.dscr.toFixed(2)}x` : 'N/A'}
                  </p>
                </div>
              </div>

              {/* Data Quality Indicator */}
              {profile.ai_derived && !profile.verified && (
                <div className="mt-3 flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-md">
                  <AlertCircle className="w-3 h-3 text-amber-500" />
                  <span className="text-[10px] text-amber-700 font-medium">Needs verification</span>
                </div>
              )}

              {/* Updated timestamp */}
              {deal.updated_date && (
                <div className="mt-2 text-[10px] text-[#A3A3A3]">
                  Updated {new Date(deal.updated_date).toLocaleDateString()}
                </div>
              )}

              {/* Next Action */}
              {deal.next_action && (
                <div className="mt-4 pt-4 border-t border-[#F5F5F5]">
                  <div className="flex items-center gap-2">
                    <Clock className="w-3 h-3 text-[#A3A3A3]" />
                    <span className="text-xs text-[#737373] line-clamp-1">{deal.next_action}</span>
                  </div>
                </div>
              )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
