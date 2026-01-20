import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  FileText,
  Sparkles,
  Edit2,
  Save,
  X,
  Download,
  RefreshCw,
  Eye
} from 'lucide-react';

export default function MemoPanel({ dealId, dealName, memo, model, scenarios, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [showPreview, setShowPreview] = useState(true);

  const generateMutation = useMutation({
    mutationFn: () => bff.underwriting.generateMemo(dealId),
    onSuccess: () => {
      onUpdate();
      toast({ title: 'Memo generated', description: 'IC memo created from underwriting model.' });
    },
    onError: (error) => {
      toast({ title: 'Generation failed', description: error.message, variant: 'destructive' });
    }
  });

  const updateMutation = useMutation({
    mutationFn: (content) => bff.underwriting.updateMemo(dealId, { content }),
    onSuccess: () => {
      setIsEditing(false);
      onUpdate();
      toast({ title: 'Memo saved' });
    },
    onError: (error) => {
      toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    }
  });

  const startEditing = () => {
    setEditContent(memo?.content || '');
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setIsEditing(false);
    setEditContent('');
  };

  const saveMemo = () => {
    updateMutation.mutate(editContent);
  };

  const downloadMemo = () => {
    if (!memo?.content) return;

    const blob = new Blob([memo.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `IC-Memo-${dealName || 'Deal'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // If no memo exists
  if (!memo?.content) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FileText className="w-12 h-12 text-[#E5E5E5] mx-auto mb-4" />
          <h3 className="text-lg font-medium text-[#171717] mb-2">No IC Memo Yet</h3>
          <p className="text-sm text-[#737373] mb-6 max-w-md mx-auto">
            Generate an Investment Committee memo from your underwriting model.
            The memo will include deal summary, returns analysis, key assumptions, and risk factors.
          </p>
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending || !model}
            className="gap-2"
          >
            {generateMutation.isPending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Generate IC Memo
          </Button>
          {!model && (
            <p className="text-xs text-amber-600 mt-2">
              Complete underwriting model inputs first
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-violet-50">
            <FileText className="w-5 h-5 text-violet-600" />
          </div>
          <div>
            <h3 className="font-medium text-[#171717]">Investment Committee Memo</h3>
            <p className="text-xs text-[#737373]">
              {memo.generatedAt && (
                <>
                  Generated {new Date(memo.generatedAt).toLocaleDateString()}
                  {memo.updatedAt && memo.updatedAt !== memo.generatedAt && (
                    <> · Updated {new Date(memo.updatedAt).toLocaleDateString()}</>
                  )}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="gap-1"
              >
                <RefreshCw className={cn("w-4 h-4", generateMutation.isPending && "animate-spin")} />
                Regenerate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={downloadMemo}
                className="gap-1"
              >
                <Download className="w-4 h-4" />
                Export
              </Button>
              <Button
                size="sm"
                onClick={startEditing}
                className="gap-1"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Memo content */}
      <Card>
        {isEditing ? (
          <CardContent className="p-0">
            <div className="flex items-center justify-between p-3 border-b border-[#E5E5E5] bg-[#FAFAFA]">
              <div className="flex items-center gap-2">
                <Button
                  variant={showPreview ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setShowPreview(true)}
                  className="gap-1"
                >
                  <Eye className="w-4 h-4" />
                  Preview
                </Button>
                <Button
                  variant={!showPreview ? 'secondary' : 'ghost'}
                  size="sm"
                  onClick={() => setShowPreview(false)}
                  className="gap-1"
                >
                  <Edit2 className="w-4 h-4" />
                  Edit
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={cancelEditing}>
                  <X className="w-4 h-4 mr-1" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={saveMemo}
                  disabled={updateMutation.isPending}
                >
                  <Save className="w-4 h-4 mr-1" />
                  Save
                </Button>
              </div>
            </div>
            <div className="p-4">
              {showPreview ? (
                <MemoPreview content={editContent} />
              ) : (
                <Textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="min-h-[500px] font-mono text-sm"
                  placeholder="Write your IC memo in Markdown..."
                />
              )}
            </div>
          </CardContent>
        ) : (
          <CardContent className="p-6">
            <MemoPreview content={memo.content} />
          </CardContent>
        )}
      </Card>

      {/* Quick stats from model */}
      {model && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#737373]">Key Metrics (from model)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-5 gap-4">
              <QuickMetric label="Going-In Cap" value={model.goingInCapRate} type="percentage" />
              <QuickMetric label="IRR" value={model.irr} type="percentage" />
              <QuickMetric label="Equity Multiple" value={model.equityMultiple} type="multiple" />
              <QuickMetric label="DSCR" value={model.dscr} type="ratio" />
              <QuickMetric label="Cash-on-Cash" value={model.cashOnCash} type="percentage" />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function MemoPreview({ content }) {
  // Simple markdown rendering for headers, bullets, bold, tables
  const rendered = renderMarkdown(content);

  return (
    <div
      className="prose prose-sm max-w-none prose-headings:text-[#171717] prose-p:text-[#525252] prose-li:text-[#525252]"
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

function renderMarkdown(content) {
  if (!content) return '';

  let html = content
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="text-base font-semibold mt-6 mb-2">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-lg font-semibold mt-8 mb-3">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-xl font-bold mt-8 mb-4">$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Code inline
    .replace(/`(.*?)`/g, '<code class="bg-slate-100 px-1 py-0.5 rounded text-sm">$1</code>')
    // Lists
    .replace(/^\- (.*$)/gim, '<li class="ml-4">$1</li>')
    .replace(/^\* (.*$)/gim, '<li class="ml-4">$1</li>')
    // Line breaks
    .replace(/\n\n/g, '</p><p class="my-3">')
    .replace(/\n/g, '<br/>');

  // Wrap in paragraph
  html = '<p class="my-3">' + html + '</p>';

  // Clean up empty paragraphs
  html = html.replace(/<p class="my-3"><\/p>/g, '');

  // Handle tables (basic)
  html = html.replace(/\|(.+)\|/g, (match, content) => {
    const cells = content.split('|').map(c => c.trim());
    return '<tr>' + cells.map(c => `<td class="border px-2 py-1">${c}</td>`).join('') + '</tr>';
  });

  return html;
}

function QuickMetric({ label, value, type }) {
  const formatValue = (v, t) => {
    if (v === null || v === undefined) return '—';
    switch (t) {
      case 'percentage':
        return `${(v * 100).toFixed(1)}%`;
      case 'multiple':
      case 'ratio':
        return `${v.toFixed(2)}x`;
      default:
        return v.toLocaleString();
    }
  };

  return (
    <div className="text-center">
      <div className="text-lg font-semibold text-[#171717]">
        {formatValue(value, type)}
      </div>
      <div className="text-xs text-[#737373]">{label}</div>
    </div>
  );
}
