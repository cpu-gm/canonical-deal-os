import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  History,
  FileText,
  FileSpreadsheet,
  Bot,
  User,
  Calculator,
  CheckCircle2,
  Clock
} from 'lucide-react';

const SOURCE_CONFIG = {
  DOCUMENT: {
    icon: FileText,
    label: 'Document',
    color: 'blue'
  },
  AI_EXTRACTION: {
    icon: Bot,
    label: 'AI Extraction',
    color: 'violet'
  },
  EXCEL_IMPORT: {
    icon: FileSpreadsheet,
    label: 'Excel Import',
    color: 'green'
  },
  HUMAN_ENTRY: {
    icon: User,
    label: 'Manual Entry',
    color: 'amber'
  },
  CALCULATION: {
    icon: Calculator,
    label: 'Calculated',
    color: 'slate'
  }
};

export default function ProvenancePopover({ dealId, fieldPath }) {
  const [open, setOpen] = React.useState(false);

  const { data: historyData, isLoading } = useQuery({
    queryKey: ['input-history', dealId, fieldPath],
    queryFn: () => bff.underwriting.getInputHistory(dealId, fieldPath),
    enabled: open
  });

  const history = historyData?.history || [];
  const currentInput = history[0];

  if (!currentInput && !isLoading) {
    return null;
  }

  const sourceConfig = SOURCE_CONFIG[currentInput?.sourceType] || SOURCE_CONFIG.DOCUMENT;
  const SourceIcon = sourceConfig.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 hover:bg-slate-100"
        >
          <History className="w-3 h-3 text-[#A3A3A3]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Value Source</h4>
            {currentInput?.verifiedAt && (
              <Badge variant="outline" className="text-green-600 border-green-200">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Verified
              </Badge>
            )}
          </div>

          {isLoading ? (
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-slate-100 rounded w-3/4"></div>
              <div className="h-4 bg-slate-100 rounded w-1/2"></div>
            </div>
          ) : currentInput ? (
            <>
              {/* Current source */}
              <div className="p-3 rounded-lg bg-[#FAFAFA] border border-[#E5E5E5]">
                <div className="flex items-center gap-2 mb-2">
                  <SourceIcon className={cn("w-4 h-4", `text-${sourceConfig.color}-600`)} />
                  <span className="text-sm font-medium">{sourceConfig.label}</span>
                </div>

                {currentInput.documentName && (
                  <div className="text-xs text-[#737373] flex items-center gap-1">
                    <FileText className="w-3 h-3" />
                    {currentInput.documentName}
                    {currentInput.documentCell && (
                      <span className="text-[#A3A3A3]">({currentInput.documentCell})</span>
                    )}
                  </div>
                )}

                {currentInput.aiConfidence && (
                  <div className="text-xs text-[#737373] mt-1">
                    Confidence: {Math.round(currentInput.aiConfidence * 100)}%
                  </div>
                )}

                {currentInput.rationale && (
                  <div className="text-xs text-[#525252] mt-2 italic">
                    "{currentInput.rationale}"
                  </div>
                )}

                <div className="text-xs text-[#A3A3A3] mt-2 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {currentInput.setByName} · {formatDate(currentInput.setAt)}
                </div>
              </div>

              {/* History */}
              {history.length > 1 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-[#737373]">History</div>
                  {history.slice(1, 4).map((item, i) => {
                    const config = SOURCE_CONFIG[item.sourceType] || SOURCE_CONFIG.DOCUMENT;
                    const Icon = config.icon;
                    return (
                      <div
                        key={item.id || i}
                        className="flex items-center gap-2 text-xs text-[#A3A3A3] py-1"
                      >
                        <Icon className="w-3 h-3" />
                        <span>{config.label}</span>
                        <span>·</span>
                        <span>{formatDate(item.setAt)}</span>
                        {item.supersededAt && (
                          <Badge variant="outline" className="h-4 text-[10px]">
                            superseded
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                  {history.length > 4 && (
                    <div className="text-xs text-[#A3A3A3]">
                      +{history.length - 4} more
                    </div>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="text-sm text-[#737373]">
              No provenance data available
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;

  // Less than 24 hours
  if (diff < 86400000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  // Less than 7 days
  if (diff < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short' });
  }
  // Otherwise
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
