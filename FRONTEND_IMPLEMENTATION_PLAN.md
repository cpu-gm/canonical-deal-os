# Deal Intake & Distribution Platform - Frontend Implementation Plan

## Executive Summary

This document provides the implementation plan for the frontend of the Deal Intake & Distribution Platform. The backend is complete with 104 tests passing across 4 phases. This plan follows existing codebase patterns and integrates with the unified platform architecture.

---

## Current State

### Backend APIs (Complete)
| Phase | API Prefix | Capabilities |
|-------|------------|--------------|
| **Phase 1** | `/api/intake/*` | Create drafts, upload docs, extract claims, verify, resolve conflicts |
| **Phase 2** | `/api/om/*` | Generate OM, edit sections, broker/seller approval workflow |
| **Phase 3** | `/api/distribution/*` + `/api/buyer/*` | Distributions, engagement tracking, AI criteria, scoring, responses |
| **Phase 4** | `/api/gate/*` | Review queue, authorization, NDA workflow, data room access |

### Existing Frontend Stack
- React + Vite + React Router v6
- React Query (@tanstack/react-query) for state
- Shadcn/ui + Tailwind CSS + Lucide icons
- Centralized bffClient for API calls
- AuthContext/RoleContext for auth
- Page routing via `pages.config.js` + `createPageUrl()`

### Architecture Decisions
1. **Unified Platform**: Single login for buying AND selling (no separate buyer app branch)
2. **LP Portal Stays Separate**: Existing LP portal pattern unchanged in App.jsx
3. **Kernel Pages Intact**: Keep existing `Deals.jsx`, `DealOverview.jsx` for kernel deals
4. **New Page Directories**: `src/pages/intake/` for deal intake, `src/pages/buyer/` for buyer features

---

## Phase 0: Read-Model Hooks & Contracts Layer

Before building pages, create a thin data layer that encapsulates API calls and provides typed data.

### File: `src/lib/hooks/useIntakeDashboard.js`
```javascript
import { useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';

export function useIntakeDashboard(filters = {}) {
  const draftsQuery = useQuery({
    queryKey: ['intakeDrafts', filters],
    queryFn: () => bff.dealIntake.listDrafts(filters),
  });

  // Derive UI stages from backend statuses
  const derivedStats = useMemo(() => {
    const drafts = draftsQuery.data?.data || [];
    return {
      total: drafts.length,
      inDraft: drafts.filter(d => d.status === 'DRAFT_INGESTED').length,
      omDrafted: drafts.filter(d => d.status === 'OM_DRAFTED').length,
      awaitingApproval: drafts.filter(d => ['OM_BROKER_APPROVED'].includes(d.status)).length,
      readyToDistribute: drafts.filter(d => d.status === 'OM_APPROVED_FOR_MARKETING').length,
      distributed: drafts.filter(d => d.status === 'DISTRIBUTED').length,
    };
  }, [draftsQuery.data]);

  return { ...draftsQuery, derivedStats };
}
```

### File: `src/lib/hooks/useIntakeDealOverview.js`
```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';

export function useIntakeDealOverview(draftId) {
  const queryClient = useQueryClient();

  const draftQuery = useQuery({
    queryKey: ['intakeDraft', draftId],
    queryFn: () => bff.dealIntake.getDraft(draftId),
    enabled: !!draftId,
  });

  const claimsQuery = useQuery({
    queryKey: ['intakeClaims', draftId],
    queryFn: () => bff.dealIntake.getClaims(draftId, {}),
    enabled: !!draftId,
  });

  const conflictsQuery = useQuery({
    queryKey: ['intakeConflicts', draftId],
    queryFn: () => bff.dealIntake.getConflicts(draftId, 'OPEN'),
    enabled: !!draftId,
  });

  const statsQuery = useQuery({
    queryKey: ['intakeStats', draftId],
    queryFn: () => bff.dealIntake.getStats(draftId),
    enabled: !!draftId,
  });

  const verifyClaimMutation = useMutation({
    mutationFn: ({ claimId, data }) => bff.dealIntake.verifyClaim(draftId, claimId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['intakeClaims', draftId]);
      queryClient.invalidateQueries(['intakeStats', draftId]);
    },
  });

  const resolveConflictMutation = useMutation({
    mutationFn: ({ conflictId, data }) => bff.dealIntake.resolveConflict(draftId, conflictId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['intakeConflicts', draftId]);
      queryClient.invalidateQueries(['intakeClaims', draftId]);
    },
  });

  // Derive UI-only stages
  const uiStage = useMemo(() => {
    const draft = draftQuery.data;
    if (!draft) return null;

    const stats = statsQuery.data;
    const hasUnverifiedClaims = stats?.fieldsNeedingVerification?.length > 0;
    const hasOpenConflicts = conflictsQuery.data?.conflicts?.some(c => c.status === 'OPEN');

    return {
      canGenerateOM: !hasUnverifiedClaims && !hasOpenConflicts && draft.status === 'DRAFT_INGESTED',
      canDistribute: draft.status === 'OM_APPROVED_FOR_MARKETING',
      needsVerification: hasUnverifiedClaims,
      needsConflictResolution: hasOpenConflicts,
    };
  }, [draftQuery.data, statsQuery.data, conflictsQuery.data]);

  return {
    draft: draftQuery.data,
    claims: claimsQuery.data?.claims || [],
    conflicts: conflictsQuery.data?.conflicts || [],
    stats: statsQuery.data,
    uiStage,
    isLoading: draftQuery.isLoading,
    verifyClaimMutation,
    resolveConflictMutation,
  };
}
```

