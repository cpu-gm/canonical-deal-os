import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";
import { toast } from "@/components/ui/use-toast";
import { PageError } from "@/components/ui/page-state";

const LISTING_TYPES = ["PRIVATE", "PUBLIC"];

export default function DistributionManagement() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dealDraftId = searchParams.get("dealDraftId");
  const [listingType, setListingType] = useState("PRIVATE");
  const [recipientIds, setRecipientIds] = useState("");

  const distributionsQuery = useQuery({
    queryKey: ["distributions", dealDraftId],
    queryFn: () => bff.distribution.getForDeal(dealDraftId),
    enabled: !!dealDraftId,
    onError: (error) => {
      debugLog("distribution", "Distributions load failed", {
        dealDraftId,
        message: error?.message
      });
    }
  });

  const createMutation = useMutation({
    mutationFn: (payload) => bff.distribution.create(dealDraftId, payload),
    onSuccess: () => {
      debugLog("distribution", "Distribution created", { dealDraftId });
      queryClient.invalidateQueries(["distributions", dealDraftId]);
      toast({ title: "Distribution created" });
      setRecipientIds("");
    },
    onError: (error) => {
      toast({ title: "Create failed", description: error.message, variant: "destructive" });
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

  if (distributionsQuery.error) {
    return (
      <div className="p-6">
        <PageError error={distributionsQuery.error} onRetry={distributionsQuery.refetch} />
      </div>
    );
  }

  const handleCreate = () => {
    const ids = recipientIds
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);

    createMutation.mutate({
      listingType,
      recipientIds: ids
    });
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Distribution Management</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create distribution</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label>Listing type</Label>
            <Select value={listingType} onValueChange={setListingType}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select listing type" />
              </SelectTrigger>
              <SelectContent>
                {LISTING_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Recipient IDs (comma separated)</Label>
            <Input
              value={recipientIds}
              onChange={(event) => setRecipientIds(event.target.value)}
              placeholder="buyer-1,buyer-2"
            />
          </div>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating..." : "Create Distribution"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Existing distributions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(distributionsQuery.data ?? []).length === 0 ? (
            <div className="text-sm text-gray-500">No distributions yet.</div>
          ) : (
            distributionsQuery.data.map((distribution) => (
              <div key={distribution.id} className="flex items-center justify-between text-sm">
                <div>
                  <div className="font-medium">Distribution {distribution.id.slice(0, 8)}</div>
                  <div className="text-xs text-gray-500">
                    {distribution.recipients?.length || 0} recipients
                  </div>
                </div>
                <Badge variant="outline">{distribution.listingType}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
