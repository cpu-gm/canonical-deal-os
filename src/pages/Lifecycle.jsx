import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useRole } from '../Layout';
import { 
  ChevronRight, 
  Lock, 
  Check,
  AlertTriangle,
  Info,
  ArrowRight,
  Users
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const lifecycleStates = [
  { id: 'Draft', label: 'Draft', description: 'Initial deal entry' },
  { id: 'Under Review', label: 'Under Review', description: 'Due diligence in progress' },
  { id: 'Approved', label: 'Approved', description: 'All parties approved' },
  { id: 'Ready to Close', label: 'Ready to Close', description: 'Awaiting closing conditions' },
  { id: 'Closed', label: 'Closed', description: 'Transaction completed' },
  { id: 'Operating', label: 'Operating', description: 'Asset under management' },
  { id: 'Changed', label: 'Changed', description: 'Material change occurred' },
  { id: 'Distressed', label: 'Distressed', description: 'Covenant breach or stress' },
  { id: 'Resolved', label: 'Resolved', description: 'Distress resolved' },
  { id: 'Exited', label: 'Exited', description: 'Asset sold or refinanced' }
];

const transitions = [
  { from: 'Draft', to: 'Under Review', requires: ['GP'], evidence: ['Deal memo', 'Initial underwriting'] },
  { from: 'Under Review', to: 'Approved', requires: ['GP', 'Lender'], evidence: ['Due diligence complete', 'Credit approval'] },
  { from: 'Approved', to: 'Ready to Close', requires: ['GP', 'Lender', 'Trustee'], evidence: ['Title clear', 'Insurance bound'] },
  { from: 'Ready to Close', to: 'Closed', requires: ['GP', 'Lender', 'Trustee'], evidence: ['Funds wired', 'Deed recorded'] },
  { from: 'Closed', to: 'Operating', requires: ['System'], evidence: ['Closing confirmed'] },
  { from: 'Operating', to: 'Changed', requires: ['GP', 'Lender'], evidence: ['Material change documentation'] },
  { from: 'Operating', to: 'Distressed', requires: ['System'], evidence: ['Covenant breach detected'] },
  { from: 'Changed', to: 'Operating', requires: ['GP', 'Lender'], evidence: ['Change approved'] },
  { from: 'Distressed', to: 'Resolved', requires: ['GP', 'Lender', 'Trustee'], evidence: ['Cure documentation'] },
  { from: 'Resolved', to: 'Operating', requires: ['Lender'], evidence: ['Release of stress mode'] },
  { from: 'Operating', to: 'Exited', requires: ['GP', 'Lender', 'LP'], evidence: ['Sale documentation'] }
];

export default function LifecyclePage() {
  const { currentRole } = useRole();
  const urlParams = new URLSearchParams(window.location.search);
  const dealIdFromUrl = urlParams.get('id');
  
  const [selectedDealId, setSelectedDealId] = useState(dealIdFromUrl || '');
  const [hoveredTransition, setHoveredTransition] = useState(null);

  const { data: deals = [] } = useQuery({
    queryKey: ['deals'],
    queryFn: () => bff.deals.list(),
  });

  const selectedDeal = deals.find(d => d.id === selectedDealId);
  const currentStateIndex = lifecycleStates.findIndex(s => s.id === selectedDeal?.lifecycle_state);

  const getTransition = (fromState, toState) => {
    return transitions.find(t => t.from === fromState && t.to === toState);
  };

  const isValidTransition = (fromState, toState) => {
    return transitions.some(t => t.from === fromState && t.to === toState);
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Deal Lifecycle</h1>
        <p className="text-sm text-[#737373] mt-1">Enforced state machine with required authorities and evidence</p>
      </div>

      {/* Deal Selector */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex-1 max-w-md">
            <label className="text-sm font-medium text-[#171717] block mb-2">Select Deal</label>
            <Select value={selectedDealId} onValueChange={setSelectedDealId}>
              <SelectTrigger className="border-[#E5E5E5]">
                <SelectValue placeholder="Choose a deal to view lifecycle" />
              </SelectTrigger>
              <SelectContent>
                {deals.map(deal => (
                  <SelectItem key={deal.id} value={deal.id}>
                    {deal.name} — {deal.lifecycle_state || 'Draft'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {selectedDeal && (
            <Link 
              to={createPageUrl(`DealOverview?id=${selectedDealId}`)}
              className="text-sm text-[#737373] hover:text-[#171717] flex items-center gap-1"
            >
              View Deal <ChevronRight className="w-4 h-4" />
            </Link>
          )}
        </div>
      </div>

      {/* Lifecycle Visualization */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-8">
        {/* State Machine */}
        <div className="relative">
          {/* Main Flow */}
          <div className="flex flex-wrap gap-4 justify-center">
            {lifecycleStates.slice(0, 6).map((state, index) => {
              const isActive = selectedDeal?.lifecycle_state === state.id;
              const isPast = currentStateIndex > index;
              const isFuture = currentStateIndex < index;
              const nextState = lifecycleStates[index + 1];
              const transition = nextState ? getTransition(state.id, nextState.id) : null;

              return (
                <React.Fragment key={state.id}>
                  <div 
                    className={cn(
                      "relative p-4 rounded-xl border-2 transition-all duration-200 w-36",
                      isActive ? "border-[#0A0A0A] bg-[#0A0A0A] text-white" :
                      isPast ? "border-green-200 bg-green-50" :
                      "border-[#E5E5E5] bg-white"
                    )}
                  >
                    {isPast && (
                      <div className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-green-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                      </div>
                    )}
                    <p className={cn(
                      "font-semibold text-sm text-center",
                      isActive ? "text-white" : isPast ? "text-green-700" : "text-[#171717]"
                    )}>
                      {state.label}
                    </p>
                    <p className={cn(
                      "text-xs text-center mt-1",
                      isActive ? "text-white/70" : "text-[#A3A3A3]"
                    )}>
                      {state.description}
                    </p>
                  </div>

                  {index < 5 && (
                    <div 
                      className="flex items-center"
                      onMouseEnter={() => transition && setHoveredTransition(transition)}
                      onMouseLeave={() => setHoveredTransition(null)}
                    >
                      <ArrowRight className={cn(
                        "w-5 h-5 cursor-pointer transition-colors",
                        isPast ? "text-green-500" : "text-[#E5E5E5]"
                      )} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Secondary States (Distress Flow) */}
          <div className="mt-8 pt-8 border-t border-[#E5E5E5]">
            <p className="text-xs text-[#A3A3A3] uppercase tracking-wider mb-4 text-center">Stress & Exit Paths</p>
            <div className="flex flex-wrap gap-4 justify-center">
              {lifecycleStates.slice(6).map((state) => {
                const isActive = selectedDeal?.lifecycle_state === state.id;
                
                return (
                  <div 
                    key={state.id}
                    className={cn(
                      "relative p-4 rounded-xl border-2 transition-all duration-200 w-36",
                      isActive && state.id === 'Distressed' ? "border-red-500 bg-red-50" :
                      isActive ? "border-[#0A0A0A] bg-[#0A0A0A] text-white" :
                      state.id === 'Distressed' ? "border-red-200 bg-red-50/50" :
                      "border-[#E5E5E5] bg-white"
                    )}
                  >
                    {state.id === 'Distressed' && (
                      <AlertTriangle className="w-4 h-4 text-red-500 absolute -top-2 -right-2" />
                    )}
                    <p className={cn(
                      "font-semibold text-sm text-center",
                      isActive && state.id !== 'Distressed' ? "text-white" : 
                      state.id === 'Distressed' ? "text-red-700" : "text-[#171717]"
                    )}>
                      {state.label}
                    </p>
                    <p className={cn(
                      "text-xs text-center mt-1",
                      isActive && state.id !== 'Distressed' ? "text-white/70" : "text-[#A3A3A3]"
                    )}>
                      {state.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Transition Info Panel - Fixed height to prevent layout shift on hover */}
        <div
          className={cn(
            "mt-8 p-4 bg-[#FAFAFA] rounded-xl border border-[#E5E5E5] min-h-[120px] transition-opacity duration-200",
            hoveredTransition ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        >
          {hoveredTransition ? (
            <div className="flex items-start gap-4">
              <Info className="w-5 h-5 text-[#A3A3A3] flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-[#171717]">
                  {hoveredTransition.from} → {hoveredTransition.to}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Required Authority</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {hoveredTransition.requires.map(role => (
                        <span key={role} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs font-medium">
                          {role}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Required Evidence</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {hoveredTransition.evidence.map(ev => (
                        <span key={ev} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                          {ev}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-sm text-[#A3A3A3]">
              Hover over a transition to see details
            </div>
          )}
        </div>

        {/* Transition Rules Legend */}
        <div className="mt-8 pt-6 border-t border-[#E5E5E5]">
          <h3 className="text-sm font-semibold text-[#171717] mb-4">Transition Rules</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {transitions.slice(0, 6).map((t, i) => (
              <div 
                key={i}
                className="p-3 rounded-lg border border-[#E5E5E5] hover:border-[#171717] transition-colors cursor-pointer"
                onMouseEnter={() => setHoveredTransition(t)}
                onMouseLeave={() => setHoveredTransition(null)}
              >
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-medium text-[#171717]">{t.from}</span>
                  <ArrowRight className="w-3 h-3 text-[#A3A3A3]" />
                  <span className="font-medium text-[#171717]">{t.to}</span>
                </div>
                <div className="flex items-center gap-1 mt-2">
                  <Users className="w-3 h-3 text-[#A3A3A3]" />
                  <span className="text-xs text-[#737373]">{t.requires.join(' + ')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Enforcement Notice */}
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <div className="flex items-start gap-3">
            <Lock className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-amber-800">Enforced State Machine</p>
              <p className="text-xs text-amber-700 mt-1">
                Transitions are enforced at the system level. Unauthorized transitions are blocked.
                Each transition requires specific authorities and evidence to proceed.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
