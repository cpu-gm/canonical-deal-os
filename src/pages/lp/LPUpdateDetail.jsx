import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import LPLayout from '@/components/lp/LPLayout';
import {
  ArrowLeft, Loader2, FileText, Calendar, AlertTriangle,
  TrendingUp, TrendingDown, Minus, MessageSquare, Send,
  CheckCircle2, Clock, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { PageError } from '@/components/ui/page-state';
import { debugLog } from '@/lib/debug';

const BFF_BASE = import.meta.env.VITE_BFF_BASE_URL || 'http://localhost:8787';

function formatDate(dateString) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });
}

function getTypeLabel(type) {
  switch (type) {
    case 'QUARTERLY_UPDATE':
      return 'Quarterly Update';
    case 'MILESTONE':
      return 'Milestone';
    case 'ISSUE_ALERT':
      return 'Issue Alert';
    case 'GENERAL':
      return 'General Update';
    default:
      return type;
  }
}

function MetricCard({ metric }) {
  const variance = metric.actual - metric.target;
  const variancePercent = metric.target ? ((variance / metric.target) * 100).toFixed(1) : 0;
  const isPositive = variance > 0;
  const isNegative = variance < 0;

  return (
    <div className="bg-gray-50 rounded-lg p-4">
      <div className="text-sm text-gray-500 mb-1">{metric.label}</div>
      <div className="text-2xl font-bold text-gray-900 mb-2">
        {metric.format === 'currency' ? `$${metric.actual?.toLocaleString()}` :
          metric.format === 'percent' ? `${metric.actual}%` :
            metric.actual?.toLocaleString()}
      </div>
      {metric.target !== undefined && (
        <div className={cn(
          "flex items-center gap-1 text-sm",
          isPositive && "text-green-600",
          isNegative && "text-red-600",
          !isPositive && !isNegative && "text-gray-500"
        )}>
          {isPositive ? <TrendingUp className="w-4 h-4" /> :
            isNegative ? <TrendingDown className="w-4 h-4" /> :
              <Minus className="w-4 h-4" />}
          <span>
            {isPositive ? '+' : ''}{variancePercent}% vs target
          </span>
        </div>
      )}
    </div>
  );
}

function VarianceRow({ item }) {
  const variance = item.actual - item.plan;
  const variancePercent = item.plan ? ((variance / item.plan) * 100).toFixed(1) : 0;

  return (
    <tr className="border-b border-gray-100 last:border-0">
      <td className="py-3 text-gray-900">{item.label}</td>
      <td className="py-3 text-right text-gray-600">
        {item.format === 'currency' ? `$${item.plan?.toLocaleString()}` : item.plan}
      </td>
      <td className="py-3 text-right text-gray-900 font-medium">
        {item.format === 'currency' ? `$${item.actual?.toLocaleString()}` : item.actual}
      </td>
      <td className={cn(
        "py-3 text-right font-medium",
        variance > 0 && "text-green-600",
        variance < 0 && "text-red-600",
        variance === 0 && "text-gray-500"
      )}>
        {variance > 0 ? '+' : ''}{variancePercent}%
      </td>
    </tr>
  );
}

function RiskItem({ risk }) {
  return (
    <div className="border-l-4 border-yellow-400 bg-yellow-50 p-4 rounded-r-lg">
      <div className="font-medium text-gray-900 mb-1">{risk.title}</div>
      <p className="text-sm text-gray-600 mb-2">{risk.description}</p>
      {risk.mitigation && (
        <div className="text-sm">
          <span className="text-gray-500">Mitigation: </span>
          <span className="text-gray-700">{risk.mitigation}</span>
        </div>
      )}
    </div>
  );
}