### File: `src/lib/hooks/useIntakeAccessRequests.js`
```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';

export function useIntakeAccessRequests(dealDraftId) {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ['reviewQueue', dealDraftId],
    queryFn: () => bff.gate.getReviewQueue(dealDraftId, {}),
    enabled: !!dealDraftId,
  });

  const progressQuery = useQuery({
    queryKey: ['dealProgress', dealDraftId],
    queryFn: () => bff.gate.getProgress(dealDraftId),
    enabled: !!dealDraftId,
  });

  const authorizeMutation = useMutation({
    mutationFn: ({ buyerUserId, data }) => bff.gate.authorize(dealDraftId, buyerUserId, data),
    onSuccess: () => {
      queryClient.invalidateQueries(['reviewQueue', dealDraftId]);
      queryClient.invalidateQueries(['dealProgress', dealDraftId]);
    },
  });

  const declineMutation = useMutation({
    mutationFn: ({ buyerUserId, reason }) => bff.gate.decline(dealDraftId, buyerUserId, reason),
    onSuccess: () => queryClient.invalidateQueries(['reviewQueue', dealDraftId]),
  });

  // Derive funnel stats for UI
  const funnelStats = useMemo(() => {
    const progress = progressQuery.data;
    if (!progress) return null;
    return {
      distributed: progress.counts?.distributed || 0,
      viewed: progress.counts?.viewed || 0,
      interested: progress.counts?.interested || 0,
      authorized: progress.counts?.authorized || 0,
      ndaSigned: progress.counts?.ndaSigned || 0,
      inDataRoom: progress.counts?.inDataRoom || 0,
    };
  }, [progressQuery.data]);

  return {
    queue: queueQuery.data || [],
    progress: progressQuery.data,
    funnelStats,
    isLoading: queueQuery.isLoading,
    authorizeMutation,
    declineMutation,
  };
}
```

### File: `src/lib/hooks/useBuyerInbox.js`
```javascript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';

export function useBuyerInbox(filters = {}) {
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ['buyerInbox', filters],
    queryFn: () => bff.buyer.getInbox(filters),
  });

  const criteriaQuery = useQuery({
    queryKey: ['buyerCriteria'],
    queryFn: () => bff.buyer.getCriteria(),
  });

  const scoreAllMutation = useMutation({
    mutationFn: () => bff.buyer.scoreAllDeals(),
    onSuccess: () => queryClient.invalidateQueries(['buyerInbox']),
  });

  return {
    inbox: inboxQuery.data || [],
    criteria: criteriaQuery.data,
    isLoading: inboxQuery.isLoading,
    scoreAllMutation,
  };
}
```

### File: `src/lib/contracts/intake.js` (Zod Schemas)
```javascript
import { z } from 'zod';

// Deal Draft statuses (backend-persisted)
export const DealDraftStatus = z.enum([
  'DRAFT_INGESTED',
  'OM_DRAFTED',
  'OM_BROKER_APPROVED',
  'OM_APPROVED_FOR_MARKETING',
  'DISTRIBUTED',
  'ACTIVE_DD',
]);

// Claim verification action
export const ClaimVerifyAction = z.enum(['confirm', 'reject']);

export const ClaimVerifyRequest = z.object({
  action: ClaimVerifyAction,
  correctedValue: z.string().optional(),
  rejectionReason: z.string().optional(),
});

// Conflict resolution methods
export const ConflictResolutionMethod = z.enum([
  'CHOSE_CLAIM_A',
  'CHOSE_CLAIM_B',
  'MANUAL_OVERRIDE',
  'AVERAGED',
]);

export const ConflictResolveRequest = z.object({
  method: ConflictResolutionMethod,
  resolvedValue: z.union([z.string(), z.number()]).optional(),
});

// Document metadata (NOT file upload - uses storageKey)
export const DocumentMetadata = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number(),
  storageKey: z.string(), // Reference to pre-uploaded file
  classifiedType: z.enum(['OM', 'RENT_ROLL', 'T12', 'LOI', 'APPRAISAL', 'OTHER']).optional(),
});

// Buyer response types
export const BuyerResponseType = z.enum(['INTERESTED', 'PASS', 'INTERESTED_WITH_CONDITIONS']);

export const BuyerResponseRequest = z.object({
  response: BuyerResponseType,
  questionsForBroker: z.array(z.string()).optional(),
  conditions: z.array(z.string()).optional(),
  indicativePriceMin: z.number().optional(),
  indicativePriceMax: z.number().optional(),
  intendedStructure: z.string().optional(),
  timelineNotes: z.string().optional(),
  passReason: z.enum(['PRICE', 'ASSET_TYPE', 'GEOGRAPHY', 'TIMING', 'OTHER']).optional(),
  passNotes: z.string().optional(),
  isConfidential: z.boolean().optional()
});

// Authorization statuses
export const AuthorizationStatus = z.enum(['PENDING', 'AUTHORIZED', 'DECLINED', 'REVOKED']);

// NDA statuses
export const NDAStatus = z.enum(['NOT_SENT', 'SENT', 'SIGNED', 'EXPIRED']);

// Data room access levels
export const AccessLevel = z.enum(['STANDARD', 'FULL', 'CUSTOM']);
```

---

## Phase A: Foundation Components

### 1. StatusBadge Component
**File**: `src/components/intake/StatusBadge.jsx`

