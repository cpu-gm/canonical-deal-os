import { Card, CardContent } from "@/components/ui/card";
import { Building2, Clock } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { formatDistanceToNow } from "date-fns";
import { createPageUrl } from "@/utils";
import { useNavigate } from "react-router-dom";
import { debugLog } from "@/lib/debug";

export function DealDraftCard({ draft }) {
  const navigate = useNavigate();

  const handleClick = () => {
    debugLog("intake", "Navigate to draft detail", { draftId: draft.id });
    navigate(createPageUrl(`DealDraftDetail?id=${draft.id}`));
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow"
      onClick={handleClick}
    >
      <CardContent className="pt-4">
        <div className="flex justify-between items-start mb-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gray-400" />
            <h3 className="font-medium text-gray-900 truncate">
              {draft.propertyName || draft.propertyAddress || "Untitled Deal"}
            </h3>
          </div>
          <StatusBadge status={draft.status} />
        </div>

        {draft.propertyAddress && (
          <p className="text-sm text-gray-500 mb-3 truncate">{draft.propertyAddress}</p>
        )}

        <div className="flex items-center justify-between text-xs text-gray-400">
          <div className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            <span>{formatDistanceToNow(new Date(draft.updatedAt), { addSuffix: true })}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
