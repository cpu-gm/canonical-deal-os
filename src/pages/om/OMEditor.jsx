import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { OMSectionEditor } from "@/components/om/OMSectionEditor";
import { bff } from "@/api/bffClient";
import { debugLog } from "@/lib/debug";
import { toast } from "@/components/ui/use-toast";
import { PageError } from "@/components/ui/page-state";

export default function OMEditor() {
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const dealDraftId = searchParams.get("dealDraftId");
  const [selectedSectionId, setSelectedSectionId] = useState(null);
  const [changeRequest, setChangeRequest] = useState("");

  const sectionsQuery = useQuery({
    queryKey: ["omSections"],
    queryFn: () => bff.om.getSections(),
    onSuccess: (data) => {
      debugLog("om", "Sections loaded", { count: data?.sections?.length ?? 0 });
    },
    onError: (error) => {
      debugLog("om", "Sections load failed", { message: error?.message });
    }
  });

  const omQuery = useQuery({
    queryKey: ["omLatest", dealDraftId],
    queryFn: () => bff.om.getLatest(dealDraftId),
    enabled: !!dealDraftId,
    onSuccess: (data) => {
      debugLog("om", "OM loaded", { dealDraftId, omId: data?.id });
    },
    onError: (error) => {
      debugLog("om", "OM load failed", { dealDraftId, message: error?.message });
    }
  });

  const versionsQuery = useQuery({
    queryKey: ["omVersions", dealDraftId],
    queryFn: () => bff.om.listVersions(dealDraftId),
    enabled: !!dealDraftId,
    onError: (error) => {
      debugLog("om", "OM versions load failed", { dealDraftId, message: error?.message });
    }
  });

  useEffect(() => {
    const sections = sectionsQuery.data?.sections ?? [];
    if (!selectedSectionId && sections.length > 0) {
      setSelectedSectionId(sections[0].id);
    }
  }, [sectionsQuery.data, selectedSectionId]);

  const selectedSection = useMemo(() => {
    const sections = sectionsQuery.data?.sections ?? [];
    return sections.find((section) => section.id === selectedSectionId);
  }, [sectionsQuery.data, selectedSectionId]);

  const sectionContent = useMemo(() => {
    const content = omQuery.data?.content?.sections?.[selectedSectionId];
    return content?.content || "";
  }, [omQuery.data, selectedSectionId]);

  const updateSectionMutation = useMutation({
    mutationFn: ({ omVersionId, sectionId, content }) =>
      bff.om.updateSection(omVersionId, sectionId, content),
    onSuccess: () => {
      queryClient.invalidateQueries(["omLatest", dealDraftId]);
      queryClient.invalidateQueries(["omVersions", dealDraftId]);
    },
    onError: (error) => {
      toast({
        title: "Save failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const generateMutation = useMutation({
    mutationFn: () => bff.om.generate(dealDraftId, false),
    onSuccess: () => {
      queryClient.invalidateQueries(["omLatest", dealDraftId]);
      queryClient.invalidateQueries(["omVersions", dealDraftId]);
    },
    onError: (error) => {
      toast({
        title: "Generate failed",
        description: error.message,
        variant: "destructive"
      });
    }
  });

  const brokerApproveMutation = useMutation({
    mutationFn: (omVersionId) => bff.om.brokerApprove(omVersionId),
    onSuccess: () => {
      queryClient.invalidateQueries(["omLatest", dealDraftId]);
      queryClient.invalidateQueries(["omVersions", dealDraftId]);
    }
  });

  const sellerApproveMutation = useMutation({
    mutationFn: (omVersionId) => bff.om.sellerApprove(omVersionId),
    onSuccess: () => {
      queryClient.invalidateQueries(["omLatest", dealDraftId]);
      queryClient.invalidateQueries(["omVersions", dealDraftId]);
    }
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({ omVersionId, feedback }) => bff.om.requestChanges(omVersionId, feedback),
    onSuccess: () => {
      setChangeRequest("");
      queryClient.invalidateQueries(["omLatest", dealDraftId]);
      queryClient.invalidateQueries(["omVersions", dealDraftId]);
    },
    onError: (error) => {
      toast({
        title: "Request failed",
        description: error.message,
        variant: "destructive"
      });
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

  const error = sectionsQuery.error || omQuery.error || versionsQuery.error;
  if (error) {
    return (
      <div className="p-6">
        <PageError
          error={error}
          onRetry={() => {
            sectionsQuery.refetch();
            omQuery.refetch();
            versionsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (sectionsQuery.isLoading) {
    return (
      <div className="p-6">
        <Skeleton className="h-8 w-40" />
      </div>
    );
  }

  const omVersion = omQuery.data;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">OM Editor</h1>
          {omVersion && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span>Version {omVersion.versionNumber}</span>
              <Badge variant="outline">{omVersion.status}</Badge>
            </div>
          )}
        </div>
        {!omVersion && (
          <Button onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? "Generating..." : "Generate OM Draft"}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-4">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Sections</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(sectionsQuery.data?.sections ?? []).map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setSelectedSectionId(section.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm ${
                  selectedSectionId === section.id
                    ? "bg-blue-50 text-blue-700"
                    : "hover:bg-gray-100"
                }`}
              >
                {section.title}
                {section.required && <span className="text-xs text-gray-400 ml-1">*</span>}
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          {omVersion && selectedSection ? (
            <OMSectionEditor
              section={selectedSection}
              content={sectionContent}
              onSave={(value) =>
                updateSectionMutation.mutate({
                  omVersionId: omVersion.id,
                  sectionId: selectedSection.id,
                  content: value
                })
              }
              isSaving={updateSectionMutation.isPending}
              isEditable={omVersion.status === "DRAFT"}
            />
          ) : (
            <Card>
              <CardContent className="p-6 text-sm text-gray-500">
                Generate an OM to start editing.
              </CardContent>
            </Card>
          )}

          {omVersion && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Approvals</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 items-center">
                <Button
                  variant="outline"
                  onClick={() => brokerApproveMutation.mutate(omVersion.id)}
                  disabled={brokerApproveMutation.isPending || omVersion.status !== "DRAFT"}
                >
                  Broker Approve
                </Button>
                <Button
                  onClick={() => sellerApproveMutation.mutate(omVersion.id)}
                  disabled={sellerApproveMutation.isPending || omVersion.status !== "BROKER_APPROVED"}
                >
                  Seller Approve
                </Button>
              </CardContent>
            </Card>
          )}

          {omVersion && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Request changes</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Textarea
                  value={changeRequest}
                  onChange={(event) => setChangeRequest(event.target.value)}
                  placeholder="Feedback for the broker..."
                  rows={3}
                />
                <Button
                  variant="outline"
                  onClick={() =>
                    requestChangesMutation.mutate({
                      omVersionId: omVersion.id,
                      feedback: changeRequest
                    })
                  }
                  disabled={!changeRequest || requestChangesMutation.isPending}
                >
                  Send Feedback
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Version history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(versionsQuery.data?.versions ?? []).length === 0 ? (
            <div className="text-gray-500">No versions yet.</div>
          ) : (
            versionsQuery.data?.versions?.map((version) => (
              <div key={version.id} className="flex items-center justify-between">
                <div>
                  <div className="font-medium">Version {version.versionNumber}</div>
                  <div className="text-xs text-gray-500">{new Date(version.createdAt).toLocaleString()}</div>
                </div>
                <Badge variant="outline">{version.status}</Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
