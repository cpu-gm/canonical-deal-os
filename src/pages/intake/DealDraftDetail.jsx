import { useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/intake/StatusBadge";
import { DocumentUploader } from "@/components/intake/DocumentUploader";
import { ClaimVerificationCard } from "@/components/intake/ClaimVerificationCard";
import { ConflictResolutionCard } from "@/components/intake/ConflictResolutionCard";
import { useIntakeDealOverview } from "@/lib/hooks/useIntakeDealOverview";
import { bff } from "@/api/bffClient";
import { createPageUrl } from "@/utils";
import { debugLog } from "@/lib/debug";
import { toast } from "@/components/ui/use-toast";

export default function DealDraftDetail() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const draftId = searchParams.get("id");

  const {
    draft,
    claims,
    conflicts,
    stats,
    uiStage,
    isLoading,
    verifyClaimMutation,
    resolveConflictMutation
  } = useIntakeDealOverview(draftId);

  const omQuery = useQuery({
    queryKey: ["omLatest", draftId],
    queryFn: () => bff.om.getLatest(draftId),
    enabled: !!draftId,
    onSuccess: (data) => {
      debugLog("om", "Latest OM loaded", { draftId, omId: data?.id });
    },
    onError: (error) => {
      debugLog("om", "Latest OM load failed", { draftId, message: error?.message });
    }
  });

  const generateMutation = useMutation({
    mutationFn: () => bff.om.generate(draftId, false),
    onSuccess: () => {
      debugLog("om", "OM generated", { draftId });
      queryClient.invalidateQueries(["omLatest", draftId]);
      queryClient.invalidateQueries(["intakeDraft", draftId]);
    },
    onError: (error) => {
      debugLog("om", "OM generate failed", { draftId, message: error?.message });
      toast({
        title: "OM generation failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const uploadMutation = useMutation({
    mutationFn: (documents) => bff.dealIntake.uploadDocuments(draftId, documents),
    onSuccess: () => {
      debugLog("intake", "Documents uploaded", { draftId });
      queryClient.invalidateQueries(["intakeDraft", draftId]);
    },
    onError: (error) => {
      debugLog("intake", "Upload failed", { draftId, message: error?.message });
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const handleDocumentsReady = (docs) => {
    const withStorageKeys = docs.map((doc, index) => ({
      ...doc,
      storageKey: doc.storageKey || `mock/${draftId}/${index}-${doc.filename}`
    }));
    uploadMutation.mutate(withStorageKeys);
  };

  const handleVerifyClaim = (claimId, payload) => {
    verifyClaimMutation.mutate({ claimId, payload });
  };

  const handleResolveConflict = (conflictId, payload) => {
    resolveConflictMutation.mutate({ conflictId, payload });
  };

  const omSections = useMemo(() => {
    const content = omQuery.data?.content;
    if (!content?.sections) return [];
    return Object.values(content.sections);
  }, [omQuery.data]);

  if (!draftId) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-gray-500">Missing deal draft id.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {draft?.propertyName || draft?.propertyAddress || "Untitled Deal"}
          </h1>
          {draft?.propertyAddress && (
            <p className="text-sm text-gray-500 mt-1">{draft.propertyAddress}</p>
          )}
        </div>
        {draft?.status && <StatusBadge status={draft.status} />}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="conflicts">Conflicts</TabsTrigger>
          <TabsTrigger value="om">OM Preview</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deal summary</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <div className="text-gray-500">Asset Type</div>
                <div>{draft?.assetType || "Not set"}</div>
              </div>
              <div>
                <div className="text-gray-500">Asking Price</div>
                <div>{draft?.askingPrice ? `$${draft.askingPrice.toLocaleString()}` : "Not set"}</div>
              </div>
              <div>
                <div className="text-gray-500">Units</div>
                <div>{draft?.unitCount || "Not set"}</div>
              </div>
              <div>
                <div className="text-gray-500">Total SF</div>
                <div>{draft?.totalSF || "Not set"}</div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Workflow status</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3 items-center">
              <Badge variant="outline">
                Unverified fields: {stats?.fieldsNeedingVerification?.length || 0}
              </Badge>
              <Badge variant="outline">Open conflicts: {conflicts.length}</Badge>
              {uiStage?.canGenerateOM && (
                <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
                  {generateMutation.isPending ? "Generating..." : "Generate OM Draft"}
                </Button>
              )}
              {omQuery.data?.id && (
                <Button variant="outline" onClick={() => navigate(createPageUrl(`OMEditor?dealDraftId=${draftId}`))}>
                  Open OM Editor
                </Button>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload documents</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUploader
                onDocumentsReady={handleDocumentsReady}
                isUploading={uploadMutation.isPending}
              />
            </CardContent>
          </Card>

          {draft?.documents?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Existing documents</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {draft.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{doc.originalFilename || doc.filename}</div>
                      <div className="text-xs text-gray-500">{doc.classifiedType || "Unclassified"}</div>
                    </div>
                    <Badge variant="outline">{doc.status}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="claims" className="space-y-3">
          {claims.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-gray-500">No claims found.</CardContent>
            </Card>
          ) : (
            claims.map((claim) => (
              <ClaimVerificationCard
                key={claim.id}
                claim={claim}
                onVerify={(payload) => handleVerifyClaim(claim.id, payload)}
                isVerifying={verifyClaimMutation.isPending}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="conflicts" className="space-y-3">
          {conflicts.length === 0 ? (
            <Card>
              <CardContent className="p-6 text-sm text-gray-500">No conflicts found.</CardContent>
            </Card>
          ) : (
            conflicts.map((conflict) => (
              <ConflictResolutionCard
                key={conflict.id}
                conflict={conflict}
                onResolve={(payload) => handleResolveConflict(conflict.id, payload)}
                isResolving={resolveConflictMutation.isPending}
              />
            ))
          )}
        </TabsContent>

        <TabsContent value="om" className="space-y-4">
          {omQuery.isLoading ? (
            <Skeleton className="h-32" />
          ) : omQuery.data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    OM Version {omQuery.data.versionNumber} ({omQuery.data.status})
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {omSections.map((section) => (
                    <div key={section.id} className="border rounded p-3">
                      <div className="font-medium">{section.title}</div>
                      <div className="text-sm text-gray-600 mt-1 line-clamp-3">
                        {section.content || "No content yet."}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-gray-500">
                No OM generated yet. Generate a draft to preview.
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
