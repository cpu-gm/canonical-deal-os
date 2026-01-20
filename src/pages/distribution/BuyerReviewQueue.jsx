import { useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BuyerResponseCard } from "@/components/distribution/BuyerResponseCard";
import { useIntakeAccessRequests } from "@/lib/hooks/useIntakeAccessRequests";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";
import { toast } from "@/components/ui/use-toast";
import { PageError } from "@/components/ui/page-state";

export default function BuyerReviewQueue() {
  const [searchParams] = useSearchParams();
  const dealDraftId = searchParams.get("dealDraftId");

  const {
    queue,
    funnelStats,
    isLoading,
    error,
    refetch,
    authorizeMutation,
    declineMutation
  } = useIntakeAccessRequests(dealDraftId);

  const sendNDAMutation = useMutation({
    mutationFn: ({ buyerUserId }) => bff.gate.sendNDA(dealDraftId, buyerUserId),
    onSuccess: () => {
      toast({ title: "NDA sent" });
    },
    onError: (error) => {
      debugLog("gate", "Send NDA failed", { dealDraftId, message: error?.message });
      toast({ title: "NDA failed", description: error.message, variant: "destructive" });
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

  if (error) {
    return (
      <div className="p-6">
        <PageError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Buyer Review Queue</h1>

      {funnelStats && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Funnel snapshot</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="outline">Distributed {funnelStats.distributed}</Badge>
            <Badge variant="outline">Responded {funnelStats.responded}</Badge>
            <Badge variant="outline">Interested {funnelStats.interested}</Badge>
            <Badge variant="outline">Authorized {funnelStats.authorized}</Badge>
            <Badge variant="outline">NDA Signed {funnelStats.ndaSigned}</Badge>
            <Badge variant="outline">In Data Room {funnelStats.inDataRoom}</Badge>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">Loading queue...</CardContent>
        </Card>
      ) : queue.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">No buyers awaiting review.</CardContent>
        </Card>
      ) : (
        queue.map((item) => (
          <BuyerResponseCard
            key={item.response.id}
            response={item.response}
            authorization={item.authorization}
            buyer={item.buyer}
            aiScore={item.aiScore}
            onAuthorize={() =>
              authorizeMutation.mutate({
                buyerUserId: item.response.buyerUserId,
                payload: {}
              })
            }
            onDecline={() =>
              declineMutation.mutate({
                buyerUserId: item.response.buyerUserId,
                reason: "Not a fit"
              })
            }
            onSendNDA={() => {
              debugLog("gate", "Send NDA", { buyerUserId: item.response.buyerUserId });
              sendNDAMutation.mutate({ buyerUserId: item.response.buyerUserId });
            }}
          />
        ))
      )}
    </div>
  );
}
