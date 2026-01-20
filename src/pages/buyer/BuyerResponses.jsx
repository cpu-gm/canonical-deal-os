import React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { bff } from "@/api/bffClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createPageUrl } from "@/utils";
import { debugLog } from "@/lib/debug";
import { PageError } from "@/components/ui/page-state";

const RESPONSE_LABELS = {
  INTERESTED: { label: "Interested", className: "bg-emerald-100 text-emerald-700" },
  INTERESTED_WITH_CONDITIONS: { label: "Interested w/ Conditions", className: "bg-amber-100 text-amber-700" },
  PASS: { label: "Passed", className: "bg-slate-100 text-slate-700" }
};

export default function BuyerResponses() {
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["buyerResponses"],
    queryFn: () => bff.buyer.getResponses(),
    onSuccess: (responses) => {
      debugLog("buyer", "Responses loaded", { count: responses?.length ?? 0 });
    },
    onError: (err) => {
      debugLog("buyer", "Responses load failed", { message: err?.message });
    }
  });

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">My Responses</h1>
        <p className="text-sm text-[#737373] mt-1">History of the responses you have submitted.</p>
      </div>

      {isLoading ? (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-6 text-sm text-[#737373]">
          Loading responses...
        </div>
      ) : error ? (
        <PageError error={error} onRetry={refetch} />
      ) : data.length === 0 ? (
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-10 text-center text-sm text-[#737373]">
          No responses submitted yet.
        </div>
      ) : (
        <div className="space-y-4">
          {data.map((response) => {
            const config = RESPONSE_LABELS[response.response] || RESPONSE_LABELS.INTERESTED;
            return (
              <Card key={response.id}>
                <CardContent className="pt-5 flex items-start justify-between gap-6">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge className={config.className}>{config.label}</Badge>
                      <span className="text-xs text-[#A3A3A3]">
                        Submitted {formatDistanceToNow(new Date(response.respondedAt), { addSuffix: true })}
                      </span>
                    </div>
                    <div className="text-sm text-[#171717]">
                      Deal ID: <span className="font-mono text-xs">{response.dealDraftId}</span>
                    </div>
                    {response.passReason && (
                      <div className="text-xs text-[#737373]">Pass reason: {response.passReason}</div>
                    )}
                    {response.questionsForBroker?.length > 0 && (
                      <div className="text-xs text-[#737373]">
                        {response.questionsForBroker.length} question(s) shared with broker
                      </div>
                    )}
                  </div>
                  <Button asChild variant="outline">
                    <Link to={createPageUrl(`BuyerDealView?id=${response.dealDraftId}`)}>View deal</Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
