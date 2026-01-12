import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Link } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useRole } from '../Layout';
import { 
  Building2, 
  AlertTriangle, 
  CheckCircle2, 
  AlertCircle,
  ChevronRight,
  Clock,
  DollarSign,
  Percent,
  TrendingUp,
  Users,
  FileText,
  GitBranch,
  Search,
  Lock,
  ArrowRight,
  Info,
  Shield
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import TraceabilityPanel from '@/components/TraceabilityPanel';

const lifecycleColors = {
  'Draft': 'bg-slate-100 text-slate-700 border-slate-200',
  'Under Review': 'bg-amber-50 text-amber-700 border-amber-200',
  'Approved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  'Ready to Close': 'bg-blue-50 text-blue-700 border-blue-200',
  'Closed': 'bg-violet-50 text-violet-700 border-violet-200',
  'Operating': 'bg-green-50 text-green-700 border-green-200',
  'Changed': 'bg-orange-50 text-orange-700 border-orange-200',
  'Distressed': 'bg-red-50 text-red-700 border-red-200',
  'Resolved': 'bg-teal-50 text-teal-700 border-teal-200',
  'Exited': 'bg-slate-50 text-slate-600 border-slate-200'
};

const TruthHealthBadge = ({ health }) => {
  if (health === 'healthy') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green-50 border border-green-200 rounded-lg">
        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
        <span className="text-xs font-medium text-green-700">Truth Verified</span>
      </div>
    );
  }
  if (health === 'warning') {
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 border border-amber-200 rounded-lg">
        <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
        <span className="text-xs font-medium text-amber-700">Pending Verification</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-red-50 border border-red-200 rounded-lg">
      <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
      <span className="text-xs font-medium text-red-700">Issues Detected</span>
    </div>
  );
};