```jsx
import { Badge } from '@/components/ui/badge';
import { Clock, FileText, CheckCircle, Send, Users, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_CONFIG = {
  DRAFT_INGESTED: { label: 'Draft', color: 'bg-slate-100 text-slate-700', icon: Clock },
  OM_DRAFTED: { label: 'OM Drafted', color: 'bg-blue-100 text-blue-700', icon: FileText },
  OM_BROKER_APPROVED: { label: 'Broker Approved', color: 'bg-amber-100 text-amber-700', icon: CheckCircle },
  OM_APPROVED_FOR_MARKETING: { label: 'Ready to Distribute', color: 'bg-green-100 text-green-700', icon: Send },
  DISTRIBUTED: { label: 'Distributed', color: 'bg-purple-100 text-purple-700', icon: Users },
  ACTIVE_DD: { label: 'Active DD', color: 'bg-emerald-100 text-emerald-700', icon: Shield },
};

export function StatusBadge({ status, showIcon = true, className }) {
  const config = STATUS_CONFIG[status] || { label: status, color: 'bg-gray-100 text-gray-700' };
  const Icon = config.icon;

  return (
    <Badge className={cn(config.color, 'font-medium', className)}>
      {showIcon && Icon && <Icon className="w-3 h-3 mr-1" />}
      {config.label}
    </Badge>
  );
}
```

### 2. DealDraftCard Component
**File**: `src/components/intake/DealDraftCard.jsx`

```jsx
import { Card, CardContent } from '@/components/ui/card';
import { Building2, Clock } from 'lucide-react';
import { StatusBadge } from './StatusBadge';
import { formatDistanceToNow } from 'date-fns';
import { createPageUrl } from '@/utils';
import { useNavigate } from 'react-router-dom';

export function DealDraftCard({ draft }) {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(createPageUrl(`DealDraftDetail?id=${draft.id}`));
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={handleClick}
    >
      <CardContent className="pt-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gray-400" />
            <h3 className="font-medium text-gray-900 truncate">
              {draft.propertyName || draft.propertyAddress || 'Untitled Deal'}
            </h3>
          </div>
          <StatusBadge status={draft.status} />
        </div>

        {draft.propertyAddress && (
          <p className="text-sm text-gray-500 mb-3 truncate">{draft.propertyAddress}</p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true })}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### 3. DocumentUploader Component
**File**: `src/components/intake/DocumentUploader.jsx`

**Note**: This component collects file metadata. Actual file upload to storage is handled separately. The `/api/intake/draft/:id/documents` endpoint expects JSON with `storageKey`, not multipart file data.

```jsx
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, X, FileText, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const DOCUMENT_TYPES = [
  { value: 'OM', label: 'Offering Memorandum' },
  { value: 'RENT_ROLL', label: 'Rent Roll' },
  { value: 'T12', label: 'T12 / Operating Statement' },
  { value: 'LOI', label: 'Letter of Intent' },
  { value: 'APPRAISAL', label: 'Appraisal' },
  { value: 'OTHER', label: 'Other' },
];

export function DocumentUploader({ onDocumentsReady, isUploading }) {
  const [files, setFiles] = useState([]);

  const onDrop = useCallback((acceptedFiles) => {
    const newFiles = acceptedFiles.map(file => ({
      file,
      id: crypto.randomUUID(),
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      classifiedType: null, // User can set or auto-classify
      storageKey: null, // Will be set after upload to storage
    }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'image/*': ['.png', '.jpg', '.jpeg'],
    },
  });

  const removeFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  const setFileType = (id, type) => {
    setFiles(prev => prev.map(f => f.id === id ? { ...f, classifiedType: type } : f));
  };

  const handleUpload = () => {
    // In production: upload files to storage first, get storageKeys, then call onDocumentsReady
    // For now: pass file metadata for mock/stub handling
    onDocumentsReady(files.map(f => ({
      filename: f.filename,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      classifiedType: f.classifiedType,
      // storageKey would come from storage upload response
    })));
  };

  return (
    <div className="space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
          isDragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
        )}
      >
        <input {...getInputProps()} />
        <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
        <p className="text-sm text-gray-600">
          {isDragActive ? 'Drop files here...' : 'Drag & drop files, or click to select'}
        </p>
        <p className="text-xs text-gray-400 mt-1">PDF, Excel, Images supported</p>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map(file => (
            <Card key={file.id} className="p-3">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.filename}</p>
                  <p className="text-xs text-gray-400">{(file.sizeBytes / 1024).toFixed(1)} KB</p>
                </div>
                <Select value={file.classifiedType || ''} onValueChange={(v) => setFileType(file.id, v)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Document type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() => removeFile(file.id)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}

          <Button onClick={handleUpload} disabled={isUploading} className="w-full">
            {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {isUploading ? 'Uploading...' : `Upload ${files.length} file(s)`}
          </Button>
        </div>
      )}
    </div>
  );
}
```

### 4. ClaimVerificationCard Component
**File**: `src/components/intake/ClaimVerificationCard.jsx`

```jsx
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Edit2, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

const CONFIDENCE_COLORS = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-red-100 text-red-700',
};

