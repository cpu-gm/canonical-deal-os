import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { Building2, Sparkles } from "lucide-react";
import { useBuyerInbox } from "@/lib/hooks/useBuyerInbox";
import { AIScoreBadge } from "@/components/distribution/AIScoreBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createPageUrl } from "@/utils";
import { debugLog } from "@/lib/debug";
import { PageError } from "@/components/ui/page-state";

const RESPONSE_FILTERS = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending response" },
  { value: "responded", label: "Responded" }
];

const responseBadge = (hasResponse) => {
  if (hasResponse) {
    return "bg-emerald-100 text-emerald-700";
  }
  return "bg-amber-100 text-amber-700";
};

const formatMoney = (value) => {
  if (value == null) return "TBD";
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "TBD";
  return `$${parsed.toLocaleString()}`;
};

export default function BuyerInbox() {
  const [hasRespondedFilter, setHasRespondedFilter] = useState("all");

  const filters = useMemo(() => {
    if (hasRespondedFilter === "all") return {};
    return { hasResponded: hasRespondedFilter === "responded" };
  }, [hasRespondedFilter]);

  const { inbox, criteria, isLoading, error, refetch, scoreAllMutation } = useBuyerInbox(filters);

  const handleFilterChange = (value) => {
    setHasRespondedFilter(value);
    debugLog("buyer", "Inbox filter changed", { value });
  };

  const handleScoreAll = () => {
    debugLog("buyer", "Score all requested");
    scoreAllMutation.mutate();
  };

  if (error) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <PageError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Buyer Inbox</h1>
          <p className="text-sm text-[#737373] mt-1">
            Deals shared with you based on distributions or criteria matching.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={criteria ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}>
            {criteria ? "Criteria active" : "No criteria"}
          </Badge>
          <Button variant="outline" onClick={handleScoreAll} disabled={scoreAllMutation.isLoading}>
            <Sparkles className="w-4 h-4 mr-2" />
            {scoreAllMutation.isLoading ? "Scoring..." : "Score all deals"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div className="text-sm text-[#737373]">{inbox.length} deals</div>
        <div className="w-56">
          <Select value={hasRespondedFilter} onValueChange={handleFilterChange}>
            <SelectTrigger>
              <SelectValue placeholder="Filter" />
            </SelectTrigger>
            <SelectContent>
              {RESPONSE_FILTERS.map((filter) => (
                <SelectItem key={filter.value} value={filter.value}>
                  {filter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((row) => (
            <div key={row} className="bg-white rounded-xl border border-[#E5E5E5] p-5 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-1/3 mb-3"></div>
              <div className="h-3 bg-slate-100 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      ) : inbox.length === 0 ? (
        <div className="bg-white rounded-xl border border-[#E5E5E5] p-10 text-center text-sm text-[#737373]">
          No deals in your inbox yet.
        </div>
      ) : (
        <div className="space-y-4">
          {inbox.map((entry) => {
            const deal = entry.distribution?.dealDraft ?? {};
            const score = entry.aiScore?.relevanceScore;
            const passesFilters = entry.aiScore?.passesFilters;
            const responded = Boolean(entry.responseId);

            return (
              <Card key={entry.id}>
                <CardContent className="pt-5">
                  <div className="flex items-start justify-between gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Building2 className="w-4 h-4 text-gray-400" />
                        <h3 className="font-semibold text-[#171717]">
                          {deal.propertyName || "Untitled deal"}
                        </h3>
                        <Badge className={responseBadge(responded)}>
                          {responded ? "Responded" : "Pending"}
                        </Badge>
                      </div>
                      <div className="text-sm text-[#737373]">
                        {deal.propertyAddress || "Address pending"}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-[#737373]">
                        <span>{deal.assetType || "Asset type pending"}</span>
                        <span className="text-[#A3A3A3]">|</span>
                        <span>{deal.unitCount ? `${deal.unitCount} units` : "Units pending"}</span>
                        <span className="text-[#A3A3A3]">|</span>
                        <span>{formatMoney(deal.askingPrice)}</span>
                      </div>
                      <div className="text-xs text-[#A3A3A3]">
                        Received {formatDistanceToNow(new Date(entry.pushedToInboxAt), { addSuffix: true })}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      {score != null && <AIScoreBadge score={score} />}
                      {passesFilters != null && (
                        <Badge className={passesFilters ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}>
                          {passesFilters ? "Matches criteria" : "Outside criteria"}
                        </Badge>
                      )}
                      <Button asChild>
                        <Link to={createPageUrl(`BuyerDealView?id=${deal.id}`)}>View deal</Link>
                      </Button>
                    </div>
                  </div>
                  {entry.aiScore?.summary && (
                    <div className="mt-4 text-sm text-[#525252] bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg p-3">
                      {entry.aiScore.summary}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
