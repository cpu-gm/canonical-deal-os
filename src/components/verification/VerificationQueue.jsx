import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import {
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Filter,
  ArrowUpDown,
  Sparkles,
  Check
} from 'lucide-react';
import ClaimCard from './ClaimCard';

const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.9,
  MEDIUM: 0.7
};

export default function VerificationQueue({ dealId }) {
  const queryClient = useQueryClient();
  const [selectedClaims, setSelectedClaims] = useState(new Set());
  const [sortBy, setSortBy] = useState('confidence');
  const [sortOrder, setSortOrder] = useState('asc');
  const [filterDocType, setFilterDocType] = useState(null);
  const [bulkRejectReason, setBulkRejectReason] = useState('');
  const [showBulkRejectDialog, setShowBulkRejectDialog] = useState(false);

  // Fetch pending claims
  const { data: pendingData, isLoading: loadingPending } = useQuery({
    queryKey: ['claims', dealId, 'pending', sortBy, sortOrder, filterDocType],
    queryFn: () => bff.verificationQueue.getPendingClaims(dealId, {
      sortBy,
      order: sortOrder,
      documentType: filterDocType
    })
  });

  // Fetch verification stats
  const { data: statsData } = useQuery({
    queryKey: ['claims', dealId, 'stats'],
    queryFn: () => bff.verificationQueue.getStats(dealId)
  });

  // Bulk verify mutation
  const bulkVerifyMutation = useMutation({
    mutationFn: ({ claimIds, minConfidence }) =>
      bff.verificationQueue.bulkVerify(dealId, { claimIds, minConfidence }),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['claims', dealId]);
      toast({
        title: 'Claims Verified',
        description: `Successfully verified ${data.results.verified.length} claims.`
      });
      setSelectedClaims(new Set());
    },
    onError: (error) => {
      toast({
        title: 'Verification Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Bulk reject mutation
  const bulkRejectMutation = useMutation({
    mutationFn: ({ claimIds, reason }) =>
      bff.verificationQueue.bulkReject(dealId, { claimIds, reason }),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['claims', dealId]);
      toast({
        title: 'Claims Rejected',
        description: `Rejected ${data.results.rejected.length} claims.`
      });
      setSelectedClaims(new Set());
      setShowBulkRejectDialog(false);
      setBulkRejectReason('');
    },
    onError: (error) => {
      toast({
        title: 'Rejection Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const pendingClaims = pendingData?.claims || [];
  const claimsByDocument = pendingData?.byDocument || [];
  const stats = statsData?.stats || {
    total: 0,
    pending: 0,
    verified: 0,
    rejected: 0,
    pendingByConfidence: { high: 0, medium: 0, low: 0 }
  };

  const handleSelectAll = () => {
    if (selectedClaims.size === pendingClaims.length) {
      setSelectedClaims(new Set());
    } else {
      setSelectedClaims(new Set(pendingClaims.map(c => c.id)));
    }
  };

  const handleSelectClaim = (claimId) => {
    const newSelected = new Set(selectedClaims);
    if (newSelected.has(claimId)) {
      newSelected.delete(claimId);
    } else {
      newSelected.add(claimId);
    }
    setSelectedClaims(newSelected);
  };

  const handleBulkVerifySelected = () => {
    bulkVerifyMutation.mutate({ claimIds: Array.from(selectedClaims) });
  };

  const handleBulkVerifyHighConfidence = () => {
    bulkVerifyMutation.mutate({ minConfidence: CONFIDENCE_THRESHOLDS.HIGH });
  };

  const handleBulkRejectSelected = () => {
    if (!bulkRejectReason.trim()) {
      toast({
        title: 'Reason Required',
        description: 'Please provide a reason for rejection.',
        variant: 'destructive'
      });
      return;
    }
    bulkRejectMutation.mutate({
      claimIds: Array.from(selectedClaims),
      reason: bulkRejectReason
    });
  };

  const handleClaimAction = () => {
    queryClient.invalidateQueries(['claims', dealId]);
  };

  if (loadingPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  const verificationProgress = stats.total > 0
    ? ((stats.verified + stats.rejected) / stats.total) * 100
    : 0;

  return (
    <div className="space-y-6">
      {/* Stats Overview */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#737373]">Pending</p>
                <p className="text-2xl font-bold text-[#171717]">{stats.pending}</p>
              </div>
              <Clock className="w-8 h-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#737373]">Verified</p>
                <p className="text-2xl font-bold text-green-600">{stats.verified}</p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-green-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#737373]">Rejected</p>
                <p className="text-2xl font-bold text-red-600">{stats.rejected}</p>
              </div>
              <XCircle className="w-8 h-8 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#737373]">Total</p>
                <p className="text-2xl font-bold text-[#171717]">{stats.total}</p>
              </div>
              <FileText className="w-8 h-8 text-[#737373]" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Progress Bar */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-[#171717]">Verification Progress</span>
            <span className="text-sm text-[#737373]">
              {Math.round(verificationProgress)}% complete
            </span>
          </div>
          <Progress value={verificationProgress} className="h-2" />
          <div className="flex items-center justify-between mt-2 text-xs text-[#737373]">
            <span>{stats.verified + stats.rejected} of {stats.total} claims processed</span>
            <span>
              {stats.pendingByConfidence.high} high confidence ready for bulk approval
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      {stats.pending > 0 && (
        <Card className="bg-gradient-to-r from-violet-50 to-purple-50 border-violet-200">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-violet-100 rounded-lg">
                  <Sparkles className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <h3 className="font-medium text-[#171717]">Quick Verification</h3>
                  <p className="text-sm text-[#737373]">
                    {stats.pendingByConfidence.high} claims have 90%+ confidence and can be auto-verified
                  </p>
                </div>
              </div>
              <Button
                onClick={handleBulkVerifyHighConfidence}
                disabled={stats.pendingByConfidence.high === 0 || bulkVerifyMutation.isPending}
                className="bg-violet-600 hover:bg-violet-700"
              >
                <Check className="w-4 h-4 mr-2" />
                Verify High Confidence ({stats.pendingByConfidence.high})
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bulk Actions Toolbar */}
      {selectedClaims.size > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-700">
                {selectedClaims.size} claim{selectedClaims.size > 1 ? 's' : ''} selected
              </span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedClaims(new Set())}
                >
                  Clear Selection
                </Button>
                <Button
                  size="sm"
                  onClick={handleBulkVerifySelected}
                  disabled={bulkVerifyMutation.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Verify Selected
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setShowBulkRejectDialog(true)}
                  disabled={bulkRejectMutation.isPending}
                >
                  <XCircle className="w-4 h-4 mr-1" />
                  Reject Selected
                </Button>
              </div>
            </div>

            {/* Bulk Reject Dialog */}
            {showBulkRejectDialog && (
              <div className="mt-4 p-4 bg-white rounded-lg border border-red-200">
                <h4 className="font-medium text-[#171717] mb-2">Rejection Reason</h4>
                <Textarea
                  value={bulkRejectReason}
                  onChange={(e) => setBulkRejectReason(e.target.value)}
                  placeholder="Why are these claims being rejected?"
                  className="mb-3"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setShowBulkRejectDialog(false);
                      setBulkRejectReason('');
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleBulkRejectSelected}
                    disabled={bulkRejectMutation.isPending || !bulkRejectReason.trim()}
                  >
                    Confirm Rejection
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Claims List */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Pending Claims</CardTitle>
            <div className="flex items-center gap-3">
              {/* Sort controls */}
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="text-xs"
                >
                  <ArrowUpDown className="w-3 h-3 mr-1" />
                  {sortBy === 'confidence' ? 'Confidence' : 'Date'}
                  {sortOrder === 'asc' ? ' ↑' : ' ↓'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortBy(sortBy === 'confidence' ? 'date' : 'confidence')}
                  className="text-xs"
                >
                  <Filter className="w-3 h-3 mr-1" />
                  Sort by {sortBy === 'confidence' ? 'Date' : 'Confidence'}
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {pendingClaims.length === 0 ? (
            <div className="py-12 text-center">
              <CheckCircle2 className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-[#171717] mb-2">All Caught Up!</h3>
              <p className="text-sm text-[#737373]">
                No pending claims to verify. All AI extractions have been reviewed.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Select All */}
              <div className="flex items-center gap-3 pb-2 border-b border-[#E5E5E5]">
                <Checkbox
                  checked={selectedClaims.size === pendingClaims.length && pendingClaims.length > 0}
                  onCheckedChange={handleSelectAll}
                />
                <span className="text-sm text-[#737373]">
                  Select all ({pendingClaims.length})
                </span>
              </div>

              {/* Group by document */}
              <Tabs defaultValue="all" className="w-full">
                <TabsList className="mb-4">
                  <TabsTrigger value="all">All ({pendingClaims.length})</TabsTrigger>
                  {claimsByDocument.map(doc => (
                    <TabsTrigger key={doc.documentName} value={doc.documentName}>
                      {doc.documentName} ({doc.claims.length})
                    </TabsTrigger>
                  ))}
                </TabsList>

                <TabsContent value="all">
                  <div className="space-y-3">
                    {pendingClaims.map(claim => (
                      <ClaimCard
                        key={claim.id}
                        claim={claim}
                        dealId={dealId}
                        isSelected={selectedClaims.has(claim.id)}
                        onSelect={() => handleSelectClaim(claim.id)}
                        onAction={handleClaimAction}
                      />
                    ))}
                  </div>
                </TabsContent>

                {claimsByDocument.map(doc => (
                  <TabsContent key={doc.documentName} value={doc.documentName}>
                    <div className="space-y-3">
                      {doc.claims.map(claim => (
                        <ClaimCard
                          key={claim.id}
                          claim={claim}
                          dealId={dealId}
                          isSelected={selectedClaims.has(claim.id)}
                          onSelect={() => handleSelectClaim(claim.id)}
                          onAction={handleClaimAction}
                        />
                      ))}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