function QuestionItem({ question }) {
  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <MessageSquare className="w-5 h-5 text-gray-400 mt-0.5" />
        <div className="flex-1">
          <p className="text-gray-900 mb-2">{question.question}</p>
          {question.status === 'ANSWERED' ? (
            <div className="bg-blue-50 rounded-lg p-3 mt-2">
              <div className="flex items-center gap-2 text-sm text-blue-600 mb-1">
                <CheckCircle2 className="w-4 h-4" />
                <span>Answered by {question.answeredByName}</span>
                <span className="text-blue-400">•</span>
                <span>{formatDate(question.answeredAt)}</span>
              </div>
              <p className="text-gray-700">{question.answer}</p>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Clock className="w-4 h-4" />
              <span>Awaiting response</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function LPUpdateDetail() {
  const { dealId, updateId } = useParams();
  const navigate = useNavigate();
  const { authToken } = useAuth();
  const queryClient = useQueryClient();
  const [newQuestion, setNewQuestion] = useState('');
  const [showQuestions, setShowQuestions] = useState(false);

  const updateQuery = useQuery({
    queryKey: ['lp-update', dealId, updateId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/updates/${updateId}`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) throw new Error('Failed to fetch update');
      return res.json();
    },
    enabled: !!dealId && !!updateId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Update load failed', { message: error?.message, dealId, updateId });
    }
  });

  const questionsQuery = useQuery({
    queryKey: ['lp-update-questions', dealId, updateId],
    queryFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/updates/${updateId}/questions`, {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        }
      });
      if (!res.ok) return { questions: [] };
      return res.json();
    },
    enabled: !!dealId && !!updateId && !!authToken,
    onError: (error) => {
      debugLog('lp', 'Update questions load failed', { message: error?.message, dealId, updateId });
    }
  });

  const askQuestionMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${BFF_BASE}/api/lp/portal/my-investments/${dealId}/questions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          question: newQuestion,
          context: `Update: ${update?.title}`
        })
      });
      if (!res.ok) throw new Error('Failed to submit question');
      return res.json();
    },
    onSuccess: () => {
      setNewQuestion('');
      queryClient.invalidateQueries(['lp-update-questions', dealId, updateId]);
    }
  });

  const update = updateQuery.data?.update;
  const questions = questionsQuery.data?.questions || [];

  if (updateQuery.isLoading) {
    return (
      <LPLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-blue-600 mx-auto mb-4" />
            <p className="text-gray-600">Loading update...</p>
          </div>
        </div>
      </LPLayout>
    );
  }

  if (updateQuery.error) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <PageError error={updateQuery.error} onRetry={updateQuery.refetch} />
        </div>
      </LPLayout>
    );
  }

  if (!update) {
    return (
      <LPLayout>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Update Not Found</h2>
            <Button onClick={() => navigate(`/investments/${dealId}/updates`)}>
              Back to Updates
            </Button>
          </div>
        </div>
      </LPLayout>
    );
  }

  return (
    <LPLayout>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Back link */}
        <button
          onClick={() => navigate(`/investments/${dealId}/updates`)}
          className="flex items-center gap-2 text-gray-500 hover:text-gray-900 mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to updates</span>
        </button>

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="secondary">{getTypeLabel(update.updateType)}</Badge>
            {update.period && <Badge variant="outline">{update.period}</Badge>}
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">{update.title}</h1>
          <div className="flex items-center gap-4 text-sm text-gray-500">
            <div className="flex items-center gap-1">
              <Calendar className="w-4 h-4" />
              <span>{formatDate(update.publishedAt)}</span>
            </div>
            {update.createdByName && (
              <span>by {update.createdByName}</span>
            )}
          </div>
        </div>

        {/* Headline */}
        {update.headline && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-6 mb-8">
            <h2 className="text-lg font-semibold text-blue-900 mb-2">Executive Summary</h2>
            <p className="text-blue-800">{update.headline}</p>
          </div>
        )}

        {/* What Changed */}
        {update.whatChanged && Array.isArray(update.whatChanged) && update.whatChanged.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">What Changed</h2>
            <ul className="space-y-2">
              {update.whatChanged.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-2 flex-shrink-0" />
                  <span className="text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Key Metrics */}
        {update.metrics && Array.isArray(update.metrics) && update.metrics.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Key Metrics</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {update.metrics.map((metric, i) => (
                <MetricCard key={i} metric={metric} />
              ))}
            </div>
          </div>
        )}

        {/* Plan vs Actual */}
        {update.planVsActual && Array.isArray(update.planVsActual) && update.planVsActual.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Plan vs Actual</h2>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200 text-sm text-gray-500">
                    <th className="text-left py-2 font-medium">Metric</th>
                    <th className="text-right py-2 font-medium">Plan</th>
                    <th className="text-right py-2 font-medium">Actual</th>
                    <th className="text-right py-2 font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {update.planVsActual.map((item, i) => (
                    <VarianceRow key={i} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Risks & Mitigations */}
        {update.risksAndMitigations && Array.isArray(update.risksAndMitigations) && update.risksAndMitigations.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-500" />
              Risks & Mitigations
            </h2>
            <div className="space-y-4">
              {update.risksAndMitigations.map((risk, i) => (
                <RiskItem key={i} risk={risk} />
              ))}
            </div>
          </div>
        )}

        {/* Next Quarter Priorities */}
        {update.nextQuarterPriorities && Array.isArray(update.nextQuarterPriorities) && update.nextQuarterPriorities.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Next Quarter Priorities</h2>
            <ul className="space-y-2">
              {update.nextQuarterPriorities.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium flex-shrink-0">
                    {i + 1}
                  </div>
                  <span className="text-gray-700">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Q&A Section */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <button
            onClick={() => setShowQuestions(!showQuestions)}
            className="flex items-center justify-between w-full"
          >
            <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-gray-400" />
              Questions & Answers
              {questions.length > 0 && (
                <Badge variant="secondary">{questions.length}</Badge>
              )}
            </h2>
            {showQuestions ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>

          {showQuestions && (
            <div className="mt-4 space-y-4">
              {/* Ask a question */}
              <div className="border border-gray-200 rounded-lg p-4">
                <h3 className="font-medium text-gray-900 mb-2">Ask a Question</h3>
                <Textarea
                  placeholder="Type your question here..."
                  value={newQuestion}
                  onChange={(e) => setNewQuestion(e.target.value)}
                  className="mb-3"
                  rows={3}
                />
                <Button
                  onClick={() => askQuestionMutation.mutate()}
                  disabled={!newQuestion.trim() || askQuestionMutation.isPending}
                >
                  {askQuestionMutation.isPending ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4 mr-2" />
                  )}
                  Submit Question
                </Button>
              </div>

              {/* Existing questions */}
              {questions.length > 0 && (
                <div className="space-y-4">
                  {questions.map(q => (
                    <QuestionItem key={q.id} question={q} />
                  ))}
                </div>
              )}

              {questions.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  No questions yet. Be the first to ask!
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </LPLayout>
  );
}