export function ClaimVerificationCard({ claim, onVerify, isVerifying }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [correctedValue, setCorrectedValue] = useState('');

  const confidenceValue = claim.extraction?.confidence ?? 0;
  const confidenceLevel = confidenceValue >= 0.8 ? 'high' : confidenceValue >= 0.5 ? 'medium' : 'low';

  const handleConfirm = () => {
    onVerify({ action: 'confirm' });
  };

  const handleReject = () => {
    onVerify({ action: 'reject', rejectionReason: 'Incorrect value' });
  };

  const handleCorrect = () => {
    onVerify({ action: 'confirm', correctedValue });
    setIsEditing(false);
    setCorrectedValue('');
  };

  return (
    <Card className={cn(
      'transition-all',
      claim.verification?.status === 'BROKER_CONFIRMED' && 'border-green-200 bg-green-50/30',
      claim.verification?.status === 'REJECTED' && 'border-red-200 bg-red-50/30'
    )}>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-500">{claim.fieldLabel || claim.field}</span>
              <Badge className={CONFIDENCE_COLORS[confidenceLevel]}>
                {Math.round(confidenceValue * 100)}%
              </Badge>
              {claim.verification?.status === 'BROKER_CONFIRMED' && (
                <Badge className="bg-green-100 text-green-700">Verified</Badge>
              )}
            </div>

            {isEditing ? (
              <div className="flex gap-2 mt-2">
                <Input
                  value={correctedValue}
                  onChange={(e) => setCorrectedValue(e.target.value)}
                  placeholder={`Current: ${claim.displayValue || claim.value}`}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleCorrect} disabled={!correctedValue}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <p className="text-lg font-semibold text-gray-900">
                {claim.displayValue || claim.value}
              </p>
            )}
          </div>

          {claim.verification?.status === 'UNVERIFIED' && !isEditing && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} title="Edit">
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={handleConfirm} disabled={isVerifying} title="Confirm">
                <CheckCircle className="w-4 h-4 text-green-600" />
              </Button>
              <Button size="sm" variant="ghost" onClick={handleReject} disabled={isVerifying} title="Reject">
                <XCircle className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          )}
        </div>

        {/* Source info toggle */}
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-gray-400 mt-3 hover:text-gray-600"
        >
          <FileText className="w-3 h-3" />
          <span>Source: {claim.source?.documentName || 'Unknown'}</span>
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {isExpanded && claim.source && (
          <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
            <p><strong>Document:</strong> {claim.source.documentName}</p>
            <p><strong>Location:</strong> {claim.source.location || 'N/A'}</p>
            <p><strong>Method:</strong> {claim.extraction?.method}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### 5. ConflictResolutionCard Component
**File**: `src/components/intake/ConflictResolutionCard.jsx`

```jsx
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { AlertTriangle, FileText } from 'lucide-react';

export function ConflictResolutionCard({ conflict, onResolve, isResolving }) {
  const [method, setMethod] = useState(null);
  const [manualValue, setManualValue] = useState('');
  const claims = Array.isArray(conflict.claims)
    ? conflict.claims
    : [conflict.claims?.a, conflict.claims?.b].filter(Boolean);

  const handleResolve = () => {
    const data = { method };
    if (method === 'MANUAL_OVERRIDE') {
      data.resolvedValue = manualValue;
    }
    onResolve(data);
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          Conflict: {conflict.fieldLabel || conflict.field}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {claims.map((claim, idx) => (
            <div key={claim.id} className="p-3 bg-white rounded border">
              <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                <FileText className="w-3 h-3" />
                {claim.source?.documentName || `Source ${idx + 1}`}
              </div>
              <p className="text-lg font-semibold">{claim.displayValue || claim.value}</p>
              <p className="text-xs text-gray-400">Confidence: {Math.round((claim.extraction?.confidence ?? 0) * 100)}%</p>
            </div>
          ))}
        </div>

        <RadioGroup value={method} onValueChange={setMethod} className="space-y-2">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="CHOSE_CLAIM_A" id="claimA" />
            <Label htmlFor="claimA">Use first source value</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="CHOSE_CLAIM_B" id="claimB" />
            <Label htmlFor="claimB">Use second source value</Label>
          </div>
          {conflict.field.includes('price') || conflict.field.includes('rent') || conflict.field.includes('noi') ? (
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="AVERAGED" id="avg" />
              <Label htmlFor="avg">Use average</Label>
            </div>
          ) : null}
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="MANUAL_OVERRIDE" id="manual" />
            <Label htmlFor="manual">Enter manually</Label>
          </div>
        </RadioGroup>

        {method === 'MANUAL_OVERRIDE' && (
          <Input
            className="mt-2"
            placeholder="Enter correct value"
            value={manualValue}
            onChange={(e) => setManualValue(e.target.value)}
          />
        )}

        <Button
          className="w-full mt-4"
          onClick={handleResolve}
          disabled={!method || (method === 'MANUAL_OVERRIDE' && !manualValue) || isResolving}
        >
          Resolve Conflict
        </Button>
      </CardContent>
    </Card>
  );
}
```

### 6. OMSectionEditor Component
**File**: `src/components/om/OMSectionEditor.jsx`

**Note**: Starting with structured textarea editor. Can upgrade to TipTap/Slate later.

```jsx
import { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Save, RotateCcw, Loader2 } from 'lucide-react';

export function OMSectionEditor({
  section,
  content,
  onSave,
  isSaving,
  isEditable = true,
  showAutoSave = true
}) {
  const [localContent, setLocalContent] = useState(content || '');
  const [hasChanges, setHasChanges] = useState(false);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    setLocalContent(content || '');
    setHasChanges(false);
  }, [content]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const scheduleSave = (value) => {
    if (!showAutoSave || !isEditable) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      onSave(value);
    }, 2000);
  };

  const handleChange = (e) => {
    const value = e.target.value;
    setLocalContent(value);
    setHasChanges(value !== content);
    scheduleSave(value);
  };

  const handleManualSave = () => {
    onSave(localContent);
    setHasChanges(false);
  };

  const handleRevert = () => {
    setLocalContent(content || '');
    setHasChanges(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{section.title}</CardTitle>
          <div className="flex items-center gap-2">
            {section.required && <Badge variant="outline">Required</Badge>}
            {hasChanges && <Badge className="bg-amber-100 text-amber-700">Unsaved</Badge>}
            {isSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          value={localContent}
          onChange={handleChange}
          disabled={!isEditable}
          rows={8}
          className="font-mono text-sm"
          placeholder={`Enter ${section.title.toLowerCase()} content...`}
        />

        {isEditable && (
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" onClick={handleRevert} disabled={!hasChanges}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Revert
            </Button>
            <Button size="sm" onClick={handleManualSave} disabled={!hasChanges || isSaving}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### 7. BuyerResponseCard Component
**File**: `src/components/distribution/BuyerResponseCard.jsx`

```jsx
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, CheckCircle, XCircle, Clock, MessageSquare, Shield } from 'lucide-react';
import { AIScoreBadge } from './AIScoreBadge';
import { formatDistanceToNow } from 'date-fns';

const RESPONSE_CONFIG = {
  INTERESTED: { label: 'Interested', color: 'bg-green-100 text-green-700', icon: CheckCircle },
  PASS: { label: 'Passed', color: 'bg-gray-100 text-gray-700', icon: XCircle },
  INTERESTED_WITH_CONDITIONS: { label: 'Interested w/ Conditions', color: 'bg-amber-100 text-amber-700', icon: Clock },
};

export function BuyerResponseCard({
  response,
  authorization,
  buyer,
  aiScore,
  onAuthorize,
  onDecline,
  onSendNDA,
  isAnonymous = false,
}) {
  const config = RESPONSE_CONFIG[response.response] || RESPONSE_CONFIG.INTERESTED;
  const Icon = config.icon;

  const showActions = response.response !== 'PASS' && (!authorization || authorization.status === 'PENDING');

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-400" />
              <span className="font-medium">
                {isAnonymous ? (buyer?.anonymousLabel || 'Anonymous Buyer') : (buyer?.firmName || buyer?.name || 'Unknown Buyer')}
              </span>
            </div>
            {!isAnonymous && buyer?.email && (
              <p className="text-sm text-gray-500 ml-6">{buyer.email}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {aiScore !== undefined && <AIScoreBadge score={aiScore} />}
            <Badge className={config.color}>
              <Icon className="w-3 h-3 mr-1" />
              {config.label}
            </Badge>
          </div>
        </div>

        {response.questionsForBroker?.length > 0 && (
          <div className="mb-3 p-2 bg-blue-50 rounded">
            <div className="flex items-center gap-1 text-xs text-blue-600 mb-1">
              <MessageSquare className="w-3 h-3" />
              Questions for broker
            </div>
            <ul className="text-sm text-gray-700 list-disc list-inside">
              {response.questionsForBroker.map((q, i) => <li key={i}>{q}</li>)}
            </ul>
          </div>
        )}

        {response.conditions?.length > 0 && (
          <div className="mb-3 p-2 bg-amber-50 rounded">
            <div className="text-xs text-amber-600 mb-1">Conditions</div>
            <ul className="text-sm text-gray-700 list-disc list-inside">
              {response.conditions.map((c, i) => <li key={i}>{c}</li>)}
            </ul>
          </div>
        )}

        {response.indicativePriceMin && response.indicativePriceMax && (
          <p className="text-sm text-gray-600 mb-3">
            <strong>Indicative range:</strong> ${response.indicativePriceMin.toLocaleString()} - ${response.indicativePriceMax.toLocaleString()}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(response.respondedAt), { addSuffix: true })}
          </span>

          {authorization?.status === 'AUTHORIZED' ? (
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-700">
                <Shield className="w-3 h-3 mr-1" />
                Authorized
              </Badge>
              {authorization.ndaStatus === 'NOT_SENT' && (
                <Button size="sm" variant="outline" onClick={onSendNDA}>Send NDA</Button>
              )}
              {authorization.ndaStatus === 'SENT' && (
                <Badge className="bg-blue-100 text-blue-700">NDA Sent</Badge>
              )}
              {authorization.ndaStatus === 'SIGNED' && (
                <Badge className="bg-emerald-100 text-emerald-700">NDA Signed</Badge>
              )}
            </div>
          ) : showActions ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={onDecline}>Decline</Button>
              <Button size="sm" onClick={onAuthorize}>Authorize</Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
```

### 8. AIScoreBadge Component
**File**: `src/components/distribution/AIScoreBadge.jsx`

```jsx
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AIScoreBadge({ score, breakdown, className }) {
  const getColorClass = (score) => {
    if (score >= 80) return 'bg-green-100 text-green-700 border-green-200';
    if (score >= 60) return 'bg-amber-100 text-amber-700 border-amber-200';
    return 'bg-red-100 text-red-700 border-red-200';
  };

  const badge = (
    <Badge className={cn('border', getColorClass(score), className)}>
      <Brain className="w-3 h-3 mr-1" />
      {score}
    </Badge>
  );

  if (!breakdown) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium mb-1">AI Triage Score</p>
          <ul className="text-xs space-y-1">
            {breakdown.map((item, i) => (
              <li key={i} className="flex justify-between gap-4">
                <span>{item.criterion}</span>
                <span className="font-mono">{item.score}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
```

---

## Phase B: Broker Intake Pages

### 1. DealDrafts List Page
**File**: `src/pages/intake/DealDrafts.jsx`
**Route**: Add to `pages.config.js` as `DealDrafts`

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, FolderOpen } from 'lucide-react';
import { DealDraftCard } from '@/components/intake/DealDraftCard';
import { useIntakeDashboard } from '@/lib/hooks/useIntakeDashboard';
import { createPageUrl } from '@/utils';
import { Skeleton } from '@/components/ui/skeleton';

export default function DealDrafts() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const { drafts, isLoading, derivedStats } = useIntakeDashboard(
    statusFilter !== 'all' ? { status: statusFilter } : {}
  );

  const filteredDrafts = drafts.filter(d =>
    !searchQuery ||
    d.propertyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    d.propertyAddress?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3,4,5,6].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Deal Intake</h1>
        <Button onClick={() => navigate(createPageUrl('CreateDealDraft'))}>
          <Plus className="w-4 h-4 mr-2" />
          New Deal Draft
        </Button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search deals..."
            className="pl-9"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({derivedStats.total})</TabsTrigger>
            <TabsTrigger value="DRAFT_INGESTED">Drafts ({derivedStats.inDraft})</TabsTrigger>
            <TabsTrigger value="OM_DRAFTED">OM Drafted ({derivedStats.omDrafted})</TabsTrigger>
            <TabsTrigger value="DISTRIBUTED">Distributed ({derivedStats.distributed})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filteredDrafts.length === 0 ? (
        <div className="py-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No deals found</h3>
          <p className="text-sm text-gray-500 mb-4">
            {searchQuery ? 'Try a different search term' : 'Create your first deal draft to get started'}
          </p>
          <Button onClick={() => navigate(createPageUrl('CreateDealDraft'))}>
            <Plus className="w-4 h-4 mr-2" />
            Create Deal Draft
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDrafts.map(draft => (
            <DealDraftCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}
```

### 2. CreateDealDraft Page
**File**: `src/pages/intake/CreateDealDraft.jsx`
**Route**: Add to `pages.config.js` as `CreateDealDraft`

*(Full implementation ~200 lines - step wizard with source selection, document upload, optional fields)*

### 3. DealDraftDetail Page
**File**: `src/pages/intake/DealDraftDetail.jsx`
**Route**: Add to `pages.config.js` as `DealDraftDetail`

*(Full implementation ~400 lines - tabbed interface with Overview, Documents, Claims, Conflicts, OM Preview)*

---

## Phase C-E: Additional Pages

*(Implementations follow same patterns - see component specs above)*

- `src/pages/om/OMEditor.jsx`
- `src/pages/distribution/DistributionManagement.jsx`
- `src/pages/distribution/BuyerReviewQueue.jsx`
- `src/pages/distribution/BuyerAuthorizationDetail.jsx`
- `src/pages/distribution/DealProgress.jsx`
- `src/pages/buyer/BuyerInbox.jsx`
- `src/pages/buyer/BuyerDealView.jsx`
- `src/pages/buyer/BuyerCriteria.jsx`
- `src/pages/buyer/BuyerResponses.jsx`

---

## API Client Extensions

**File**: `src/api/bffClient.js`

Add the following namespaces (see full method signatures in Phase 0 hooks):

```javascript
// Add to bff object:

dealIntake: {
  createDraft: (data) => requestJson('/intake/draft', { method: 'POST', body: JSON.stringify(data) }),
  listDrafts: (params) => requestJson(`/intake/drafts?${new URLSearchParams(params)}`),
  getDraft: (id) => requestJson(`/intake/draft/${id}`),
  uploadDocuments: (id, documents) => requestJson(`/intake/draft/${id}/documents`, { method: 'POST', body: JSON.stringify({ documents }) }),
  pasteText: (id, text, sourceName) => requestJson(`/intake/draft/${id}/paste`, { method: 'POST', body: JSON.stringify({ text, sourceName }) }),
  addBroker: (id, broker) => requestJson(`/intake/draft/${id}/brokers`, { method: 'POST', body: JSON.stringify(broker) }),
  setSeller: (id, seller) => requestJson(`/intake/draft/${id}/seller`, { method: 'POST', body: JSON.stringify(seller) }),
  getClaims: (id, params) => requestJson(`/intake/draft/${id}/claims?${new URLSearchParams(params)}`),
  verifyClaim: (draftId, claimId, data) => requestJson(`/intake/draft/${draftId}/claims/${claimId}/verify`, { method: 'POST', body: JSON.stringify(data) }),
  getConflicts: (id, status) => requestJson(`/intake/draft/${id}/conflicts?status=${status || ''}`),
  resolveConflict: (draftId, conflictId, data) => requestJson(`/intake/draft/${draftId}/conflicts/${conflictId}/resolve`, { method: 'POST', body: JSON.stringify(data) }),
  advanceStatus: (id, status) => requestJson(`/intake/draft/${id}/advance`, { method: 'POST', body: JSON.stringify({ status }) }),
  getStats: (id) => requestJson(`/intake/draft/${id}/stats`),
},

om: {
  generate: (dealDraftId, regenerate) => requestJson(`/om/draft/${dealDraftId}/generate`, { method: 'POST', body: JSON.stringify({ regenerate }) }),
  getLatest: (dealDraftId) => requestJson(`/om/draft/${dealDraftId}/latest`),
  listVersions: (dealDraftId) => requestJson(`/om/draft/${dealDraftId}/versions`),
  getVersion: (omVersionId) => requestJson(`/om/version/${omVersionId}`),
  updateSection: (omVersionId, sectionId, content) => requestJson(`/om/version/${omVersionId}/section/${sectionId}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  brokerApprove: (omVersionId) => requestJson(`/om/version/${omVersionId}/broker-approve`, { method: 'POST', body: JSON.stringify({}) }),
  sellerApprove: (omVersionId) => requestJson(`/om/version/${omVersionId}/seller-approve`, { method: 'POST', body: JSON.stringify({}) }),
  requestChanges: (omVersionId, feedback) => requestJson(`/om/version/${omVersionId}/request-changes`, { method: 'POST', body: JSON.stringify({ feedback }) }),
  getSections: () => requestJson('/om/sections'),
},

distribution: {
  create: (dealDraftId, data) => requestJson(`/distribution/create/${dealDraftId}`, { method: 'POST', body: JSON.stringify(data) }),
  addRecipients: (distributionId, recipientIds) => requestJson(`/distribution/${distributionId}/add-recipients`, { method: 'POST', body: JSON.stringify({ recipientIds }) }),
  get: (distributionId) => requestJson(`/distribution/${distributionId}`),
  getForDeal: (dealDraftId) => requestJson(`/distribution/deal/${dealDraftId}`),
  recordView: (recipientId, data) => requestJson(`/distribution/recipient/${recipientId}/view`, { method: 'POST', body: JSON.stringify(data) }),
  submitResponse: (dealDraftId, data) => requestJson(`/distribution/respond/${dealDraftId}`, { method: 'POST', body: JSON.stringify(data) }),
  getResponses: (dealDraftId) => requestJson(`/distribution/responses/${dealDraftId}`),
},

buyer: {
  getInbox: (params) => requestJson(`/buyer/inbox?${new URLSearchParams(params)}`),
  getDeal: (dealDraftId) => requestJson(`/buyer/deal/${dealDraftId}`),
  getCriteria: () => requestJson('/buyer/criteria'),
  updateCriteria: (criteria) => requestJson('/buyer/criteria', { method: 'PUT', body: JSON.stringify(criteria) }),
  deleteCriteria: () => requestJson('/buyer/criteria', { method: 'DELETE' }),
  scoreDeal: (dealDraftId) => requestJson(`/buyer/score/${dealDraftId}`, { method: 'POST', body: JSON.stringify({}) }),
  scoreAllDeals: () => requestJson('/buyer/score-all', { method: 'POST', body: JSON.stringify({}) }),
  getTriage: (dealDraftId) => requestJson(`/buyer/triage/${dealDraftId}`),
  submitResponse: (dealDraftId, data) => requestJson(`/buyer/respond/${dealDraftId}`, { method: 'POST', body: JSON.stringify(data) }),
  getResponses: () => requestJson('/buyer/responses'),
  getAnonymity: () => requestJson('/buyer/anonymity'),
  updateAnonymity: (settings) => requestJson('/buyer/anonymity', { method: 'PUT', body: JSON.stringify(settings) }),
},

gate: {
  getReviewQueue: (dealDraftId, params) => requestJson(`/gate/queue/${dealDraftId}?${new URLSearchParams(params)}`),
  authorize: (dealDraftId, buyerUserId, data) => requestJson(`/gate/authorize/${dealDraftId}/${buyerUserId}`, { method: 'POST', body: JSON.stringify(data || {}) }),
  decline: (dealDraftId, buyerUserId, reason) => requestJson(`/gate/decline/${dealDraftId}/${buyerUserId}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  revoke: (dealDraftId, buyerUserId, reason) => requestJson(`/gate/revoke/${dealDraftId}/${buyerUserId}`, { method: 'POST', body: JSON.stringify({ reason }) }),
  sendNDA: (dealDraftId, buyerUserId) => requestJson(`/gate/nda/send/${dealDraftId}/${buyerUserId}`, { method: 'POST', body: JSON.stringify({}) }),
  recordNDASigned: (dealDraftId, buyerUserId, ndaDocumentId) => requestJson(`/gate/nda/signed/${dealDraftId}/${buyerUserId}`, { method: 'POST', body: JSON.stringify({ ndaDocumentId }) }),
  grantAccess: (dealDraftId, buyerUserId, accessLevel) => requestJson(`/gate/access/${dealDraftId}/${buyerUserId}`, { method: 'POST', body: JSON.stringify({ accessLevel }) }),
  getStatus: (dealDraftId, buyerUserId) => requestJson(`/gate/status/${dealDraftId}/${buyerUserId}`),
  getAuthorizations: (dealDraftId, status) => requestJson(`/gate/authorizations/${dealDraftId}?status=${status || ''}`),
  getProgress: (dealDraftId) => requestJson(`/gate/progress/${dealDraftId}`),
  advanceToActiveDD: (dealDraftId) => requestJson(`/gate/advance/${dealDraftId}`, { method: 'POST', body: JSON.stringify({}) }),
},
```

---

## Navigation Updates

**File**: `src/Layout.jsx`

Add sectioned sidebar:

```jsx
// In navigation config:
const NAV_SECTIONS = [
  {
    title: 'SELLING',
    items: [
      { name: 'Deal Intake', icon: FileInput, path: 'DealDrafts' },
      { name: 'My Deals', icon: Building2, path: 'Deals' }, // Existing kernel deals
    ],
  },
  {
    title: 'BUYING',
    items: [
      { name: 'Deal Inbox', icon: Inbox, path: 'BuyerInbox' },
      { name: 'My Criteria', icon: Settings, path: 'BuyerCriteria' },
      { name: 'My Responses', icon: MessageSquare, path: 'BuyerResponses' },
    ],
  },
  // ... existing Portfolio section
];
```

**File**: `src/pages.config.js`

```javascript
// Add new pages:
import DealDrafts from './pages/intake/DealDrafts';
import CreateDealDraft from './pages/intake/CreateDealDraft';
import DealDraftDetail from './pages/intake/DealDraftDetail';
import OMEditor from './pages/om/OMEditor';
import DistributionManagement from './pages/distribution/DistributionManagement';
import BuyerReviewQueue from './pages/distribution/BuyerReviewQueue';
import BuyerAuthorizationDetail from './pages/distribution/BuyerAuthorizationDetail';
import DealProgress from './pages/distribution/DealProgress';
import BuyerInbox from './pages/buyer/BuyerInbox';
import BuyerDealView from './pages/buyer/BuyerDealView';
import BuyerCriteria from './pages/buyer/BuyerCriteria';
import BuyerResponses from './pages/buyer/BuyerResponses';

export const PAGES = {
  // ... existing pages
  DealDrafts,
  CreateDealDraft,
  DealDraftDetail,
  OMEditor,
  DistributionManagement,
  BuyerReviewQueue,
  BuyerAuthorizationDetail,
  DealProgress,
  BuyerInbox,
  BuyerDealView,
  BuyerCriteria,
  BuyerResponses,
};
```

---

## Implementation Order

| Phase | Focus | Deliverables |
|-------|-------|--------------|
| 0 | Foundation | Hooks layer, Zod contracts, API client extensions |
| A | Components | 8 shared components (StatusBadge, DealDraftCard, etc.) |
| B | Intake Pages | DealDrafts, CreateDealDraft, DealDraftDetail |
| C | OM | OMEditor with approval workflow |
| D | Distribution | DistributionManagement, BuyerReviewQueue, BuyerAuthorizationDetail |
| E | Buyer | BuyerInbox, BuyerDealView, BuyerCriteria, BuyerResponses |
| F | Polish | Navigation, empty states, loading skeletons, integration testing |

---

## Verification Plan

```bash
# After each phase:
npm run dev              # Start dev server
npm run lint             # Check for errors

# Manual testing checklist:
# - Navigate to new pages via sidebar
# - Test API integration (check Network tab)
# - Verify React Query caching behavior
# - Check responsive design
# - Test loading and error states
```

---

# Questions & Answers

## 1. Routing: Keep `createPageUrl('DealOverview?id=...')` or move to nested routes like `/intake/deals/:id`?

**Answer**: Keep current `createPageUrl` pattern. This maintains consistency with the existing codebase and avoids refactoring App.jsx routing. All new pages will use query params: `DealDraftDetail?id=xxx`, `OMEditor?dealDraftId=xxx`, etc.

---

## 2. Deal creation: Should CreateDealDraft coexist with existing CreateDeal (kernel deal) or replace it in nav?

**Answer**: **Coexist**. They serve different purposes:
- `CreateDeal` = Kernel deals (existing portfolio management, LP-facing)
- `CreateDealDraft` = Intake deals (broker pre-marketing workflow)

Navigation will show both under different sections:
- SELLING > Deal Intake > leads to CreateDealDraft
- PORTFOLIO > Deals > leads to CreateDeal (existing)

Eventually we may want intake deals to "graduate" to kernel deals, but that's a future integration.

---

## 3. File uploads: Should DocumentUploader be a UX stub that collects files and calls a mock upload, or do you have a storage service we should wire for storageKey?

**Answer**: **Start as UX stub** with mock upload. The component collects files, shows them in a list, but the actual upload flow will be:

1. User selects files in DocumentUploader
2. On submit, frontend uploads to storage service (TBD - could be S3, Cloudflare R2, etc.)
3. Storage returns `storageKey` for each file
4. Frontend calls `/api/intake/draft/:id/documents` with JSON containing `storageKey`

For Phase B, implement the UI with a mock that generates fake storageKeys. Add `TODO: Wire to storage service` comment. This unblocks UI development while storage integration is decided.

---

## 4. OM editor: Any preferred rich-text editor (TipTap, Slate, Quill), or should we start with a structured Markdown/textarea editor?

**Answer**: **Start with structured textarea**. The OM sections are largely text content that doesn't need complex formatting. Using a simple textarea with optional Markdown support keeps the implementation simple and fast.

Future enhancement: If brokers request rich formatting (bold, tables, images), consider TipTap as it's React-native and has a clean API. But for MVP, textarea is sufficient.

---

## 5. Buyer "Hold" and "Request More Info": Backend doesn't expose these actions. Should we omit them or add a lightweight "hold" status client-side?

**Answer**: **Omit for now**. The backend only supports AUTHORIZE, DECLINE, REVOKE. Adding client-side "hold" would create confusion between UI state and persisted state.

The workflow is:
- Buyer appears in queue with PENDING status
- Broker either AUTHORIZES or DECLINES
- No explicit "hold" - items simply remain in PENDING until actioned

If needed later, we can add a backend endpoint for `HOLD` status. Don't implement UI-only statuses.

---

## 6. Buyer search: There's no public search endpoint. Should we skip "Search deals" for now and stick to inbox/auto-matched only?

**Answer**: **Skip search for now**. The buyer workflow is:
1. Buyer sets criteria
2. Platform auto-matches PUBLIC deals and pushes to inbox
3. Broker can manually add buyer to PRIVATE deals

There's no browsing/searching. Buyers only see deals they've been distributed to (either auto-matched or manually added). This maintains broker control over distribution.

If we add search later, it would require:
- New backend endpoint
- Privacy controls (anonymous buyers shouldn't be searchable)
- Deal visibility rules

Not in scope for MVP.

---

## 7. Access/identity: When seller is configured to hide buyer identity, is it acceptable to always show masked buyer fields in UI (even for brokers) or only for sellers?

**Answer**: **Brokers always see full identity. Only sellers see masked.**

The privacy setting (`isAnonymous`) affects what **sellers** see, not brokers:
- Broker created the distribution, they know who they sent it to
- Seller may have configured `sellerSeesIdentity: false`
- Anonymous buyers paid for anonymity from sellers, not brokers

UI logic in BuyerResponseCard:
```javascript
// In BuyerReviewQueue (broker view)
const isAnonymous = false; // Broker always sees identity

// In SellerReviewQueue (if we build seller view)
const isAnonymous = !deal.approvalSettings.sellerSeesIdentity && buyer.isAnonymous;
```

For MVP, we're building broker views. Always show full identity. Seller views (if needed) will mask based on settings.

---

## 8. NDA flow: Do you want UI only for status tracking (SENT/SIGNED) or should we integrate an e-sign step now?

**Answer**: **Status tracking only for MVP**.

The UI will show:
- "Send NDA" button (calls `gate.sendNDA`)
- Badge showing NDA status: NOT_SENT → SENT → SIGNED
- Manual "Mark as Signed" option (calls `gate.recordNDASigned`)

Actual e-sign integration (DocuSign, HelloSign, etc.) is out of scope. The backend supports the status transitions; the actual signing happens outside the system and is recorded manually.

Future enhancement: Add webhook from e-sign provider to auto-update status when buyer signs.
