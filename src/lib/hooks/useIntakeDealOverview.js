import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";

export function useIntakeDealOverview(draftId) {
  const queryClient = useQueryClient();

  const draftQuery = useQuery({
    queryKey: ["intakeDraft", draftId],
    queryFn: () => bff.dealIntake.getDraft(draftId),
    enabled: !!draftId,
    onSuccess: (data) => {
      debugLog("intake", "Draft loaded", {
        draftId: data?.id,
        status: data?.status
      });
    },
    onError: (error) => {
      debugLog("intake", "Draft load failed", { draftId, message: error?.message });
    }
  });

  const claimsQuery = useQuery({
    queryKey: ["intakeClaims", draftId],
    queryFn: () => bff.dealIntake.getClaims(draftId),
    enabled: !!draftId,
    onSuccess: (data) => {
      debugLog("intake", "Claims loaded", {
        draftId,
        count: data?.claims?.length ?? 0
      });
    },
    onError: (error) => {
      debugLog("intake", "Claims load failed", { draftId, message: error?.message });
    }
  });

  const conflictsQuery = useQuery({
    queryKey: ["intakeConflicts", draftId],
    queryFn: () => bff.dealIntake.getConflicts(draftId, "OPEN"),
    enabled: !!draftId,
    onSuccess: (data) => {
      debugLog("intake", "Conflicts loaded", {
        draftId,
        count: data?.conflicts?.length ?? 0
      });
    },
    onError: (error) => {
      debugLog("intake", "Conflicts load failed", { draftId, message: error?.message });
    }
  });

  const statsQuery = useQuery({
    queryKey: ["intakeStats", draftId],
    queryFn: () => bff.dealIntake.getStats(draftId),
    enabled: !!draftId,
    onSuccess: (data) => {
      debugLog("intake", "Stats loaded", {
        draftId,
        unverifiedFields: data?.fieldsNeedingVerification?.length ?? 0
      });
    },
    onError: (error) => {
      debugLog("intake", "Stats load failed", { draftId, message: error?.message });
    }
  });

  const verifyClaimMutation = useMutation({
    mutationFn: ({ claimId, payload }) =>
      bff.dealIntake.verifyClaim(draftId, claimId, payload),
    onSuccess: () => {
      debugLog("intake", "Claim verified", { draftId });
      queryClient.invalidateQueries(["intakeClaims", draftId]);
      queryClient.invalidateQueries(["intakeStats", draftId]);
      queryClient.invalidateQueries(["intakeDraft", draftId]);
    },
    onError: (error) => {
      debugLog("intake", "Claim verify failed", { draftId, message: error?.message });
    }
  });

  const resolveConflictMutation = useMutation({
    mutationFn: ({ conflictId, payload }) =>
      bff.dealIntake.resolveConflict(draftId, conflictId, payload),
    onSuccess: () => {
      debugLog("intake", "Conflict resolved", { draftId });
      queryClient.invalidateQueries(["intakeConflicts", draftId]);
      queryClient.invalidateQueries(["intakeClaims", draftId]);
      queryClient.invalidateQueries(["intakeStats", draftId]);
    },
    onError: (error) => {
      debugLog("intake", "Conflict resolve failed", { draftId, message: error?.message });
    }
  });

  const uiStage = useMemo(() => {
    const draft = draftQuery.data;
    if (!draft) return null;

    const hasUnverifiedClaims =
      (statsQuery.data?.fieldsNeedingVerification?.length ?? 0) > 0;
    const hasOpenConflicts = conflictsQuery.data?.conflicts?.some(
      (conflict) => conflict.status === "OPEN"
    );

    return {
      canGenerateOM:
        !hasUnverifiedClaims &&
        !hasOpenConflicts &&
        draft.status === "DRAFT_INGESTED",
      canDistribute: draft.status === "OM_APPROVED_FOR_MARKETING",
      needsVerification: hasUnverifiedClaims,
      needsConflictResolution: Boolean(hasOpenConflicts)
    };
  }, [draftQuery.data, statsQuery.data, conflictsQuery.data]);

  return {
    draft: draftQuery.data,
    claims: claimsQuery.data?.claims ?? [],
    conflicts: conflictsQuery.data?.conflicts ?? [],
    stats: statsQuery.data,
    uiStage,
    isLoading:
      draftQuery.isLoading ||
      claimsQuery.isLoading ||
      conflictsQuery.isLoading ||
      statsQuery.isLoading,
    error:
      draftQuery.error ||
      claimsQuery.error ||
      conflictsQuery.error ||
      statsQuery.error,
    refetch: () => {
      draftQuery.refetch();
      claimsQuery.refetch();
      conflictsQuery.refetch();
      statsQuery.refetch();
    },
    verifyClaimMutation,
    resolveConflictMutation
  };
}
