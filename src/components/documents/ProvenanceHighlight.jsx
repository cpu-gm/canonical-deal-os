import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  FileText,
  FileSpreadsheet,
  Bot,
  User,
  CheckCircle2,
  Clock,
  Info,
  Eye
} from 'lucide-react';

const SOURCE_TYPE_CONFIG = {
  AI_EXTRACTION: {
    label: 'AI Extracted',
    icon: Bot,
    color: 'text-violet-600',
    bgColor: 'bg-violet-50'
  },
  EXCEL_IMPORT: {
    label: 'Excel Import',
    icon: FileSpreadsheet,
    color: 'text-green-600',
    bgColor: 'bg-green-50'
  },
  DOCUMENT: {
    label: 'Document',
    icon: FileText,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50'
  },
  HUMAN_ENTRY: {
    label: 'Manual Entry',
    icon: User,
    color: 'text-amber-600',
    bgColor: 'bg-amber-50'
  },
  CALCULATION: {
    label: 'Calculated',
    icon: Info,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50'
  }
};

/**
 * ProvenanceHighlight - Wraps a value and shows its source on click/hover
 *
 * Usage:
 * <ProvenanceHighlight
 *   dealId="deal-123"
 *   fieldPath="purchasePrice"
 *   value="$5,000,000"
 * />
 */
export default function ProvenanceHighlight({
  dealId,
  fieldPath,
  value,
  className,
  showIndicator = true,
  triggerMode = 'click' // 'click' | 'hover'
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Fetch provenance for this field
  const { data: provenanceData, isLoading } = useQuery({
    queryKey: ['provenance', dealId, fieldPath],
    queryFn: () => bff.verificationQueue.getFieldHistory(dealId, fieldPath),
    enabled: isOpen
  });

  const latestClaim = provenanceData?.history?.[0];
  const sourceType = latestClaim?.verification?.status === 'VERIFIED'
    ? (latestClaim?.source?.documentType?.includes('EXCEL') ? 'EXCEL_IMPORT' : 'AI_EXTRACTION')
    : 'HUMAN_ENTRY';

  const config = SOURCE_TYPE_CONFIG[sourceType] || SOURCE_TYPE_CONFIG.DOCUMENT;
  const Icon = config.icon;

  const content = (
    <div className="w-80">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-medium text-[#171717]">Data Provenance</h4>
        <Badge
          variant="outline"
          className={cn("text-xs", config.bgColor, config.color)}
        >
          <Icon className="w-3 h-3 mr-1" />
          {config.label}
        </Badge>
      </div>

      {isLoading ? (
        <div className="py-4 text-center text-[#737373] text-sm">
          Loading provenance...
        </div>
      ) : latestClaim ? (
        <div className="space-y-3">
          {/* Current value */}
          <div className="p-3 bg-[#FAFAFA] rounded-lg">
            <div className="text-xs text-[#737373] mb-1">Current Value</div>
            <div className="text-lg font-bold text-[#171717]">{value}</div>
          </div>

          {/* Source document */}
          {latestClaim.source?.documentName && (
            <div className="flex items-start gap-2">
              <FileText className="w-4 h-4 text-[#737373] mt-0.5" />
              <div>
                <div className="text-sm font-medium text-[#171717]">
                  {latestClaim.source.documentName}
                </div>
                <div className="text-xs text-[#737373]">
                  {latestClaim.source.pageNumber && `Page ${latestClaim.source.pageNumber}`}
                  {latestClaim.source.cellReference && (
                    <span className="ml-2 font-mono bg-[#E5E5E5] px-1 rounded">
                      {latestClaim.source.cellReference}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Source text snippet */}
          {latestClaim.source?.textSnippet && (
            <div className="p-2 bg-white border border-[#E5E5E5] rounded text-xs font-mono text-[#737373]">
              "{latestClaim.source.textSnippet}"
            </div>
          )}

          {/* Verification status */}
          <div className="flex items-center gap-2 text-sm">
            {latestClaim.verification?.status === 'VERIFIED' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                <span className="text-green-700">
                  Verified by {latestClaim.verification.verifiedByName}
                </span>
              </>
            ) : (
              <>
                <Clock className="w-4 h-4 text-amber-500" />
                <span className="text-amber-700">Pending Verification</span>
              </>
            )}
          </div>

          {/* AI confidence */}
          {latestClaim.extraction?.confidence && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-[#737373]">AI Confidence</span>
              <span className={cn(
                "font-medium",
                latestClaim.extraction.confidence >= 0.9 ? "text-green-600" :
                latestClaim.extraction.confidence >= 0.7 ? "text-amber-600" : "text-red-600"
              )}>
                {Math.round(latestClaim.extraction.confidence * 100)}%
              </span>
            </div>
          )}

          {/* Extraction timestamp */}
          {latestClaim.extraction?.extractedAt && (
            <div className="text-xs text-[#737373]">
              Extracted {new Date(latestClaim.extraction.extractedAt).toLocaleString()}
            </div>
          )}
        </div>
      ) : (
        <div className="py-4 text-center text-[#737373] text-sm">
          No provenance data available
        </div>
      )}

      {/* View history link */}
      {provenanceData?.history?.length > 1 && (
        <div className="mt-3 pt-3 border-t border-[#E5E5E5]">
          <button className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
            <Eye className="w-3 h-3" />
            View {provenanceData.history.length - 1} previous values
          </button>
        </div>
      )}
    </div>
  );

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "inline-flex items-center gap-1 group cursor-pointer",
            "hover:bg-blue-50 hover:text-blue-700 px-1 -mx-1 rounded transition-colors",
            className
          )}
          onMouseEnter={triggerMode === 'hover' ? () => setIsOpen(true) : undefined}
          onMouseLeave={triggerMode === 'hover' ? () => setIsOpen(false) : undefined}
        >
          {value}
          {showIndicator && (
            <Info className="w-3 h-3 text-[#A3A3A3] group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-4">
        {content}
      </PopoverContent>
    </Popover>
  );
}

/**
 * ProvenanceBadge - A smaller indicator to show source type
 */
export function ProvenanceBadge({ sourceType, confidence }) {
  const config = SOURCE_TYPE_CONFIG[sourceType] || SOURCE_TYPE_CONFIG.DOCUMENT;
  const Icon = config.icon;

  return (
    <Badge
      variant="outline"
      className={cn("text-xs", config.bgColor, config.color, "gap-1")}
    >
      <Icon className="w-3 h-3" />
      {config.label}
      {confidence && (
        <span className="ml-1 opacity-75">
          ({Math.round(confidence * 100)}%)
        </span>
      )}
    </Badge>
  );
}

/**
 * ProvenanceTable - Shows provenance for multiple fields
 */
export function ProvenanceTable({ dealId, fields }) {
  return (
    <div className="divide-y divide-[#E5E5E5]">
      {fields.map(field => (
        <div key={field.path} className="py-2 flex items-center justify-between">
          <span className="text-sm text-[#737373]">{field.label}</span>
          <ProvenanceHighlight
            dealId={dealId}
            fieldPath={field.path}
            value={field.value}
            className="font-medium text-[#171717]"
          />
        </div>
      ))}
    </div>
  );
}
