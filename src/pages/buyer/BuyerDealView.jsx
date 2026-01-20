import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";
import { bff } from "@/api/bffClient";
import { AIScoreBadge } from "@/components/distribution/AIScoreBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { createPageUrl } from "@/utils";
import { debugLog } from "@/lib/debug";
import { PageError } from "@/components/ui/page-state";

const RESPONSE_OPTIONS = [
  { value: "INTERESTED", label: "Interested" },
  { value: "INTERESTED_WITH_CONDITIONS", label: "Interested with conditions" },
  { value: "PASS", label: "Pass" }
];

const PASS_REASONS = [
  { value: "PRICE", label: "Price" },
  { value: "ASSET_TYPE", label: "Asset type" },
  { value: "GEOGRAPHY", label: "Geography" },
  { value: "TIMING", label: "Timing" },
  { value: "OTHER", label: "Other" }
];

const parseLines = (value) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

const toNumber = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const formatSectionBody = (section) => {
  if (!section) return "";
  if (typeof section.content === "string") return section.content;
  if (section.fields) return JSON.stringify(section.fields, null, 2);
  if (section.body) return JSON.stringify(section.body, null, 2);
  return JSON.stringify(section, null, 2);
};

export default function BuyerDealView() {
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const dealId = urlParams.get("id");

  const [responseForm, setResponseForm] = useState({
    response: "INTERESTED",
    indicativePriceMin: "",
    indicativePriceMax: "",
    intendedStructure: "",
    timelineNotes: "",
    questionsForBroker: "",
    conditions: "",
    passReason: "",
    passNotes: "",
    isConfidential: false
  });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["buyerDeal", dealId],
    queryFn: () => bff.buyer.getDeal(dealId),
    enabled: !!dealId,
    onSuccess: () => {
      debugLog("buyer", "Deal loaded", { dealId });
    },
    onError: (err) => {
      debugLog("buyer", "Deal load failed", { dealId, message: err?.message });
    }
  });

  const scoreMutation = useMutation({
    mutationFn: () => bff.buyer.scoreDeal(dealId),
    onSuccess: () => {
      debugLog("buyer", "Deal scored", { dealId });
      queryClient.invalidateQueries(["buyerDeal", dealId]);
      toast({
        title: "Scoring complete",
        description: "AI triage score updated for this deal."
      });
    },
    onError: (err) => {
      debugLog("buyer", "Deal scoring failed", { dealId, message: err?.message });
      toast({
        title: "Unable to score deal",
        description: err?.message || "Please try again.",
        variant: "destructive"
      });
    }
  });

  const submitMutation = useMutation({
    mutationFn: (payload) => bff.buyer.submitResponse(dealId, payload),
    onSuccess: () => {
      debugLog("buyer", "Response submitted", { dealId, response: responseForm.response });
      queryClient.invalidateQueries(["buyerDeal", dealId]);
      queryClient.invalidateQueries(["buyerResponses"]);
      toast({
        title: "Response submitted",
        description: "Your response has been recorded."
      });
    },
    onError: (err) => {
      debugLog("buyer", "Response submit failed", { dealId, message: err?.message });
      toast({
        title: "Unable to submit response",
        description: err?.message || "Please check the form and try again.",
        variant: "destructive"
      });
    }
  });

  const deal = data?.deal ?? {};
  const triage = data?.triage ?? null;
  const omVersion = data?.omVersion ?? null;
  const existingResponse = data?.response ?? null;

  const sections = useMemo(() => {
    const content = omVersion?.content;
    if (!content) return [];
    if (Array.isArray(content.sections)) return content.sections;
    if (Array.isArray(content)) return content;
    return [];
  }, [omVersion]);

  const handleSubmit = () => {
    const payload = {
      response: responseForm.response,
      isConfidential: Boolean(responseForm.isConfidential)
    };

    if (responseForm.response !== "PASS") {
      const minPrice = toNumber(responseForm.indicativePriceMin);
      const maxPrice = toNumber(responseForm.indicativePriceMax);
      if (minPrice != null) payload.indicativePriceMin = minPrice;
      if (maxPrice != null) payload.indicativePriceMax = maxPrice;
      if (responseForm.intendedStructure) payload.intendedStructure = responseForm.intendedStructure;
      if (responseForm.timelineNotes) payload.timelineNotes = responseForm.timelineNotes;
      const questions = parseLines(responseForm.questionsForBroker);
      if (questions.length) payload.questionsForBroker = questions;
    }

    if (responseForm.response === "INTERESTED_WITH_CONDITIONS") {
      const conditions = parseLines(responseForm.conditions);
      if (conditions.length) payload.conditions = conditions;
    }

    if (responseForm.response === "PASS") {
      if (responseForm.passReason) payload.passReason = responseForm.passReason;
      if (responseForm.passNotes) payload.passNotes = responseForm.passNotes;
    }

    debugLog("buyer", "Submitting response", { dealId, response: payload.response });
    submitMutation.mutate(payload);
  };

  if (!dealId) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-6 text-sm text-[#737373]">
          Missing deal id.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-white border border-[#E5E5E5] rounded-xl p-6 flex items-center gap-3 text-sm">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading deal...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <PageError error={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <Link to={createPageUrl("BuyerInbox")} className="text-sm text-[#737373] inline-flex items-center gap-2">
        <ArrowLeft className="w-4 h-4" /> Back to inbox
      </Link>

      <div>
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">
          {deal.propertyName || "Untitled deal"}
        </h1>
        <p className="text-sm text-[#737373] mt-1">{deal.propertyAddress || "Address pending"}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[#737373]">Asset type</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">{deal.assetType || "Pending"}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[#737373]">Units</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">{deal.unitCount || "Pending"}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm text-[#737373]">Asking price</CardTitle>
          </CardHeader>
          <CardContent className="text-lg font-semibold">
            {deal.askingPrice ? `$${Number(deal.askingPrice).toLocaleString()}` : "Pending"}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>AI Triage</CardTitle>
            <p className="text-sm text-[#737373]">Your relevance score and summary.</p>
          </div>
          <div className="flex items-center gap-2">
            {triage?.relevanceScore != null && <AIScoreBadge score={triage.relevanceScore} breakdown={triage.scoreBreakdown} />}
            <Button variant="outline" onClick={() => scoreMutation.mutate()} disabled={scoreMutation.isLoading}>
              {scoreMutation.isLoading ? "Scoring..." : "Refresh score"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {triage?.summary ? (
            <p className="text-sm text-[#525252] whitespace-pre-wrap">{triage.summary}</p>
          ) : (
            <p className="text-sm text-[#737373]">No AI summary yet. Run scoring to generate one.</p>
          )}
          {triage?.flags?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {triage.flags.map((flag, index) => (
                <Badge key={index} className="bg-amber-100 text-amber-700">
                  {flag.message}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Offering Memorandum</CardTitle>
        </CardHeader>
        <CardContent>
          {omVersion ? (
            <div className="space-y-4">
              {sections.length === 0 ? (
                <p className="text-sm text-[#737373]">No OM sections available yet.</p>
              ) : (
                sections.map((section) => (
                  <div key={section.id || section.title} className="border border-[#E5E5E5] rounded-lg p-4">
                    <div className="font-medium text-[#171717] mb-2">{section.title || section.id}</div>
                    <pre className="text-xs text-[#525252] whitespace-pre-wrap max-h-40 overflow-hidden">
                      {formatSectionBody(section)}
                    </pre>
                  </div>
                ))
              )}
            </div>
          ) : (
            <p className="text-sm text-[#737373]">OM is not available yet.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your response</CardTitle>
        </CardHeader>
        <CardContent>
          {existingResponse ? (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge className="bg-slate-100 text-slate-700">{existingResponse.response}</Badge>
                <span className="text-[#A3A3A3]">
                  Submitted {formatDistanceToNow(new Date(existingResponse.respondedAt), { addSuffix: true })}
                </span>
              </div>
              {existingResponse.passReason && (
                <div>Pass reason: {existingResponse.passReason}</div>
              )}
              {existingResponse.passNotes && <div>Notes: {existingResponse.passNotes}</div>}
              {existingResponse.questionsForBroker?.length > 0 && (
                <div>
                  <div className="text-[#737373] mb-1">Questions for broker</div>
                  <ul className="list-disc list-inside">
                    {existingResponse.questionsForBroker.map((question, index) => (
                      <li key={index}>{question}</li>
                    ))}
                  </ul>
                </div>
              )}
              {existingResponse.conditions?.length > 0 && (
                <div>
                  <div className="text-[#737373] mb-1">Conditions</div>
                  <ul className="list-disc list-inside">
                    {existingResponse.conditions.map((condition, index) => (
                      <li key={index}>{condition}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[#737373]">Response</label>
                  <Select
                    value={responseForm.response}
                    onValueChange={(value) => setResponseForm((prev) => ({ ...prev, response: value }))}
                  >
                    <SelectTrigger className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RESPONSE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {responseForm.response !== "PASS" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#737373]">Indicative price min</label>
                    <Input
                      className="mt-1"
                      value={responseForm.indicativePriceMin}
                      onChange={(event) =>
                        setResponseForm((prev) => ({ ...prev, indicativePriceMin: event.target.value }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-[#737373]">Indicative price max</label>
                    <Input
                      className="mt-1"
                      value={responseForm.indicativePriceMax}
                      onChange={(event) =>
                        setResponseForm((prev) => ({ ...prev, indicativePriceMax: event.target.value }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-[#737373]">Intended structure</label>
                    <Input
                      className="mt-1"
                      value={responseForm.intendedStructure}
                      onChange={(event) =>
                        setResponseForm((prev) => ({ ...prev, intendedStructure: event.target.value }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-[#737373]">Timeline notes</label>
                    <Textarea
                      className="mt-1"
                      value={responseForm.timelineNotes}
                      onChange={(event) =>
                        setResponseForm((prev) => ({ ...prev, timelineNotes: event.target.value }))
                      }
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs text-[#737373]">Questions for broker (one per line)</label>
                    <Textarea
                      className="mt-1"
                      value={responseForm.questionsForBroker}
                      onChange={(event) =>
                        setResponseForm((prev) => ({ ...prev, questionsForBroker: event.target.value }))
                      }
                    />
                  </div>
                </div>
              )}

              {responseForm.response === "INTERESTED_WITH_CONDITIONS" && (
                <div>
                  <label className="text-xs text-[#737373]">Conditions (one per line)</label>
                  <Textarea
                    className="mt-1"
                    value={responseForm.conditions}
                    onChange={(event) =>
                      setResponseForm((prev) => ({ ...prev, conditions: event.target.value }))
                    }
                  />
                </div>
              )}

              {responseForm.response === "PASS" && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-[#737373]">Pass reason</label>
                    <Select
                      value={responseForm.passReason}
                      onValueChange={(value) => setResponseForm((prev) => ({ ...prev, passReason: value }))}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                      <SelectContent>
                        {PASS_REASONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-xs text-[#737373]">Pass notes</label>
                    <Textarea
                      className="mt-1"
                      value={responseForm.passNotes}
                      onChange={(event) =>
                        setResponseForm((prev) => ({ ...prev, passNotes: event.target.value }))
                      }
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2">
                <input
                  id="confidential"
                  type="checkbox"
                  checked={responseForm.isConfidential}
                  onChange={(event) =>
                    setResponseForm((prev) => ({ ...prev, isConfidential: event.target.checked }))
                  }
                />
                <label htmlFor="confidential" className="text-xs text-[#737373]">
                  Mark response as confidential
                </label>
              </div>

              <Button onClick={handleSubmit} disabled={submitMutation.isLoading}>
                {submitMutation.isLoading ? "Submitting..." : "Submit response"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
