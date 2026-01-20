import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";

function normalizeAuthorizationStatus(status) {
  if (!status || status === "NOT_REVIEWED") return "PENDING";
  return status;
}

export function useIntakeAccessRequests(dealDraftId) {
  const queryClient = useQueryClient();

  const queueQuery = useQuery({
    queryKey: ["reviewQueue", dealDraftId],
    queryFn: () => bff.gate.getReviewQueue(dealDraftId, {}),
    enabled: !!dealDraftId,
    onSuccess: (data) => {
      debugLog("gate", "Review queue loaded", {
        dealDraftId,
        count: data?.length ?? 0
      });
    },
    onError: (error) => {
      debugLog("gate", "Review queue load failed", {
        dealDraftId,
        message: error?.message
      });
    }
  });

  const progressQuery = useQuery({
    queryKey: ["dealProgress", dealDraftId],
    queryFn: () => bff.gate.getProgress(dealDraftId),
    enabled: !!dealDraftId,
    onSuccess: (data) => {
      debugLog("gate", "Progress loaded", {
        dealDraftId,
        funnel: data?.funnel ?? null
      });
    },
    onError: (error) => {
      debugLog("gate", "Progress load failed", {
        dealDraftId,
        message: error?.message
      });
    }
  });

  const authorizeMutation = useMutation({
    mutationFn: ({ buyerUserId, payload }) =>
      bff.gate.authorize(dealDraftId, buyerUserId, payload),
    onSuccess: () => {
      debugLog("gate", "Buyer authorized", { dealDraftId });
      queryClient.invalidateQueries(["reviewQueue", dealDraftId]);
      queryClient.invalidateQueries(["dealProgress", dealDraftId]);
    },
    onError: (error) => {
      debugLog("gate", "Authorize failed", { dealDraftId, message: error?.message });
    }
  });

  const declineMutation = useMutation({
    mutationFn: ({ buyerUserId, reason }) =>
      bff.gate.decline(dealDraftId, buyerUserId, reason),
    onSuccess: () => {
      debugLog("gate", "Buyer declined", { dealDraftId });
      queryClient.invalidateQueries(["reviewQueue", dealDraftId]);
    },
    onError: (error) => {
      debugLog("gate", "Decline failed", { dealDraftId, message: error?.message });
    }
  });

  const queue = useMemo(() => {
    const data = queueQuery.data ?? [];
    return data.map((item) => {
      const nextStatus = normalizeAuthorizationStatus(item?.authorization?.status);
      return {
        ...item,
        authorization: {
          ...item.authorization,
          status: nextStatus
        }
      };
    });
  }, [queueQuery.data]);

  const funnelStats = useMemo(() => {
    const funnel = progressQuery.data?.funnel;
    if (!funnel) return null;
    return {
      distributed: funnel.distributed ?? 0,
      responded: funnel.responded ?? 0,
      interested: funnel.interested ?? 0,
      authorized: funnel.authorized ?? 0,
      ndaSigned: funnel.ndaSigned ?? 0,
      inDataRoom: funnel.inDataRoom ?? 0
    };
  }, [progressQuery.data]);

  return {
    queue,
    progress: progressQuery.data,
    funnelStats,
    isLoading: queueQuery.isLoading || progressQuery.isLoading,
    error: queueQuery.error || progressQuery.error,
    refetch: () => {
      queueQuery.refetch();
      progressQuery.refetch();
    },
    authorizeMutation,
    declineMutation
  };
}
