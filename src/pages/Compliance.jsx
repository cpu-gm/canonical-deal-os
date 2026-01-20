import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useRole } from '../Layout';
import { 
  Shield, 
  FileText, 
  Calendar,
  Hash,
  CheckCircle2,
  Download,
  Eye
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PageError } from "@/components/ui/page-state";
import { debugLog } from "@/lib/debug";

export default function CompliancePage() {
  const { currentRole } = useRole();
  const [selectedDealId, setSelectedDealId] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');

  const { data: deals = [], error: dealsError, refetch: refetchDeals } = useQuery({
    queryKey: ['deals'],
    queryFn: () => bff.deals.list(),
    onError: (error) => {
      debugLog("compliance", "Deals load failed", { message: error?.message });
    }
  });

  const { data: events = [], isLoading, error: eventsError, refetch: refetchEvents } = useQuery({
    queryKey: ['all-events', selectedDealId, dateFilter],
    queryFn: async () => {
      const allEvents = await bff.events.list({
        dealId: selectedDealId === 'all' ? undefined : selectedDealId,
        order: 'asc',
        limit: 500
      });
      
      // Filter by date if needed
      if (dateFilter !== 'all') {
        const now = new Date();
        const filterDate = new Date();
        if (dateFilter === '7d') filterDate.setDate(now.getDate() - 7);
        if (dateFilter === '30d') filterDate.setDate(now.getDate() - 30);
        if (dateFilter === '90d') filterDate.setDate(now.getDate() - 90);
        
        return allEvents.filter(e => new Date(e.created_date) >= filterDate);
      }
      return allEvents;
    },
    onError: (error) => {
      debugLog("compliance", "Events load failed", { message: error?.message });
    }
  });

  const selectedDeal = deals.find(d => d.id === selectedDealId);
  const hasSelectedDeal = selectedDealId !== 'all';

  const error = dealsError || eventsError;
  if (error) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <PageError
          error={error}
          onRetry={() => {
            refetchDeals();
            refetchEvents();
          }}
        />
      </div>
    );
  }

  // Group events by date for timeline view
  const groupedEvents = events.reduce((acc, event) => {
    const date = new Date(event.timestamp || event.created_date).toLocaleDateString();
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {});

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-5 h-5 text-[#171717]" />
          <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">
            {currentRole === 'Regulator' ? 'Regulatory Compliance View' : 
             currentRole === 'Auditor' ? 'Audit Compliance View' :
             'Compliance & Regulator View'}
          </h1>
        </div>
        <p className="text-sm text-[#737373]">
          Chronological, read-only event log with complete evidence chain
        </p>
      </div>

      {/* Info Banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-3">
          <Eye className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Read-Only Compliance View</p>
            <p className="text-xs text-blue-700 mt-1">
              This view presents an immutable, time-ordered record of all deal events. 
              Records cannot be modified. This interface is designed for regulatory review and audit purposes.
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px] max-w-md">
            <label className="text-sm font-medium text-[#171717] block mb-2">Deal</label>
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger className="border-[#E5E5E5]">
                <SelectValue placeholder="All deals" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Deals</SelectItem>
                {deals.map(deal => (
                  <SelectItem key={deal.id} value={deal.id}>
                    {deal.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px] max-w-xs">
            <label className="text-sm font-medium text-[#171717] block mb-2">Time Period</label>
            <Select value={dateFilter} onValueChange={setDateFilter}>
              <SelectTrigger className="border-[#E5E5E5]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="7d">Last 7 Days</SelectItem>
                <SelectItem value="30d">Last 30 Days</SelectItem>
                <SelectItem value="90d">Last 90 Days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-end">
            <Link to={createPageUrl(`AuditExport${hasSelectedDeal ? `?id=${selectedDealId}` : ''}`)}>
              <Button variant="outline" className="border-[#E5E5E5]">
                <Download className="w-4 h-4 mr-2" />
                Export Audit PDF
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      {selectedDeal && hasSelectedDeal && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Current State</span>
            <p className="text-lg font-semibold text-[#171717] mt-1">{selectedDeal.lifecycle_state}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Total Events</span>
            <p className="text-lg font-semibold text-[#171717] mt-1">{events.length}</p>
          </div>
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Stress Mode</span>
            <p className="text-lg font-semibold text-[#171717] mt-1">
              {selectedDeal.stress_mode ? 'Active' : 'Inactive'}
            </p>
          </div>
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-4">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Truth Health</span>
            <p className={cn(
              "text-lg font-semibold mt-1",
              selectedDeal.truth_health === 'healthy' ? 'text-green-600' :
              selectedDeal.truth_health === 'warning' ? 'text-amber-600' : 'text-red-600'
            )}>
              {selectedDeal.truth_health || 'Healthy'}
            </p>
          </div>
        </div>
      )}

      {/* Chronological Event Log */}
      <div className="bg-white rounded-xl border border-[#E5E5E5]">
        <div className="p-6 border-b border-[#E5E5E5]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#171717]">
              Chronological Event Log
              <span className="ml-2 text-[#A3A3A3] font-normal">
                ({events.length} records)
              </span>
            </h2>
            <div className="text-xs text-[#A3A3A3]">
              Sorted: Oldest {"->"} Newest (Ascending)
            </div>
          </div>
        </div>

          {isLoading ? (
            <div className="p-6">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="animate-pulse flex gap-4 mb-4">
                <div className="w-24 h-4 bg-slate-100 rounded"></div>
                <div className="flex-1">
                  <div className="h-4 bg-slate-100 rounded w-1/2 mb-2"></div>
                  <div className="h-3 bg-slate-100 rounded w-3/4"></div>
                </div>
              </div>
            ))}
          </div>
        ) : events.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[#171717] mb-2">No events recorded</h3>
            <p className="text-sm text-[#737373]">
              {hasSelectedDeal ? 'This deal has no recorded events' : 'Select a deal to view its compliance record'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#F5F5F5]">
            {Object.entries(groupedEvents).map(([date, dayEvents]) => (
              <div key={date}>
                {/* Date Header */}
                <div className="px-6 py-3 bg-[#FAFAFA] sticky top-0">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[#A3A3A3]" />
                    <span className="text-sm font-medium text-[#737373]">{date}</span>
                    <span className="text-xs text-[#A3A3A3]">({dayEvents.length} events)</span>
                  </div>
                </div>

                {/* Events for this date */}
                {dayEvents.map((event, index) => {
                  const eventDeal = deals.find(d => d.id === event.deal_id);
                  
                  return (
                    <div key={event.id} className="px-6 py-4 hover:bg-[#FAFAFA]">
                      <div className="flex gap-4">
                        {/* Sequence Number */}
                        <div className="w-12 flex-shrink-0">
                          <span className="text-xs text-[#A3A3A3] font-mono">
                            #{String(index + 1).padStart(3, '0')}
                          </span>
                        </div>

                        {/* Time */}
                        <div className="w-20 flex-shrink-0">
                          <span className="text-xs text-[#A3A3A3] font-mono">
                            {new Date(event.timestamp || event.created_date).toLocaleTimeString([], { 
                              hour: '2-digit', 
                              minute: '2-digit',
                              second: '2-digit'
                            })}
                          </span>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start gap-3">
                            <div className="flex-1">
                              <p className="text-sm font-medium text-[#171717]">
                                {event.event_title}
                              </p>
                              {event.event_description && (
                                <p className="text-xs text-[#737373] mt-1">
                                  {event.event_description}
                                </p>
                              )}
                            </div>
                          </div>

                          {/* Metadata Row */}
                          <div className="flex flex-wrap items-center gap-3 mt-2">
                            {!hasSelectedDeal && eventDeal && (
                              <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                                {eventDeal.name}
                              </span>
                            )}

                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded font-medium",
                              event.evidence_type === 'document_verified' ? 'bg-green-50 text-green-700' :
                              event.evidence_type === 'human_attested' ? 'bg-blue-50 text-blue-700' :
                              event.evidence_type === 'ai_derived' ? 'bg-violet-50 text-violet-700' :
                              'bg-slate-50 text-slate-700'
                            )}>
                              {event.evidence_type?.replace(/_/g, ' ') || 'system'}
                            </span>

                            <span className="text-xs text-[#A3A3A3] flex items-center gap-1">
                              <Shield className="w-3 h-3" />
                              {event.authority_role || 'System'}
                            </span>

                            {event.evidence_hash && (
                              <span className="text-xs text-[#A3A3A3] flex items-center gap-1 font-mono">
                                <Hash className="w-3 h-3" />
                                {event.evidence_hash.slice(0, 8)}...
                              </span>
                            )}
                          </div>

                          {/* State Transition */}
                          {event.from_state && event.to_state && (
                            <div className="mt-2">
                              <span className="inline-flex items-center gap-2 px-2 py-1 bg-[#F5F5F5] rounded text-xs">
                                <span className="text-[#737373]">{event.from_state}</span>
                                <span className="text-[#A3A3A3]">{"->"}</span>
                                <span className="font-medium text-[#171717]">{event.to_state}</span>
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Event ID */}
                        <div className="w-32 flex-shrink-0 text-right">
                          <code className="text-[10px] text-[#A3A3A3] font-mono">
                            {event.id.slice(0, 12)}...
                          </code>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer Notice */}
      <div className="mt-6 p-4 bg-slate-50 border border-slate-200 rounded-xl">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="w-4 h-4 text-slate-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-slate-800">Immutable Record</p>
            <p className="text-xs text-slate-600 mt-1">
              This log represents the canonical truth of all deal activities. Records are append-only and cannot be modified or deleted. Each event is cryptographically linked to its evidence source.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
