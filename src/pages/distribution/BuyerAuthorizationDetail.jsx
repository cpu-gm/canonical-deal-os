import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";
import { PageError } from "@/components/ui/page-state";

export default function BuyerAuthorizationDetail() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dealDraftId = searchParams.get("dealDraftId");
  const buyerUserId = searchParams.get("buyerUserId");
  const [ndaDocumentId, setNdaDocumentId] = useState("");

  const statusQuery = useQuery({
    queryKey: ["authorizationStatus", dealDraftId, buyerUserId],
    queryFn: () => bff.gate.getStatus(dealDraftId, buyerUserId),
    enabled: !!dealDraftId && !!buyerUserId,
    onError: (error) => {
      debugLog("gate", "Authorization status load failed", {
        dealDraftId,
        buyerUserId,
        message: error?.message
      });
    }
  });

  const sendNdaMutation = useMutation({
    mutationFn: () => bff.gate.sendNDA(dealDraftId, buyerUserId),
    onSuccess: () => {
      queryClient.invalidateQueries(["authorizationStatus", dealDraftId, buyerUserId]);
    }
  });

  const recordSignedMutation = useMutation({
    mutationFn: () => bff.gate.recordNDASigned(dealDraftId, buyerUserId, ndaDocumentId),
    onSuccess: () => {
      setNdaDocumentId("");
      queryClient.invalidateQueries(["authorizationStatus", dealDraftId, buyerUserId]);
    }
  });

  const grantAccessMutation = useMutation({
    mutationFn: () => bff.gate.grantAccess(dealDraftId, buyerUserId, "STANDARD"),
    onSuccess: () => {
      queryClient.invalidateQueries(["authorizationStatus", dealDraftId, buyerUserId]);
    }
  });

  const revokeMutation = useMutation({
    mutationFn: () => bff.gate.revoke(dealDraftId, buyerUserId, "Access revoked"),
    onSuccess: () => {
      queryClient.invalidateQueries(["authorizationStatus", dealDraftId, buyerUserId]);
    }
  });

  if (!dealDraftId || !buyerUserId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">
            Missing dealDraftId or buyerUserId.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (statusQuery.error) {
    return (
      <div className="p-6">
        <PageError error={statusQuery.error} onRetry={statusQuery.refetch} />
      </div>
    );
  }

  if (statusQuery.isLoading) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6 text-sm text-gray-500">Loading status...</CardContent>
        </Card>
      </div>
    );
  }

  const authorization = statusQuery.data;

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Buyer Authorization</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Status</span>
            <Badge variant="outline">{authorization?.status || "PENDING"}</Badge>
          </div>
          {authorization?.ndaStatus && (
            <div className="flex items-center justify-between">
              <span>NDA</span>
              <Badge variant="outline">{authorization.ndaStatus}</Badge>
            </div>
          )}
          {authorization?.dataRoomAccessGranted && (
            <div className="flex items-center justify-between">
              <span>Data room</span>
              <Badge variant="outline">{authorization.dataRoomAccessLevel}</Badge>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => sendNdaMutation.mutate()} disabled={sendNdaMutation.isPending}>
            Send NDA
          </Button>

          <div className="space-y-2">
            <Label htmlFor="ndaDocumentId">NDA Document Id</Label>
            <Input
              id="ndaDocumentId"
              value={ndaDocumentId}
              onChange={(event) => setNdaDocumentId(event.target.value)}
              placeholder="nda-doc-123"
            />
            <Button
              variant="outline"
              onClick={() => recordSignedMutation.mutate()}
              disabled={!ndaDocumentId || recordSignedMutation.isPending}
            >
              Mark NDA Signed
            </Button>
          </div>

          <Button variant="outline" onClick={() => grantAccessMutation.mutate()}>
            Grant Data Room Access
          </Button>

          <Button variant="destructive" onClick={() => revokeMutation.mutate()}>
            Revoke Access
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
