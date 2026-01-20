import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";

export function useBuyerInbox(filters = {}) {
  const queryClient = useQueryClient();

  const inboxQuery = useQuery({
    queryKey: ["buyerInbox", filters],
    queryFn: () => bff.buyer.getInbox(filters),
    onSuccess: (data) => {
      debugLog("buyer", "Inbox loaded", { count: data?.length ?? 0 });
    },
    onError: (error) => {
      debugLog("buyer", "Inbox load failed", { message: error?.message });
    }
  });

  const criteriaQuery = useQuery({
    queryKey: ["buyerCriteria"],
    queryFn: () => bff.buyer.getCriteria(),
    onSuccess: (data) => {
      debugLog("buyer", "Criteria loaded", { hasCriteria: Boolean(data) });
    },
    onError: (error) => {
      debugLog("buyer", "Criteria load failed", { message: error?.message });
    }
  });

  const scoreAllMutation = useMutation({
    mutationFn: () => bff.buyer.scoreAllDeals(),
    onSuccess: (data) => {
      debugLog("buyer", "Score all complete", { scored: data?.scored });
      queryClient.invalidateQueries(["buyerInbox"]);
    },
    onError: (error) => {
      debugLog("buyer", "Score all failed", { message: error?.message });
    }
  });

  return {
    inbox: inboxQuery.data ?? [],
    criteria: criteriaQuery.data,
    isLoading: inboxQuery.isLoading || criteriaQuery.isLoading,
    error: inboxQuery.error || criteriaQuery.error,
    refetch: () => {
      inboxQuery.refetch();
      criteriaQuery.refetch();
    },
    scoreAllMutation
  };
}
