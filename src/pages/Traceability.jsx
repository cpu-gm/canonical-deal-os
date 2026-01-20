import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { 
  ChevronRight, 
  FileText, 
  User, 
  Bot, 
  Cpu,
  Calendar,
  Hash,
  Shield,
  Search,
  ExternalLink
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageError } from "@/components/ui/page-state";
import { debugLog } from "@/lib/debug";

const evidenceTypeConfig = {
  'document_verified': { 
    icon: FileText, 
    label: 'Document-Verified',
    color: 'text-green-600 bg-green-50 border-green-200'
  },
  'human_attested': { 
    icon: User, 
    label: 'Human-Attested',
    color: 'text-blue-600 bg-blue-50 border-blue-200'
  },
  'ai_derived': { 
    icon: Bot, 
    label: 'AI-Derived',
    color: 'text-violet-600 bg-violet-50 border-violet-200'
  },
  'system_computed': { 
    icon: Cpu, 
    label: 'System-Computed',
    color: 'text-slate-600 bg-slate-50 border-slate-200'
  }
};

export default function TraceabilityPage() {
  const urlParams = new URLSearchParams(window.location.search);
  const dealIdFromUrl = urlParams.get('id');
  
  const [selectedDealId, setSelectedDealId] = useState(dealIdFromUrl || 'all');
  const [filterType, setFilterType] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const { data: deals = [], error: dealsError, refetch: refetchDeals } = useQuery({
    queryKey: ['deals'],
    queryFn: () => bff.deals.list(),
    onError: (error) => {
      debugLog("traceability", "Deals load failed", { message: error?.message });
    }
  });

  const { data: events = [], isLoading, error: eventsError, refetch: refetchEvents } = useQuery({
    queryKey: ['deal-events', selectedDealId],
    queryFn: () => bff.events.list({
      dealId: selectedDealId === 'all' ? undefined : selectedDealId,
      order: 'desc',
      limit: 100
    }),
    enabled: true,
    onError: (error) => {
      debugLog("traceability", "Events load failed", { message: error?.message });
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

  const filteredEvents = events.filter(event => {
    const matchesType = filterType === 'all' || event.evidence_type === filterType;
    const title = typeof event.event_title === 'string' ? event.event_title : '';
    const description = typeof event.event_description === 'string' ? event.event_description : '';
    const query = searchQuery.toLowerCase();
    const matchesSearch = searchQuery === '' || 
      title.toLowerCase().includes(query) ||
      description.toLowerCase().includes(query);
    return matchesType && matchesSearch;
  });

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Traceability</h1>
        <p className="text-sm text-[#737373] mt-1">
          Complete event history with provable evidence chains
        </p>
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

          <div className="flex-1 min-w-[200px] max-w-md">
            <label className="text-sm font-medium text-[#171717] block mb-2">Evidence Type</label>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="border-[#E5E5E5]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="document_verified">Document-Verified</SelectItem>
                <SelectItem value="human_attested">Human-Attested</SelectItem>
                <SelectItem value="ai_derived">AI-Derived</SelectItem>
                <SelectItem value="system_computed">System-Computed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium text-[#171717] block mb-2">Search</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A3A3A3]" />
              <Input 
                placeholder="Search events..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 border-[#E5E5E5]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Events Timeline */}
      <div className="bg-white rounded-xl border border-[#E5E5E5]">
        <div className="p-6 border-b border-[#E5E5E5]">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#171717]">
              Event Timeline
              <span className="ml-2 text-[#A3A3A3] font-normal">
                ({filteredEvents.length} events)
              </span>
            </h2>
            {selectedDeal && hasSelectedDeal && (
              <Link 
                to={createPageUrl(`DealOverview?id=${selectedDealId}`)}
                className="text-xs text-[#737373] hover:text-[#171717] flex items-center gap-1"
              >
                View Deal <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
        </div>

        <div className="divide-y divide-[#F5F5F5]">
          {isLoading ? (
            <div className="p-6">
              {[1,2,3].map(i => (
                <div key={i} className="animate-pulse flex gap-4 mb-4">
                  <div className="w-10 h-10 bg-slate-100 rounded-lg"></div>
                  <div className="flex-1">
                    <div className="h-4 bg-slate-100 rounded w-1/3 mb-2"></div>
                    <div className="h-3 bg-slate-100 rounded w-2/3"></div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="p-12 text-center">
              <FileText className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
              <h3 className="text-lg font-medium text-[#171717] mb-2">No events found</h3>
              <p className="text-sm text-[#737373]">
                {hasSelectedDeal ? 'This deal has no recorded events yet' : 'Select a deal to view its event history'}
              </p>
            </div>
          ) : (
            filteredEvents.map((event, index) => {
              const evidence = evidenceTypeConfig[event.evidence_type] || evidenceTypeConfig['system_computed'];
              const EvidenceIcon = evidence.icon;
              const eventDeal = deals.find(d => d.id === event.deal_id);

              return (
                <div 
                  key={event.id}
                  className="p-6 hover:bg-[#FAFAFA] transition-colors cursor-pointer"
                  onClick={() => setSelectedEvent(event)}
                >
                  <div className="flex gap-4">
                    {/* Timeline Line */}
                    <div className="flex flex-col items-center">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center border",
                        evidence.color
                      )}>
                        <EvidenceIcon className="w-4 h-4" />
                      </div>
                      {index < filteredEvents.length - 1 && (
                        <div className="w-px h-full bg-[#E5E5E5] mt-2" />
                      )}
                    </div>

                    {/* Event Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-[#171717]">
                            {event.event_title}
                          </h3>
                          {event.event_description && (
                            <p className="text-sm text-[#737373] mt-1 line-clamp-2">
                              {event.event_description}
                            </p>
                          )}
                        </div>
                        <ChevronRight className="w-4 h-4 text-[#A3A3A3] flex-shrink-0" />
                      </div>

                      {/* Meta Info */}
                      <div className="flex flex-wrap items-center gap-4 mt-3">
                        {!hasSelectedDeal && eventDeal && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                              {eventDeal.name}
                            </span>
                          </div>
                        )}

                        <div className="flex items-center gap-1.5 text-xs text-[#A3A3A3]">
                          <Shield className="w-3 h-3" />
                          <span>{event.authority_role || 'System'}</span>
                          {event.authority_name && (
                            <span className="text-[#737373]">- {event.authority_name}</span>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-[#A3A3A3]">
                          <Calendar className="w-3 h-3" />
                          <span>{new Date(event.timestamp || event.created_date).toLocaleString()}</span>
                        </div>

                        {event.evidence_hash && (
                          <div className="flex items-center gap-1.5 text-xs text-[#A3A3A3]">
                            <Hash className="w-3 h-3" />
                            <code className="font-mono">{event.evidence_hash.slice(0, 12)}...</code>
                          </div>
                        )}
                      </div>

                      {/* State Transition */}
                      {event.from_state && event.to_state && (
                        <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 bg-[#F5F5F5] rounded-lg text-xs">
                          <span className="font-medium text-[#737373]">{event.from_state}</span>
                          <span className="text-[#A3A3A3]">{"->"}</span>
                          <span className="font-medium text-[#171717]">{event.to_state}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Event Detail Panel */}
      {selectedEvent && (
        <EventDetailPanel 
          event={selectedEvent}
          deal={deals.find(d => d.id === selectedEvent.deal_id)}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}

function EventDetailPanel({ event, deal, onClose }) {
  const evidence = evidenceTypeConfig[event.evidence_type] || evidenceTypeConfig['system_computed'];
  const EvidenceIcon = evidence.icon;

  return (
    <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex justify-end">
      <div className="w-full max-w-lg bg-white h-full overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-300">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E5E5E5] p-6 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Event Detail</span>
            <h2 className="text-lg font-semibold text-[#171717]">
              {event.event_title}
            </h2>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <ChevronRight className="w-5 h-5" />
          </Button>
        </div>

        <div className="p-6 space-y-6">
          {/* Deal Reference */}
          {deal && (
            <div className="p-4 bg-[#FAFAFA] rounded-xl">
              <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Deal</span>
              <Link 
                to={createPageUrl(`DealOverview?id=${deal.id}`)}
                className="block mt-1 text-sm font-medium text-[#171717] hover:text-blue-600 flex items-center gap-1"
              >
                {deal.name}
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          )}

          {/* Event Type */}
          <div>
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Event Type</span>
            <p className="text-sm font-medium text-[#171717] mt-1 capitalize">
              {event.event_type?.replace(/_/g, ' ')}
            </p>
          </div>

          {/* Description */}
          {event.event_description && (
            <div>
              <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Description</span>
              <p className="text-sm text-[#737373] mt-1">{event.event_description}</p>
            </div>
          )}

          {/* State Transition */}
          {event.from_state && event.to_state && (
            <div>
              <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">State Transition</span>
              <div className="mt-2 flex items-center gap-3">
                <span className="px-3 py-1.5 bg-slate-100 rounded-lg text-sm font-medium text-slate-700">
                  {event.from_state}
                </span>
                <span className="text-[#A3A3A3]">{"->"}</span>
                <span className="px-3 py-1.5 bg-[#0A0A0A] rounded-lg text-sm font-medium text-white">
                  {event.to_state}
                </span>
              </div>
            </div>
          )}

          {/* Authority */}
          <div>
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Authority</span>
            <div className="flex items-center gap-3 mt-2">
              <div className="w-8 h-8 rounded-full bg-[#F5F5F5] flex items-center justify-center">
                <Shield className="w-4 h-4 text-[#737373]" />
              </div>
              <div>
                <p className="text-sm font-medium text-[#171717]">
                  {event.authority_name || 'Automated System'}
                </p>
                <p className="text-xs text-[#A3A3A3]">{event.authority_role || 'System'}</p>
              </div>
            </div>
          </div>

          {/* Evidence */}
          <div>
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Evidence Classification</span>
            <div className={cn("mt-2 p-3 rounded-lg border flex items-start gap-3", evidence.color)}>
              <EvidenceIcon className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium">{evidence.label}</p>
              </div>
            </div>
          </div>

          {/* Evidence Hash */}
          {event.evidence_hash && (
            <div>
              <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Evidence Hash</span>
              <div className="mt-2 p-3 bg-[#FAFAFA] rounded-lg border border-[#E5E5E5]">
                <code className="text-xs text-[#737373] font-mono break-all">
                  {event.evidence_hash}
                </code>
              </div>
            </div>
          )}

          {/* Document Link */}
          {event.document_url && (
            <div>
              <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Source Document</span>
              <a 
                href={event.document_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 hover:bg-blue-100 transition-colors"
              >
                <FileText className="w-4 h-4" />
                View Document
                <ExternalLink className="w-3 h-3 ml-auto" />
              </a>
            </div>
          )}

          {/* Timestamp */}
          <div>
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Timestamp</span>
            <div className="flex items-center gap-2 mt-2">
              <Calendar className="w-4 h-4 text-[#A3A3A3]" />
              <span className="text-sm text-[#737373]">
                {new Date(event.timestamp || event.created_date).toLocaleString()}
              </span>
            </div>
          </div>

          {/* Event ID */}
          <div className="pt-4 border-t border-[#E5E5E5]">
            <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Event ID</span>
            <code className="block mt-1 text-xs text-[#737373] font-mono">{event.id}</code>
          </div>
        </div>
      </div>
    </div>
  );
}
