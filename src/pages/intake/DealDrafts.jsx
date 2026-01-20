import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Search, FolderOpen } from "lucide-react";
import { DealDraftCard } from "@/components/intake/DealDraftCard";
import { useIntakeDashboard } from "@/lib/hooks/useIntakeDashboard";
import { createPageUrl } from "@/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { debugLog } from "@/lib/debug";

export default function DealDrafts() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { drafts, isLoading, derivedStats } = useIntakeDashboard(
    statusFilter !== "all" ? { status: statusFilter } : {}
  );

  const filteredDrafts = drafts.filter((draft) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      draft.propertyName?.toLowerCase().includes(query) ||
      draft.propertyAddress?.toLowerCase().includes(query)
    );
  });

  const handleCreate = () => {
    debugLog("intake", "Navigate to create draft");
    navigate(createPageUrl("CreateDealDraft"));
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((value) => (
            <Skeleton key={value} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Deal Intake</h1>
        <Button onClick={handleCreate}>
          <Plus className="w-4 h-4 mr-2" />
          New Deal Draft
        </Button>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input
            placeholder="Search deals..."
            className="pl-9"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList>
            <TabsTrigger value="all">All ({derivedStats.total})</TabsTrigger>
            <TabsTrigger value="DRAFT_INGESTED">Drafts ({derivedStats.inDraft})</TabsTrigger>
            <TabsTrigger value="OM_DRAFTED">OM Drafted ({derivedStats.omDrafted})</TabsTrigger>
            <TabsTrigger value="DISTRIBUTED">Distributed ({derivedStats.distributed})</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {filteredDrafts.length === 0 ? (
        <div className="py-12 text-center">
          <FolderOpen className="w-12 h-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No deals found</h3>
          <p className="text-sm text-gray-500 mb-4">
            {searchQuery ? "Try a different search term" : "Create your first deal draft to get started"}
          </p>
          <Button onClick={handleCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Create Deal Draft
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredDrafts.map((draft) => (
            <DealDraftCard key={draft.id} draft={draft} />
          ))}
        </div>
      )}
    </div>
  );
}
