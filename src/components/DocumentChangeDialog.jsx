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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/use-toast";
import FileUploadZone from "@/components/FileUploadZone";
import {
  CheckCircle2,
  Circle,
  Loader2,
  AlertCircle,
  FileText
} from 'lucide-react';
import { cn } from '@/lib/utils';

const CHANGE_TYPES = [
  { value: "NOI_VARIANCE", label: "NOI Variance", description: "Net Operating Income change from projections" },
  { value: "OCCUPANCY_CHANGE", label: "Occupancy Change", description: "Tenant occupancy rate fluctuation" },
  { value: "DEBT_RESTRUCTURE", label: "Debt Restructure", description: "Changes to loan terms or structure" },
  { value: "PROPERTY_VALUE_ADJUSTMENT", label: "Property Value Adjustment", description: "Updated appraisal or market value" },
  { value: "CAPITAL_STACK_CHANGE", label: "Capital Stack Change", description: "Equity or debt composition change" },
  { value: "COVENANT_BREACH", label: "Covenant Breach", description: "Financial covenant threshold crossed" },
  { value: "TENANT_CHANGE", label: "Tenant Change", description: "Major tenant move-in or move-out" },
  { value: "CAPITAL_EXPENDITURE", label: "Capital Expenditure", description: "Significant property improvement or repair" },
  { value: "OTHER", label: "Other", description: "Describe the change below" }
];

const PROGRESS_STEPS = [
  { key: 'upload', label: 'Document uploaded' },
  { key: 'declare', label: 'Change declared' },
  { key: 'legal_approval', label: 'Awaiting LEGAL approval' },
  { key: 'reconcile', label: 'Reconciliation pending' }
];

