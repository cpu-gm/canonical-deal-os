import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { useAuth } from '@/lib/AuthContext';
import {
  FileText, Plus, Search, ChevronDown, ChevronUp,
  Loader2, Clock, CheckCircle2, Send,
  MessageSquare, ArrowLeft, AlertTriangle, TrendingUp
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
  SCHEDULED: { label: 'Scheduled', color: 'bg-blue-100 text-blue-700', icon: Clock },
  PUBLISHED: { label: 'Published', color: 'bg-green-100 text-green-700', icon: CheckCircle2 }
};

const TYPE_OPTIONS = [
  { value: 'QUARTERLY_UPDATE', label: 'Quarterly Update', icon: FileText },
  { value: 'MILESTONE', label: 'Milestone', icon: TrendingUp },
  { value: 'ISSUE_ALERT', label: 'Issue Alert', icon: AlertTriangle },
  { value: 'GENERAL', label: 'General Update', icon: MessageSquare }
];

function UpdateRow({ update, deal, onPublish, onExpand, isExpanded, onViewQuestions }) {
  const config = STATUS_CONFIG[update.status] || STATUS_CONFIG.DRAFT;
  const StatusIcon = config.icon;
  const typeConfig = TYPE_OPTIONS.find(t => t.value === update.updateType);
  const TypeIcon = typeConfig?.icon || FileText;

  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50">
        <td className="py-4 px-4">
          <button
            onClick={() => onExpand(update.id)}
            className="flex items-center gap-2 text-gray-500 hover:text-gray-700"
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </td>
        <td className="py-4 px-4">
          <div className="flex items-center gap-3">
            <div className={cn(
              "w-8 h-8 rounded-lg flex items-center justify-center",
              update.updateType === 'ISSUE_ALERT' ? 'bg-red-100 text-red-600' :
              update.updateType === 'MILESTONE' ? 'bg-green-100 text-green-600' :
              'bg-blue-100 text-blue-600'
            )}>
              <TypeIcon className="w-4 h-4" />
            </div>
            <div>
              <div className="font-medium text-gray-900">{update.title}</div>
              <div className="text-sm text-gray-500">
                {typeConfig?.label || update.updateType}
                {update.period && ` • ${update.period}`}
              </div>
            </div>
          </div>
        </td>
        <td className="py-4 px-4">
          <div className="text-gray-900">{deal?.name || update.dealId}</div>
        </td>
        <td className="py-4 px-4">
          <Badge className={cn("gap-1", config.color)}>
            <StatusIcon className="w-3 h-3" />
            {config.label}
          </Badge>
        </td>
        <td className="py-4 px-4">
          {update.status === 'PUBLISHED' ? formatDate(update.publishedAt) : '-'}
        </td>
        <td className="py-4 px-4">
          <div className="text-sm text-gray-500">{update.createdByName}</div>
        </td>
        <td className="py-4 px-4">
          <div className="flex gap-2 justify-end">
            {update.status === 'DRAFT' && (
              <Button size="sm" onClick={() => onPublish(update)}>
                <Send className="w-3 h-3 mr-1" />
                Publish
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => onViewQuestions(update)}>
              <MessageSquare className="w-3 h-3 mr-1" />
              Q&A
            </Button>
          </div>
        </td>
      </tr>
      {isExpanded && (
        <tr className="bg-gray-50">
          <td colSpan={7} className="px-4 py-4">
            <div className="pl-8 space-y-4">
              {update.headline && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h5 className="font-medium text-blue-900 mb-1">Executive Summary</h5>
                  <p className="text-blue-800">{update.headline}</p>
                </div>
              )}

              {update.whatChanged && update.whatChanged.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h5 className="font-medium text-gray-900 mb-2">What Changed</h5>
                  <ul className="space-y-1">
                    {update.whatChanged.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                        <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {update.metrics && update.metrics.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h5 className="font-medium text-gray-900 mb-2">Key Metrics</h5>
                  <div className="grid grid-cols-3 gap-4">
                    {update.metrics.map((m, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg p-3">
                        <div className="text-sm text-gray-500">{m.label}</div>
                        <div className="text-lg font-semibold text-gray-900">
                          {m.format === 'currency' ? `$${m.actual?.toLocaleString()}` :
                           m.format === 'percent' ? `${m.actual}%` : m.actual}
                        </div>
                        {m.target && (
                          <div className={cn(
                            "text-xs",
                            m.actual >= m.target ? "text-green-600" : "text-red-600"
                          )}>
                            vs {m.format === 'currency' ? `$${m.target?.toLocaleString()}` : m.target} target
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {update.risksAndMitigations && update.risksAndMitigations.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-4">
                  <h5 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Risks & Mitigations
                  </h5>
                  <div className="space-y-2">
                    {update.risksAndMitigations.map((r, i) => (
                      <div key={i} className="border-l-2 border-amber-400 pl-3 py-1">
                        <div className="font-medium text-gray-900">{r.title}</div>
                        <div className="text-sm text-gray-600">{r.description}</div>
                        {r.mitigation && (
                          <div className="text-sm text-green-600 mt-1">
                            Mitigation: {r.mitigation}
                          </div>
                        )}
                      </div>
                    ))}
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

function CreateUpdateDialog({ open, onClose, deals, onSuccess }) {
  const { authToken, user } = useAuth();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    dealId: '',
    title: '',
    updateType: 'QUARTERLY_UPDATE',
    period: '',
    headline: '',
    whatChanged: [''],
    metrics: [],
    risksAndMitigations: [],
    nextQuarterPriorities: ['']
  });

  const createMutation = useMutation({
    mutationFn: async (data) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${data.dealId}/updates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        },
        body: JSON.stringify({
          title: data.title,
          updateType: data.updateType,
          period: data.period,
          headline: data.headline,
          whatChanged: data.whatChanged.filter(w => w.trim()),
          metrics: data.metrics,
          risksAndMitigations: data.risksAndMitigations,
          nextQuarterPriorities: data.nextQuarterPriorities.filter(p => p.trim()),
          createdBy: user?.id || 'unknown',
          createdByName: user?.name || 'Unknown'
        })
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to create update');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['investor-updates']);
      toast({ title: 'Update created', description: 'You can now publish it to LPs.' });
      onSuccess?.();
      onClose();
      setFormData({
        dealId: '',
        title: '',
        updateType: 'QUARTERLY_UPDATE',
        period: '',
        headline: '',
        whatChanged: [''],
        metrics: [],
        risksAndMitigations: [],
        nextQuarterPriorities: ['']
      });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.dealId || !formData.title) {
      toast({ title: 'Missing fields', description: 'Please fill in required fields', variant: 'destructive' });
      return;
    }
    createMutation.mutate(formData);
  };

  const addWhatChanged = () => {
    setFormData({ ...formData, whatChanged: [...formData.whatChanged, ''] });
  };

  const updateWhatChanged = (index, value) => {
    const updated = [...formData.whatChanged];
    updated[index] = value;
    setFormData({ ...formData, whatChanged: updated });
  };

  const addPriority = () => {
    setFormData({ ...formData, nextQuarterPriorities: [...formData.nextQuarterPriorities, ''] });
  };

  const updatePriority = (index, value) => {
    const updated = [...formData.nextQuarterPriorities];
    updated[index] = value;
    setFormData({ ...formData, nextQuarterPriorities: updated });
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Investor Update</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
              <Select value={formData.updateType} onValueChange={(v) => setFormData({ ...formData, updateType: v })}>
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
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
              <Input
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="e.g., Q4 2025 Quarterly Update"
              />
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Executive Summary</label>
            <Textarea
              value={formData.headline}
              onChange={(e) => setFormData({ ...formData, headline: e.target.value })}
              placeholder="Brief summary of key points for LPs..."
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">What Changed</label>
            <div className="space-y-2">
              {formData.whatChanged.map((item, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={item}
                    onChange={(e) => updateWhatChanged(i, e.target.value)}
                    placeholder="Bullet point..."
                  />
                  {i === formData.whatChanged.length - 1 && (
                    <Button type="button" variant="outline" size="icon" onClick={addWhatChanged}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Next Quarter Priorities</label>
            <div className="space-y-2">
              {formData.nextQuarterPriorities.map((item, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={item}
                    onChange={(e) => updatePriority(i, e.target.value)}
                    placeholder="Priority item..."
                  />
                  {i === formData.nextQuarterPriorities.length - 1 && (
                    <Button type="button" variant="outline" size="icon" onClick={addPriority}>
                      <Plus className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Create Update
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QADialog({ open, onClose, update, onAnswerSubmit }) {
  const { authToken } = useAuth();
  const [questions, setQuestions] = useState([]);
  const [answerText, setAnswerText] = useState('');
  const [selectedQuestionId, setSelectedQuestionId] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  React.useEffect(() => {
    if (open && update) {
      fetchQuestions();
    }
  }, [open, update]);

  const fetchQuestions = async () => {
    if (!update) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${BFF_BASE}/api/deals/${update.dealId}/updates/${update.id}/questions`, {
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (res.ok) {
        const data = await res.json();
        setQuestions(data.questions || []);
      }
    } catch (e) {
      console.error('Failed to fetch questions:', e);
    }
    setIsLoading(false);
  };

  const handleAnswer = async () => {
    if (!selectedQuestionId || !answerText.trim()) return;
    await onAnswerSubmit(update, selectedQuestionId, answerText);
    setAnswerText('');
    setSelectedQuestionId(null);
    fetchQuestions();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Q&A: {update?.title}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : questions.length === 0 ? (
          <div className="text-center py-8">
            <MessageSquare className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500">No questions from LPs yet.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {questions.map(q => (
              <div key={q.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <MessageSquare className="w-4 h-4 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-gray-900">{q.question}</p>
                    <div className="text-xs text-gray-500 mt-1">
                      {formatDate(q.createdAt)}
                    </div>

                    {q.status === 'ANSWERED' ? (
                      <div className="bg-green-50 rounded-lg p-3 mt-3">
                        <div className="flex items-center gap-2 text-sm text-green-600 mb-1">
                          <CheckCircle2 className="w-4 h-4" />
                          Answered by {q.answeredByName}
                        </div>
                        <p className="text-gray-700">{q.answer}</p>
                      </div>
                    ) : selectedQuestionId === q.id ? (
                      <div className="mt-3">
                        <Textarea
                          value={answerText}
                          onChange={(e) => setAnswerText(e.target.value)}
                          placeholder="Type your answer..."
                          rows={3}
                        />
                        <div className="flex gap-2 mt-2">
                          <Button size="sm" onClick={handleAnswer} disabled={!answerText.trim()}>
                            Submit Answer
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setSelectedQuestionId(null)}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2"
                        onClick={() => setSelectedQuestionId(q.id)}
                      >
                        Answer
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function InvestorUpdates() {
  const navigate = useNavigate();
  const { authToken, user } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDeal, setSelectedDeal] = useState('all');
  const [selectedType, setSelectedType] = useState('all');
  const [expandedId, setExpandedId] = useState(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [qaUpdate, setQaUpdate] = useState(null);

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

  // Fetch all updates
  const updatesQuery = useQuery({
    queryKey: ['investor-updates', selectedDeal],
    queryFn: async () => {
      if (selectedDeal !== 'all') {
        const res = await fetch(`${BFF_BASE}/api/deals/${selectedDeal}/updates`, {
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          }
        });
        if (!res.ok) {
          if (res.status === 404) return { updates: [] };
          throw new Error('Failed to fetch updates');
        }
        return res.json();
      }

      const deals = dealsQuery.data || [];
      const allUpdates = await Promise.all(
        deals.map(async (deal) => {
          try {
            const res = await fetch(`${BFF_BASE}/api/deals/${deal.id}/updates`, {
              headers: {
                'Content-Type': 'application/json',
                ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
              }
            });
            if (!res.ok) return [];
            const data = await res.json();
            return (data.updates || []).map(u => ({ ...u, dealId: deal.id }));
          } catch {
            return [];
          }
        })
      );
      return { updates: allUpdates.flat() };
    },
    enabled: !!dealsQuery.data
  });

  const publishMutation = useMutation({
    mutationFn: async (update) => {
      const res = await fetch(`${BFF_BASE}/api/deals/${update.dealId}/updates/${update.id}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
        }
      });
      if (!res.ok) throw new Error('Failed to publish update');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries(['investor-updates']);
      toast({ title: 'Update published', description: 'LPs can now see this update.' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const answerMutation = useMutation({
    mutationFn: async ({ update, questionId, answer }) => {
      const res = await fetch(
        `${BFF_BASE}/api/deals/${update.dealId}/updates/${update.id}/questions/${questionId}/answer`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
          },
          body: JSON.stringify({
            answer,
            answeredBy: user?.id || 'unknown',
            answeredByName: user?.name || 'GP Team'
          })
        }
      );
      if (!res.ok) throw new Error('Failed to submit answer');
      return res.json();
    },
    onSuccess: () => {
      toast({ title: 'Answer submitted' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  });

  const deals = dealsQuery.data || [];
  const updates = updatesQuery.data?.updates || [];

  const filteredUpdates = updates.filter(update => {
    const matchesSearch = !searchQuery ||
      update.title?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDeal = selectedDeal === 'all' || update.dealId === selectedDeal;
    const matchesType = selectedType === 'all' || update.updateType === selectedType;
    return matchesSearch && matchesDeal && matchesType;
  });

  const isLoading = dealsQuery.isLoading || updatesQuery.isLoading;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Button variant="ghost" size="icon" onClick={() => navigate(createPageUrl('Investors'))}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Investor Updates</h1>
          <p className="text-sm text-gray-500 mt-1">Create and manage quarterly updates and announcements</p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <Plus className="w-4 h-4 mr-2" />
          Create Update
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search updates..."
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
        <Select value={selectedType} onValueChange={setSelectedType}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All Types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {TYPE_OPTIONS.map(opt => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Updates Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : filteredUpdates.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Updates</h3>
            <p className="text-gray-500 mb-4">Create your first investor update to keep LPs informed.</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Update
            </Button>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="py-3 px-4 w-10"></th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Update</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Deal</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Published</th>
                <th className="text-left py-3 px-4 text-sm font-medium text-gray-500">Author</th>
                <th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filteredUpdates.map(update => (
                <UpdateRow
                  key={update.id}
                  update={update}
                  deal={deals.find(d => d.id === update.dealId)}
                  onPublish={(u) => publishMutation.mutate(u)}
                  onExpand={(id) => setExpandedId(expandedId === id ? null : id)}
                  isExpanded={expandedId === update.id}
                  onViewQuestions={(u) => setQaUpdate(u)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Dialog */}
      <CreateUpdateDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        deals={deals}
        onSuccess={() => queryClient.invalidateQueries(['investor-updates'])}
      />

      {/* Q&A Dialog */}
      <QADialog
        open={!!qaUpdate}
        onClose={() => setQaUpdate(null)}
        update={qaUpdate}
        onAnswerSubmit={(update, questionId, answer) =>
          answerMutation.mutate({ update, questionId, answer })
        }
      />
    </div>
  );
}
