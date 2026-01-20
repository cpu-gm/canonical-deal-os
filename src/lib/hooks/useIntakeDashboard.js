import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";

export function useIntakeDashboard(filters = {}) {
  const draftsQuery = useQuery({
    queryKey: ["intakeDrafts", filters],
    queryFn: () => bff.dealIntake.listDrafts(filters),
    onSuccess: (data) => {
      debugLog("intake", "Drafts loaded", {
        total: data?.total ?? 0,
        count: data?.drafts?.length ?? 0
      });
    },
    onError: (error) => {
      debugLog("intake", "Drafts load failed", { message: error?.message });
    }
  });

  const drafts = draftsQuery.data?.drafts ?? [];

  const derivedStats = useMemo(() => {
    return {
      total: drafts.length,
      inDraft: drafts.filter((draft) => draft.status === "DRAFT_INGESTED").length,
      omDrafted: drafts.filter((draft) => draft.status === "OM_DRAFTED").length,
      awaitingApproval: drafts.filter((draft) => draft.status === "OM_BROKER_APPROVED").length,
      readyToDistribute: drafts.filter((draft) => draft.status === "OM_APPROVED_FOR_MARKETING").length,
      distributed: drafts.filter((draft) => draft.status === "DISTRIBUTED").length
    };
  }, [drafts]);

  return {
    ...draftsQuery,
    drafts,
    derivedStats,
    error: draftsQuery.error,
    refetch: draftsQuery.refetch
  };
}