export default function DealOverviewPage() {
  const { currentRole } = useRole();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const dealId = urlParams.get('id');
  const [traceField, setTraceField] = useState(null);

  const { data: deal, isLoading } = useQuery({
    queryKey: ['deal', dealId],
    queryFn: () => base44.entities.Deal.filter({ id: dealId }),
    enabled: !!dealId,
    select: (data) => data[0]
  });

  const { data: events = [] } = useQuery({
    queryKey: ['deal-events', dealId],
    queryFn: () => base44.entities.DealEvent.filter({ deal_id: dealId }, '-created_date'),
    enabled: !!dealId
  });

  const { data: authorities = [] } = useQuery({
    queryKey: ['authorities', dealId],
    queryFn: () => base44.entities.Authority.filter({ deal_id: dealId }),
    enabled: !!dealId
  });

  const { data: covenants = [] } = useQuery({
    queryKey: ['covenants', dealId],
    queryFn: () => base44.entities.Covenant.filter({ deal_id: dealId }),
    enabled: !!dealId
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="animate-pulse space-y-6">
          <div className="h-8 bg-slate-100 rounded w-1/3"></div>
          <div className="h-32 bg-slate-100 rounded"></div>
          <div className="grid grid-cols-4 gap-4">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-100 rounded"></div>)}
          </div>
        </div>
      </div>
    );
  }

  if (!deal) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-12 text-center">
          <Building2 className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">Deal not found</h3>
          <Link to={createPageUrl('Deals')} className="text-sm text-blue-600 hover:underline">
            Return to Deals
          </Link>
        </div>
      </div>
    );
  }

  const roleActionMap = {
    'GP': deal.next_action || 'Complete deal documentation',
    'Lender': 'Review underwriting package',
    'Regulator': 'Audit compliance records',
    'Auditor': 'Verify event trail',
    'LP': 'Review investment summary'
  };

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Stress Mode Banner */}
      {deal.stress_mode && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-red-800">Stress Mode Active</h3>
              <p className="text-sm text-red-700 mt-1">
                Automation reduced. Certain actions require additional approval.
              </p>
              {deal.stress_reason && (
                <p className="text-sm text-red-600 mt-2">
                  Reason: {deal.stress_reason}
                </p>
              )}
              <Link 
                to={createPageUrl(`Explain?id=${dealId}&query=stress_mode`)}
                className="inline-flex items-center gap-1 text-sm font-medium text-red-700 hover:text-red-800 mt-2"
              >
                Click to understand why
                <ChevronRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">{deal.name}</h1>
              {deal.ai_derived && (
                <span className="text-xs px-2 py-1 bg-violet-50 text-violet-700 rounded font-medium">
                  🤖 AI-Derived
                </span>
              )}
            </div>
            <p className="text-sm text-[#737373]">
              {deal.asset_address ? `${deal.asset_address}, ${deal.asset_city}, ${deal.asset_state}` : 'No address specified'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <TruthHealthBadge health={deal.truth_health || 'healthy'} />
            <Badge className={cn("font-medium border", lifecycleColors[deal.lifecycle_state] || lifecycleColors['Draft'])}>
              {deal.lifecycle_state || 'Draft'}
            </Badge>
          </div>
        </div>
      </div>

      {/* State-First Panel */}
      <div className="bg-white rounded-xl border border-[#E5E5E5] p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-3">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-[#0A0A0A] flex items-center justify-center">
                <GitBranch className="w-4 h-4 text-white" />
              </div>
              <div>
                <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Current State</span>
                <p className="text-lg font-semibold text-[#171717]">{deal.lifecycle_state || 'Draft'}</p>
              </div>
            </div>

            {deal.blocked_by && (
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg mb-4">
                <Lock className="w-4 h-4 text-amber-600" />
                <span className="text-sm text-amber-800">
                  <span className="font-medium">Blocked by:</span> {deal.blocked_by}
                </span>
              </div>
            )}

            <div className="flex items-center gap-2 mb-2">
              <Shield className="w-4 h-4 text-[#A3A3A3]" />
              <span className="text-sm text-[#737373]">Your Role: <span className="font-medium text-[#171717]">{currentRole}</span></span>
            </div>

            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#A3A3A3]" />
              <span className="text-sm text-[#737373]">Next Action: <span className="font-medium text-[#171717]">{roleActionMap[currentRole]}</span></span>
            </div>
          </div>

          <div className="flex flex-col justify-center items-end">
            <Button className="bg-[#0A0A0A] hover:bg-[#171717] w-full md:w-auto">
              {deal.lifecycle_state === 'Draft' ? 'Submit for Review' : 
               deal.lifecycle_state === 'Under Review' ? 'View Requirements' :
               deal.lifecycle_state === 'Approved' ? 'Prepare Closing' :
               'View Details'}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Key Metrics */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Key Metrics</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard 
                label="Purchase Price" 
                value={deal.purchase_price ? `$${(deal.purchase_price / 1000000).toFixed(1)}M` : '—'}
                icon={DollarSign}
                onClick={() => setTraceField('purchase_price')}
              />
              <MetricCard 
                label="NOI" 
                value={deal.noi ? `$${(deal.noi / 1000).toFixed(0)}K` : '—'}
                icon={TrendingUp}
                onClick={() => setTraceField('noi')}
              />
              <MetricCard 
                label="LTV" 
                value={deal.ltv ? `${(deal.ltv * 100).toFixed(0)}%` : '—'}
                icon={Percent}
                onClick={() => setTraceField('ltv')}
              />
              <MetricCard 
                label="DSCR" 
                value={deal.dscr ? deal.dscr.toFixed(2) + 'x' : '—'}
                icon={TrendingUp}
                onClick={() => setTraceField('dscr')}
              />
            </div>
          </div>

          {/* Capital Stack */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Capital Stack</h3>
            <div className="space-y-3">
              <CapitalStackRow 
                label="Senior Debt" 
                value={deal.senior_debt}
                total={deal.purchase_price}
                color="bg-blue-500"
              />
              <CapitalStackRow 
                label="Mezzanine" 
                value={deal.mezzanine_debt}
                total={deal.purchase_price}
                color="bg-violet-500"
              />
              <CapitalStackRow 
                label="Preferred Equity" 
                value={deal.preferred_equity}
                total={deal.purchase_price}
                color="bg-amber-500"
              />
              <CapitalStackRow 
                label="Common Equity" 
                value={deal.common_equity}
                total={deal.purchase_price}
                color="bg-emerald-500"
              />
            </div>
          </div>

          {/* Recent Events */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[#171717]">Recent Events</h3>
              <Link 
                to={createPageUrl(`Traceability?id=${dealId}`)}
                className="text-xs text-[#737373] hover:text-[#171717] flex items-center gap-1"
              >
                View all <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="space-y-3">
              {events.slice(0, 5).map((event) => (
                <div key={event.id} className="flex items-start gap-3 py-2 border-b border-[#F5F5F5] last:border-0">
                  <div className="w-8 h-8 rounded-lg bg-[#F5F5F5] flex items-center justify-center flex-shrink-0">
                    <FileText className="w-4 h-4 text-[#737373]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#171717]">{event.event_title}</p>
                    <p className="text-xs text-[#A3A3A3] mt-0.5">
                      {event.authority_role} • {new Date(event.timestamp || event.created_date).toLocaleDateString()}
                    </p>
                  </div>
                  <EvidenceBadge type={event.evidence_type} />
                </div>
              ))}
              {events.length === 0 && (
                <p className="text-sm text-[#A3A3A3] text-center py-4">No events recorded</p>
              )}
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Participants */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Participants</h3>
            <div className="space-y-3">
              {deal.gp_name && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-emerald-700">GP</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#171717]">{deal.gp_name}</p>
                    <p className="text-xs text-[#A3A3A3]">General Partner</p>
                  </div>
                </div>
              )}
              {deal.lender_name && (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-blue-700">L</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[#171717]">{deal.lender_name}</p>
                    <p className="text-xs text-[#A3A3A3]">Lender</p>
                  </div>
                </div>
              )}
              {authorities.map((auth) => (
                <div key={auth.id} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-slate-700">{auth.role[0]}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#171717]">{auth.entity_name}</p>
                    <p className="text-xs text-[#A3A3A3]">{auth.role}</p>
                  </div>
                  <ConsentBadge status={auth.consent_status} />
                </div>
              ))}
            </div>
          </div>

          {/* Covenants */}
          {covenants.length > 0 && (
            <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
              <h3 className="text-sm font-semibold text-[#171717] mb-4">Covenants</h3>
              <div className="space-y-3">
                {covenants.map((covenant) => (
                  <div 
                    key={covenant.id} 
                    className={cn(
                      "p-3 rounded-lg border",
                      covenant.status === 'breach' ? 'bg-red-50 border-red-200' :
                      covenant.status === 'warning' ? 'bg-amber-50 border-amber-200' :
                      'bg-green-50 border-green-200'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{covenant.covenant_type}</span>
                      <span className={cn(
                        "text-xs font-medium",
                        covenant.status === 'breach' ? 'text-red-700' :
                        covenant.status === 'warning' ? 'text-amber-700' :
                        'text-green-700'
                      )}>
                        {covenant.current_value} {covenant.threshold_operator} {covenant.threshold_value}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick Links */}
          <div className="bg-white rounded-xl border border-[#E5E5E5] p-6">
            <h3 className="text-sm font-semibold text-[#171717] mb-4">Quick Actions</h3>
            <div className="space-y-2">
              <Link 
                to={createPageUrl(`Lifecycle?id=${dealId}`)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#F5F5F5] transition-colors"
              >
                <GitBranch className="w-4 h-4 text-[#737373]" />
                <span className="text-sm text-[#171717]">View Lifecycle</span>
                <ChevronRight className="w-4 h-4 text-[#A3A3A3] ml-auto" />
              </Link>
              <Link 
                to={createPageUrl(`Traceability?id=${dealId}`)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#F5F5F5] transition-colors"
              >
                <Search className="w-4 h-4 text-[#737373]" />
                <span className="text-sm text-[#171717]">Full Traceability</span>
                <ChevronRight className="w-4 h-4 text-[#A3A3A3] ml-auto" />
              </Link>
              <Link 
                to={createPageUrl(`Explain?id=${dealId}`)}
                className="flex items-center gap-3 p-3 rounded-lg hover:bg-[#F5F5F5] transition-colors"
              >
                <Info className="w-4 h-4 text-[#737373]" />
                <span className="text-sm text-[#171717]">Explain Any Number</span>
                <ChevronRight className="w-4 h-4 text-[#A3A3A3] ml-auto" />
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Traceability Panel */}
      {traceField && (
        <TraceabilityPanel 
          deal={deal}
          field={traceField}
          events={events}
          onClose={() => setTraceField(null)}
        />
      )}
    </div>
  );
}

function MetricCard({ label, value, icon: Icon, onClick }) {
  return (
    <button 
      onClick={onClick}
      className="p-4 rounded-lg bg-[#FAFAFA] hover:bg-[#F5F5F5] transition-colors text-left group"
    >
      <div className="flex items-center justify-between mb-2">
        <Icon className="w-4 h-4 text-[#A3A3A3]" />
        <Search className="w-3 h-3 text-[#A3A3A3] opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
      <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">{label}</span>
      <p className="text-lg font-semibold text-[#171717] mt-0.5">{value}</p>
    </button>
  );
}

function CapitalStackRow({ label, value, total, color }) {
  const percentage = total && value ? (value / total) * 100 : 0;
  
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[#737373]">{label}</span>
        <span className="text-sm font-medium text-[#171717]">
          {value ? `$${(value / 1000000).toFixed(1)}M` : '—'}
        </span>
      </div>
      <div className="h-2 bg-[#F5F5F5] rounded-full overflow-hidden">
        <div 
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function EvidenceBadge({ type }) {
  const config = {
    'document_verified': { label: '📄 Doc', className: 'bg-green-50 text-green-700' },
    'human_attested': { label: '👤 Human', className: 'bg-blue-50 text-blue-700' },
    'ai_derived': { label: '🤖 AI', className: 'bg-violet-50 text-violet-700' },
    'system_computed': { label: '⚙️ System', className: 'bg-slate-50 text-slate-700' }
  };
  
  const { label, className } = config[type] || config['system_computed'];
  
  return (
    <span className={cn("text-[10px] px-2 py-0.5 rounded font-medium", className)}>
      {label}
    </span>
  );
}

function ConsentBadge({ status }) {
  if (status === 'approved') {
    return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  }
  if (status === 'rejected') {
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  }
  return <Clock className="w-4 h-4 text-amber-500" />;
}