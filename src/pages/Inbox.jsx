import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { bff } from '@/api/bffClient';
import { createPageUrl } from '../utils';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { humanizeAction, humanizeText } from '@/lib/fieldHumanization';

const scopes = [
  { key: 'mine', label: 'My Actions', description: 'Assigned to you and needs attention' },
  { key: 'waiting', label: 'Waiting on Others', description: 'Blocked on other roles' },
  { key: 'risk', label: 'Risk', description: 'Stress mode or high risk truth health' },
  { key: 'data_requests', label: 'Data Requests', description: 'Evidence and review tasks' }
];

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
  if (health === 'warning') return <Clock className="w-4 h-4 text-amber-500" />;
  return <AlertTriangle className="w-4 h-4 text-red-500" />;
};

export default function InboxPage() {
  const [scope, setScope] = useState('mine');

  const { data, isLoading } = useQuery({
    queryKey: ['inbox', scope],
    queryFn: () => bff.inbox.list(scope)
  });

  const items = useMemo(() => data?.items ?? [], [data]);
  const scopeMeta = scopes.find((item) => item.key === scope) ?? scopes[0];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Operator Inbox</h1>
        <p className="text-sm text-[#737373] mt-1">{scopeMeta.description}</p>
      </div>

      <Tabs value={scope} onValueChange={setScope}>
        <TabsList className="bg-white border border-[#E5E5E5] rounded-lg p-1">
          {scopes.map((item) => (
            <TabsTrigger key={item.key} value={item.key} className="px-4 py-2 text-sm">
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {scopes.map((item) => (
          <TabsContent key={item.key} value={item.key} className="mt-6">
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="bg-white rounded-xl border border-[#E5E5E5] p-5 animate-pulse">
                    <div className="h-4 bg-slate-100 rounded w-1/3 mb-3"></div>
                    <div className="h-3 bg-slate-100 rounded w-1/2"></div>
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="bg-white rounded-xl border border-[#E5E5E5] p-10 text-center text-sm text-[#737373]">
                No items in this inbox.
              </div>
            ) : (
              <div className="space-y-3">
                {items.map((entry) => (
                  <Link
                    key={`${entry.dealId}-${entry.primary_blocker || entry.updatedAt}`}
                    to={createPageUrl(`DealOverview?id=${entry.dealId}`)}
                    className="block bg-white rounded-xl border border-[#E5E5E5] p-5 hover:border-[#171717] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-[#171717]">{entry.dealName}</h3>
                          <Badge className={cn("text-xs font-medium", lifecycleColors[entry.lifecycle_state] || 'bg-slate-100 text-slate-700')}>
                            {entry.lifecycle_state || 'Draft'}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-[#737373]">
                          <TruthHealthIcon health={entry.truth_health || 'healthy'} />
                          <span>{entry.truth_health || 'healthy'}</span>
                          <span className="text-[#A3A3A3]">-</span>
                          <span>{humanizeText(entry.primary_blocker) || 'No active blockers'}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-[#A3A3A3] uppercase tracking-wider">Next Action</div>
                        <div className="text-sm font-medium text-[#171717]">
                          {entry.next_action?.actionType
                            ? humanizeAction(entry.next_action.actionType)
                            : humanizeText(entry.next_action?.label) || '-'}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