export default function DocumentChangeDialog({
  open,
  onOpenChange,
  dealId,
  onSuccess
}) {
  const queryClient = useQueryClient();

  // Form state
  const [changeType, setChangeType] = useState('');
  const [description, setDescription] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);

  // Progress state
  const [progress, setProgress] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setChangeType('');
    setDescription('');
    setSelectedFile(null);
    setProgress(null);
    setIsSubmitting(false);
  };

  const handleClose = () => {
    if (!isSubmitting) {
      resetForm();
      onOpenChange(false);
    }
  };

  const documentChangeMutation = useMutation({
    mutationFn: async () => {
      setIsSubmitting(true);

      // Step 1: Upload artifact (if file provided)
      let artifactId = null;
      if (selectedFile) {
        setProgress({ step: 'upload', status: 'loading' });

        const formData = new FormData();
        formData.append('file', selectedFile);

        const artifactRes = await fetch(`/api/deals/${dealId}/artifacts`, {
          method: 'POST',
          body: formData
        });

        if (!artifactRes.ok) {
          throw new Error('Failed to upload document');
        }

        const artifact = await artifactRes.json();
        artifactId = artifact.id;
        setProgress({ step: 'upload', status: 'complete' });
      }

      // Step 2: Create MaterialChangeDetected event (declare change)
      setProgress({ step: 'declare', status: 'loading' });

      const declareRes = await fetch(`/api/deals/${dealId}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'MaterialChangeDetected',
          payload: {
            changeType,
            description,
            ...(artifactId && { artifactId })
          },
          evidenceRefs: artifactId ? [artifactId] : []
        })
      });

      if (!declareRes.ok) {
        const error = await declareRes.json();
        throw new Error(error.message || 'Failed to declare change');
      }

      const declareEvent = await declareRes.json();
      setProgress({ step: 'declare', status: 'complete' });

      // Step 3: Show awaiting LEGAL approval status
      setProgress({ step: 'legal_approval', status: 'waiting' });

      return {
        artifactId,
        declareEvent,
        status: 'PENDING_APPROVAL'
      };
    },
    onSuccess: (data) => {
      // Invalidate queries to refresh deal state
      queryClient.invalidateQueries({ queryKey: ['deal-home', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-data-trust', dealId] });
      queryClient.invalidateQueries({ queryKey: ['deal-records', dealId] });
      queryClient.invalidateQueries({ queryKey: ['inbox'] });

      toast({
        title: "Change documented",
        description: "LEGAL has been notified for approval. The deal is now in 'Changed' state.",
        duration: 5000
      });

      onSuccess?.(data);
    },
    onError: (error) => {
      setIsSubmitting(false);
      toast({
        title: "Failed to document change",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    }
  });

  const handleSubmit = () => {
    if (!changeType) {
      toast({
        title: "Change type required",
        description: "Please select what type of change occurred",
        variant: "destructive"
      });
      return;
    }

    if (!description.trim()) {
      toast({
        title: "Description required",
        description: "Please describe the change",
        variant: "destructive"
      });
      return;
    }

    documentChangeMutation.mutate();
  };

  const getStepStatus = (stepKey) => {
    if (!progress) return 'pending';

    const stepOrder = PROGRESS_STEPS.findIndex(s => s.key === stepKey);
    const currentOrder = PROGRESS_STEPS.findIndex(s => s.key === progress.step);

    if (stepOrder < currentOrder) return 'complete';
    if (stepOrder === currentOrder) return progress.status;
    return 'pending';
  };

  const isFormView = !progress;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {isFormView ? "Document Material Change" : "Documenting Change..."}
          </DialogTitle>
          <DialogDescription>
            {isFormView
              ? "Record a material change to this deal. Supporting documentation will be linked to the change event."
              : "Your change is being recorded and notifications are being sent."
            }
          </DialogDescription>
        </DialogHeader>

        {isFormView ? (
          <div className="space-y-5 py-4">
            {/* Change Type Select */}
            <div className="space-y-2">
              <Label htmlFor="change-type">What changed?</Label>
              <Select value={changeType} onValueChange={setChangeType}>
                <SelectTrigger id="change-type">
                  <SelectValue placeholder="Select change type" />
                </SelectTrigger>
                <SelectContent>
                  {CHANGE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div className="flex flex-col">
                        <span>{type.label}</span>
                        <span className="text-xs text-muted-foreground">{type.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Describe the change</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Provide details about the change, including any relevant figures or dates..."
                className="min-h-[100px]"
              />
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <Label>Supporting documentation (optional)</Label>
              <FileUploadZone
                onFileSelect={setSelectedFile}
                onClearFile={() => setSelectedFile(null)}
                selectedFile={selectedFile}
                accept=".pdf,.docx,.xlsx,.doc,.xls,.csv"
              />
            </div>

            {/* Approval Notice */}
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">Approval required from:</p>
                  <ul className="mt-1 space-y-0.5">
                    <li className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
                      <span>GP (you) - auto-approved on submission</span>
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Circle className="w-3.5 h-3.5 text-amber-500" />
                      <span>LEGAL - will be notified</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-6">
            {/* Progress View */}
            <div className="space-y-4">
              {PROGRESS_STEPS.map((step) => {
                const status = getStepStatus(step.key);
                return (
                  <div
                    key={step.key}
                    className={cn(
                      "flex items-center gap-3 p-3 rounded-lg transition-colors",
                      status === 'complete' && "bg-green-50",
                      status === 'loading' && "bg-blue-50",
                      status === 'waiting' && "bg-amber-50",
                      status === 'pending' && "bg-slate-50"
                    )}
                  >
                    {status === 'complete' && (
                      <CheckCircle2 className="w-5 h-5 text-green-600" />
                    )}
                    {status === 'loading' && (
                      <Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
                    )}
                    {status === 'waiting' && (
                      <Circle className="w-5 h-5 text-amber-600" />
                    )}
                    {status === 'pending' && (
                      <Circle className="w-5 h-5 text-slate-400" />
                    )}
                    <span className={cn(
                      "text-sm font-medium",
                      status === 'complete' && "text-green-800",
                      status === 'loading' && "text-blue-800",
                      status === 'waiting' && "text-amber-800",
                      status === 'pending' && "text-slate-500"
                    )}>
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Status Message */}
            {progress?.step === 'legal_approval' && (
              <div className="mt-6 p-4 bg-slate-50 rounded-lg">
                <p className="text-sm text-slate-700">
                  <span className="font-medium">LEGAL has been notified via email.</span>
                  <br />
                  You'll receive a notification when approved. The deal will remain in "Changed" state until reconciled.
                </p>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {isFormView ? (
            <>
              <Button
                variant="outline"
                onClick={handleClose}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !changeType || !description.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit Change for Review"
                )}
              </Button>
            </>
          ) : (
            <Button onClick={handleClose}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
