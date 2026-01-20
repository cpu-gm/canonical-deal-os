import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";
import { toast } from "@/components/ui/use-toast";
import { PageError } from "@/components/ui/page-state";

export default function DealProgress() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dealDraftId = searchParams.get("dealDraftId");

  const progressQuery = useQuery({
    queryKey: ["dealProgress", dealDraftId],
    queryFn: () => bff.gate.getProgress(dealDraftId),
    enabled: !!dealDraftId,
    onError: (error) => {
      debugLog("gate", "Progress load failed", { dealDraftId, message: error?.message });
    }
  });

  const advanceMutation = useMutation({
    mutationFn: () => bff.gate.advanceToActiveDD(dealDraftId),
    onSuccess: () => {
      debugLog("gate", "Advanced to ACTIVE_DD", { dealDraftId });
      queryClient.invalidateQueries(["dealProgress", dealDraftId]);
      toast({ title: "Deal advanced to Active DD" });
    },
    onError: (error) => {
      toast({ title: "Advance failed", description: error.message, variant: "destructive" });
    }
  });

  if (!dealDraftId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">Missing dealDraftId.</CardContent>
        </Card>
      </div>
    );
  }

  if (progressQuery.error) {
    return (
      <div className="p-6">
        <PageError error={progressQuery.error} onRetry={progressQuery.refetch} />
      </div>
    );
  }

  const progress = progressQuery.data;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Deal Progress</h1>

      {!progress ? (
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">Loading progress...</CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status</CardTitle>
            </CardHeader>
            <CardContent className="flex items-center gap-2">
              <Badge variant="outline">{progress.dealStatus}</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Funnel</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge variant="outline">Distributed {progress.funnel.distributed}</Badge>
              <Badge variant="outline">Responded {progress.funnel.responded}</Badge>
              <Badge variant="outline">Interested {progress.funnel.interested}</Badge>
              <Badge variant="outline">Authorized {progress.funnel.authorized}</Badge>
              <Badge variant="outline">NDA Signed {progress.funnel.ndaSigned}</Badge>
              <Badge variant="outline">In Data Room {progress.funnel.inDataRoom}</Badge>
            </CardContent>
          </Card>

          {progress.canAdvanceToDD && (
            <Button onClick={() => advanceMutation.mutate()} disabled={advanceMutation.isPending}>
              {advanceMutation.isPending ? "Advancing..." : "Advance to Active DD"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
