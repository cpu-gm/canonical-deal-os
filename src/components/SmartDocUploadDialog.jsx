import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/components/ui/use-toast";
import FileUploadZone from "@/components/FileUploadZone";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  FileSearch,
  Sparkles,
  ArrowRight,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  humanizeFieldPath,
  formatCurrency
} from '@/lib/fieldHumanization';

// Steps in the smart upload flow
const STEPS = {
  UPLOAD: 'upload',
  PARSING: 'parsing',
  REVIEW: 'review',
  APPLYING: 'applying',
  COMPLETE: 'complete'
};

export default function SmartDocUploadDialog({
  open,
  onOpenChange,
  dealId,
  missingFields = [], // Fields that need values
  currentProfile = {}, // Current deal profile values
  onSuccess
}) {
  const queryClient = useQueryClient();

  // State
  const [step, setStep] = useState(STEPS.UPLOAD);
  const [selectedFile, setSelectedFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [artifactId, setArtifactId] = useState(null);
  const [selectedFields, setSelectedFields] = useState({});
  const [parseError, setParseError] = useState(null);

  const resetForm = () => {
    setStep(STEPS.UPLOAD);
    setSelectedFile(null);
    setExtractedData(null);
    setArtifactId(null);
    setSelectedFields({});
    setParseError(null);
  };

  const handleClose = () => {
    if (step !== STEPS.PARSING && step !== STEPS.APPLYING) {
      resetForm();
      onOpenChange(false);
    }
  };

  // Parse document mutation
  const parseMutation = useMutation({
    mutationFn: async (file) => {
      setStep(STEPS.PARSING);
      setParseError(null);

      // Step 1: Upload the file as an artifact
      const formData = new FormData();
      formData.append('file', file);

      const artifactRes = await fetch(`/api/deals/${dealId}/artifacts`, {
        method: 'POST',
        body: formData
      });

      if (!artifactRes.ok) {
        throw new Error('Failed to upload document');
      }

      const artifact = await artifactRes.json();
      setArtifactId(artifact.id);

      // Step 2: Send to smart parse endpoint
      const parseRes = await fetch(`/api/deals/${dealId}/smart-parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId: artifact.id,
          filename: file.name,
          targetFields: missingFields.map(f => f.fieldPath || f)
        })
      });

      if (!parseRes.ok) {
        const error = await parseRes.json();
        throw new Error(error.message || 'Failed to parse document');
      }

      return parseRes.json();
    },
    onSuccess: (data) => {
      setExtractedData(data);

      // Auto-select all extracted fields that have values
      const autoSelected = {};
      for (const [field, info] of Object.entries(data.extracted || {})) {
        if (info.value !== null && info.value !== undefined) {
          autoSelected[field] = true;
        }
      }
      setSelectedFields(autoSelected);

      setStep(STEPS.REVIEW);
    },
    onError: (error) => {
      setParseError(error.message);
      setStep(STEPS.UPLOAD);
      toast({
        title: "Parse failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  // Apply extracted values mutation
  const applyMutation = useMutation({
    mutationFn: async () => {
      setStep(STEPS.APPLYING);

      // Get selected fields to apply
      const fieldsToApply = Object.entries(selectedFields)
        .filter(([_, selected]) => selected)
        .map(([field]) => ({
          fieldPath: field,
          value: extractedData.extracted[field].value
        }));

      if (fieldsToApply.length === 0) {
        throw new Error('No fields selected to apply');
      }

      // Call the apply endpoint
      const res = await fetch(`/api/deals/${dealId}/smart-parse/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artifactId,
          fields: fieldsToApply
        })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to apply changes');
      }

      return res.json();
    },
    onSuccess: (data) => {
      setStep(STEPS.COMPLETE);

      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });

      toast({
        title: "Fields updated",
        description: `${data.appliedCount} field(s) updated from document.`
      });

      onSuccess?.(data);
    },
    onError: (error) => {
      setStep(STEPS.REVIEW);
      toast({
        title: "Failed to apply",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleUpload = () => {
    if (selectedFile) {
      parseMutation.mutate(selectedFile);
    }
  };

  const handleApply = () => {
    applyMutation.mutate();
  };

  const toggleField = (field) => {
    setSelectedFields(prev => ({
      ...prev,
      [field]: !prev[field]
    }));
  };

  const selectedCount = Object.values(selectedFields).filter(Boolean).length;

  const formatValue = (field, value) => {
    if (value === null || value === undefined) return '—';

    // Format currency fields
    if (['purchase_price', 'noi', 'senior_debt', 'mezzanine_debt', 'preferred_equity', 'common_equity'].includes(field.replace('profile.', ''))) {
      return formatCurrency(value);
    }

    // Format percentage fields
    if (['cap_rate', 'ltv', 'occupancy'].includes(field.replace('profile.', ''))) {
      return `${(value * 100).toFixed(2)}%`;
    }

    return String(value);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-500" />
            Smart Document Upload
          </DialogTitle>
          <DialogDescription>
            {step === STEPS.UPLOAD && "Upload a document and we'll automatically extract the missing information."}
            {step === STEPS.PARSING && "Analyzing document and extracting data..."}
            {step === STEPS.REVIEW && "Review extracted values before applying them."}
            {step === STEPS.APPLYING && "Applying changes to the deal..."}
            {step === STEPS.COMPLETE && "Document processed successfully!"}
          </DialogDescription>
        </DialogHeader>

        {/* Step: Upload */}
        {step === STEPS.UPLOAD && (
          <div className="space-y-4 py-4">
            <FileUploadZone
              onFileSelect={setSelectedFile}
              onClearFile={() => setSelectedFile(null)}
              selectedFile={selectedFile}
              accept=".pdf,.docx,.xlsx,.doc,.xls,.csv,.txt"
            />

            {missingFields.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-amber-800">
                    <p className="font-medium">Looking for these fields:</p>
                    <ul className="mt-1 space-y-0.5">
                      {missingFields.slice(0, 5).map((field, i) => (
                        <li key={i} className="text-amber-700">
                          • {humanizeFieldPath(typeof field === 'string' ? field : field.fieldPath)}
                        </li>
                      ))}
                      {missingFields.length > 5 && (
                        <li className="text-amber-600">...and {missingFields.length - 5} more</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {parseError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 mt-0.5" />
                  <p className="text-sm text-red-700">{parseError}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: Parsing */}
        {step === STEPS.PARSING && (
          <div className="py-8 flex flex-col items-center gap-4">
            <div className="relative">
              <FileSearch className="w-12 h-12 text-violet-500" />
              <Loader2 className="w-6 h-6 text-violet-600 animate-spin absolute -bottom-1 -right-1" />
            </div>
            <div className="text-center">
              <p className="font-medium text-[#171717]">Analyzing document...</p>
              <p className="text-sm text-[#737373] mt-1">
                Extracting relevant information using AI
              </p>
            </div>
          </div>
        )}

        {/* Step: Review */}
        {step === STEPS.REVIEW && extractedData && (
          <div className="py-4 space-y-4">
            <div className="text-sm text-[#737373] flex items-center gap-2">
              <FileText className="w-4 h-4" />
              <span>Found {Object.keys(extractedData.extracted || {}).length} field(s) in document</span>
            </div>

            <div className="max-h-[300px] overflow-y-auto space-y-2">
              {Object.entries(extractedData.extracted || {}).map(([field, info]) => {
                const hasValue = info.value !== null && info.value !== undefined;
                const currentValue = currentProfile[field.replace('profile.', '')];
                const isSelected = selectedFields[field];

                return (
                  <div
                    key={field}
                    className={cn(
                      "p-3 rounded-lg border transition-colors",
                      hasValue && isSelected
                        ? "border-green-200 bg-green-50"
                        : hasValue
                          ? "border-[#E5E5E5] bg-white hover:border-green-300 cursor-pointer"
                          : "border-[#E5E5E5] bg-slate-50 opacity-60"
                    )}
                    onClick={() => hasValue && toggleField(field)}
                  >
                    <div className="flex items-start gap-3">
                      {hasValue ? (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => toggleField(field)}
                          className="mt-0.5"
                        />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-300 mt-0.5" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-[#171717]">
                          {humanizeFieldPath(field)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          {currentValue !== undefined && currentValue !== null ? (
                            <>
                              <span className="text-xs text-[#737373]">
                                Current: {formatValue(field, currentValue)}
                              </span>
                              <ArrowRight className="w-3 h-3 text-[#A3A3A3]" />
                            </>
                          ) : null}
                          <span className={cn(
                            "text-xs font-medium",
                            hasValue ? "text-green-700" : "text-slate-400"
                          )}>
                            {hasValue ? formatValue(field, info.value) : 'Not found in document'}
                          </span>
                        </div>
                        {info.confidence && (
                          <p className="text-xs text-[#A3A3A3] mt-1">
                            Confidence: {Math.round(info.confidence * 100)}%
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {selectedCount > 0 && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                  <p className="text-sm text-green-800">
                    {selectedCount} field(s) selected to apply
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step: Applying */}
        {step === STEPS.APPLYING && (
          <div className="py-8 flex flex-col items-center gap-4">
            <Loader2 className="w-12 h-12 text-green-600 animate-spin" />
            <div className="text-center">
              <p className="font-medium text-[#171717]">Applying changes...</p>
              <p className="text-sm text-[#737373] mt-1">
                Updating deal fields and provenance
              </p>
            </div>
          </div>
        )}

        {/* Step: Complete */}
        {step === STEPS.COMPLETE && (
          <div className="py-8 flex flex-col items-center gap-4">
            <CheckCircle2 className="w-12 h-12 text-green-600" />
            <div className="text-center">
              <p className="font-medium text-[#171717]">Changes applied successfully!</p>
              <p className="text-sm text-[#737373] mt-1">
                The deal fields have been updated with document-backed values.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === STEPS.UPLOAD && (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleUpload}
                disabled={!selectedFile}
                className="bg-violet-600 hover:bg-violet-700"
              >
                <Sparkles className="w-4 h-4 mr-2" />
                Analyze Document
              </Button>
            </>
          )}

          {step === STEPS.REVIEW && (
            <>
              <Button variant="outline" onClick={() => setStep(STEPS.UPLOAD)}>
                Upload Different
              </Button>
              <Button
                onClick={handleApply}
                disabled={selectedCount === 0}
              >
                Apply {selectedCount} Field(s)
              </Button>
            </>
          )}

          {step === STEPS.COMPLETE && (
            <Button onClick={handleClose}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
