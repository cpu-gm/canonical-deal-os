import React, { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { bff } from "@/api/bffClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { debugLog } from "@/lib/debug";
import { PageError } from "@/components/ui/page-state";

const parseList = (value) => {
  const items = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return items.length ? items : null;
};

const toNumber = (value) => {
  if (value === "" || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const defaultWeights = {
  assetTypeMatch: 20,
  priceRange: 25,
  sizeMatch: 20,
  locationMatch: 20,
  completeness: 15
};

export default function BuyerCriteria() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    assetTypes: "",
    geographiesInclude: "",
    geographiesExclude: "",
    minUnits: "",
    maxUnits: "",
    minPrice: "",
    maxPrice: "",
    minSF: "",
    maxSF: "",
    weightAssetTypeMatch: "",
    weightPriceRange: "",
    weightSizeMatch: "",
    weightLocationMatch: "",
    weightCompleteness: "",
    customInstructions: "",
    autoReceiveMatches: true,
    minMatchScore: ""
  });

  const [anonymity, setAnonymity] = useState({
    isAnonymous: false,
    anonymousLabel: "Anonymous Buyer"
  });

  const { data: criteria, isLoading, error: criteriaError, refetch: refetchCriteria } = useQuery({
    queryKey: ["buyerCriteria"],
    queryFn: () => bff.buyer.getCriteria(),
    onSuccess: (data) => {
      debugLog("buyer", "Criteria loaded", { hasCriteria: Boolean(data) });
    },
    onError: (error) => {
      debugLog("buyer", "Criteria load failed", { message: error?.message });
    }
  });

  const { data: anonymityData, error: anonymityError, refetch: refetchAnonymity } = useQuery({
    queryKey: ["buyerAnonymity"],
    queryFn: () => bff.buyer.getAnonymity(),
    onSuccess: (data) => {
      debugLog("buyer", "Anonymity loaded", { isAnonymous: data?.isAnonymous });
    },
    onError: (error) => {
      debugLog("buyer", "Anonymity load failed", { message: error?.message });
    }
  });

  useEffect(() => {
    if (!criteria) return;

    setForm({
      assetTypes: criteria.assetTypes?.join(", ") || "",
      geographiesInclude: criteria.geographiesInclude?.join(", ") || "",
      geographiesExclude: criteria.geographiesExclude?.join(", ") || "",
      minUnits: criteria.minUnits ?? "",
      maxUnits: criteria.maxUnits ?? "",
      minPrice: criteria.minPrice ?? "",
      maxPrice: criteria.maxPrice ?? "",
      minSF: criteria.minSF ?? "",
      maxSF: criteria.maxSF ?? "",
      weightAssetTypeMatch: criteria.scoringWeights?.assetTypeMatch?.weight ?? "",
      weightPriceRange: criteria.scoringWeights?.priceRange?.weight ?? "",
      weightSizeMatch: criteria.scoringWeights?.sizeMatch?.weight ?? "",
      weightLocationMatch: criteria.scoringWeights?.locationMatch?.weight ?? "",
      weightCompleteness: criteria.scoringWeights?.completeness?.weight ?? "",
      customInstructions: criteria.customInstructions ?? "",
      autoReceiveMatches: criteria.autoReceiveMatches ?? true,
      minMatchScore: criteria.minMatchScore ?? ""
    });
  }, [criteria]);

  useEffect(() => {
    if (!anonymityData) return;
    setAnonymity({
      isAnonymous: Boolean(anonymityData.isAnonymous),
      anonymousLabel: anonymityData.anonymousLabel || "Anonymous Buyer"
    });
  }, [anonymityData]);

  const updateMutation = useMutation({
    mutationFn: (payload) => bff.buyer.updateCriteria(payload),
    onSuccess: () => {
      debugLog("buyer", "Criteria saved");
      queryClient.invalidateQueries(["buyerCriteria"]);
      queryClient.invalidateQueries(["buyerInbox"]);
      toast({
        title: "Criteria saved",
        description: "Your buyer criteria has been updated."
      });
    },
    onError: (error) => {
      debugLog("buyer", "Criteria save failed", { message: error?.message });
      toast({
        title: "Unable to save criteria",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: () => bff.buyer.deleteCriteria(),
    onSuccess: () => {
      debugLog("buyer", "Criteria deleted");
      queryClient.invalidateQueries(["buyerCriteria"]);
      toast({
        title: "Criteria cleared",
        description: "Your criteria profile has been removed."
      });
    },
    onError: (error) => {
      debugLog("buyer", "Criteria delete failed", { message: error?.message });
      toast({
        title: "Unable to clear criteria",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    }
  });

  const anonymityMutation = useMutation({
    mutationFn: (payload) => bff.buyer.updateAnonymity(payload),
    onSuccess: () => {
      debugLog("buyer", "Anonymity saved");
      queryClient.invalidateQueries(["buyerAnonymity"]);
      toast({
        title: "Anonymity updated",
        description: "Your anonymity settings were saved."
      });
    },
    onError: (error) => {
      debugLog("buyer", "Anonymity save failed", { message: error?.message });
      toast({
        title: "Unable to save anonymity",
        description: error?.message || "Please try again.",
        variant: "destructive"
      });
    }
  });

  const scoringWeights = useMemo(() => {
    return {
      assetTypeMatch: { weight: toNumber(form.weightAssetTypeMatch) ?? defaultWeights.assetTypeMatch },
      priceRange: { weight: toNumber(form.weightPriceRange) ?? defaultWeights.priceRange },
      sizeMatch: { weight: toNumber(form.weightSizeMatch) ?? defaultWeights.sizeMatch },
      locationMatch: { weight: toNumber(form.weightLocationMatch) ?? defaultWeights.locationMatch },
      completeness: { weight: toNumber(form.weightCompleteness) ?? defaultWeights.completeness }
    };
  }, [
    form.weightAssetTypeMatch,
    form.weightPriceRange,
    form.weightSizeMatch,
    form.weightLocationMatch,
    form.weightCompleteness
  ]);

  const error = criteriaError || anonymityError;

  if (error) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <PageError
          error={error}
          onRetry={() => {
            refetchCriteria();
            refetchAnonymity();
          }}
        />
      </div>
    );
  }

  const handleSave = () => {
    const payload = {
      assetTypes: parseList(form.assetTypes),
      geographiesInclude: parseList(form.geographiesInclude),
      geographiesExclude: parseList(form.geographiesExclude),
      minUnits: toNumber(form.minUnits),
      maxUnits: toNumber(form.maxUnits),
      minPrice: toNumber(form.minPrice),
      maxPrice: toNumber(form.maxPrice),
      minSF: toNumber(form.minSF),
      maxSF: toNumber(form.maxSF),
      scoringWeights,
      customInstructions: form.customInstructions || null,
      autoReceiveMatches: Boolean(form.autoReceiveMatches),
      minMatchScore: toNumber(form.minMatchScore) ?? 50
    };

    debugLog("buyer", "Saving criteria");
    updateMutation.mutate(payload);
  };

  const handleAnonymitySave = () => {
    const payload = {
      isAnonymous: Boolean(anonymity.isAnonymous),
      anonymousLabel: anonymity.anonymousLabel || "Anonymous Buyer"
    };

    debugLog("buyer", "Saving anonymity", payload);
    anonymityMutation.mutate(payload);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Buyer Criteria</h1>
        <p className="text-sm text-[#737373] mt-1">Set the filters and preferences for deal matching.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hard filters</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[#737373]">Asset types (comma separated)</label>
            <Input
              className="mt-1"
              value={form.assetTypes}
              onChange={(event) => setForm((prev) => ({ ...prev, assetTypes: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Include geographies</label>
            <Input
              className="mt-1"
              value={form.geographiesInclude}
              onChange={(event) => setForm((prev) => ({ ...prev, geographiesInclude: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Exclude geographies</label>
            <Input
              className="mt-1"
              value={form.geographiesExclude}
              onChange={(event) => setForm((prev) => ({ ...prev, geographiesExclude: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Min units</label>
            <Input
              className="mt-1"
              value={form.minUnits}
              onChange={(event) => setForm((prev) => ({ ...prev, minUnits: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Max units</label>
            <Input
              className="mt-1"
              value={form.maxUnits}
              onChange={(event) => setForm((prev) => ({ ...prev, maxUnits: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Min price</label>
            <Input
              className="mt-1"
              value={form.minPrice}
              onChange={(event) => setForm((prev) => ({ ...prev, minPrice: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Max price</label>
            <Input
              className="mt-1"
              value={form.maxPrice}
              onChange={(event) => setForm((prev) => ({ ...prev, maxPrice: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Min square footage</label>
            <Input
              className="mt-1"
              value={form.minSF}
              onChange={(event) => setForm((prev) => ({ ...prev, minSF: event.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Max square footage</label>
            <Input
              className="mt-1"
              value={form.maxSF}
              onChange={(event) => setForm((prev) => ({ ...prev, maxSF: event.target.value }))}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Scoring weights</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-[#737373]">Asset type match</label>
            <Input
              className="mt-1"
              value={form.weightAssetTypeMatch}
              onChange={(event) => setForm((prev) => ({ ...prev, weightAssetTypeMatch: event.target.value }))}
              placeholder={String(defaultWeights.assetTypeMatch)}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Price range</label>
            <Input
              className="mt-1"
              value={form.weightPriceRange}
              onChange={(event) => setForm((prev) => ({ ...prev, weightPriceRange: event.target.value }))}
              placeholder={String(defaultWeights.priceRange)}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Size match</label>
            <Input
              className="mt-1"
              value={form.weightSizeMatch}
              onChange={(event) => setForm((prev) => ({ ...prev, weightSizeMatch: event.target.value }))}
              placeholder={String(defaultWeights.sizeMatch)}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Location match</label>
            <Input
              className="mt-1"
              value={form.weightLocationMatch}
              onChange={(event) => setForm((prev) => ({ ...prev, weightLocationMatch: event.target.value }))}
              placeholder={String(defaultWeights.locationMatch)}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Completeness</label>
            <Input
              className="mt-1"
              value={form.weightCompleteness}
              onChange={(event) => setForm((prev) => ({ ...prev, weightCompleteness: event.target.value }))}
              placeholder={String(defaultWeights.completeness)}
            />
          </div>
          <div>
            <label className="text-xs text-[#737373]">Minimum match score</label>
            <Input
              className="mt-1"
              value={form.minMatchScore}
              onChange={(event) => setForm((prev) => ({ ...prev, minMatchScore: event.target.value }))}
              placeholder="50"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preferences</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-xs text-[#737373]">Custom instructions for AI</label>
            <Textarea
              className="mt-1"
              rows={4}
              value={form.customInstructions}
              onChange={(event) => setForm((prev) => ({ ...prev, customInstructions: event.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-[#525252]">
            <input
              type="checkbox"
              checked={form.autoReceiveMatches}
              onChange={(event) => setForm((prev) => ({ ...prev, autoReceiveMatches: event.target.checked }))}
            />
            Auto receive matches in inbox
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Anonymous buyer settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex items-center gap-2 text-sm text-[#525252]">
            <input
              type="checkbox"
              checked={anonymity.isAnonymous}
              onChange={(event) => setAnonymity((prev) => ({ ...prev, isAnonymous: event.target.checked }))}
            />
            Hide my firm name when sellers view responses
          </label>
          <div>
            <label className="text-xs text-[#737373]">Anonymous label</label>
            <Input
              className="mt-1"
              value={anonymity.anonymousLabel}
              onChange={(event) => setAnonymity((prev) => ({ ...prev, anonymousLabel: event.target.value }))}
            />
          </div>
          <Button variant="outline" onClick={handleAnonymitySave} disabled={anonymityMutation.isLoading}>
            {anonymityMutation.isLoading ? "Saving..." : "Save anonymity"}
          </Button>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={updateMutation.isLoading}>
          {updateMutation.isLoading ? "Saving..." : "Save criteria"}
        </Button>
        <Button variant="outline" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isLoading}>
          {deleteMutation.isLoading ? "Clearing..." : "Clear criteria"}
        </Button>
        {isLoading && <span className="text-xs text-[#737373]">Loading criteria...</span>}
      </div>
    </div>
  );
}
