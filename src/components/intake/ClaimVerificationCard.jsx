import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Edit2, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { debugLog } from "@/lib/debug";

const CONFIDENCE_COLORS = {
  high: "bg-green-100 text-green-700",
  medium: "bg-amber-100 text-amber-700",
  low: "bg-red-100 text-red-700"
};

export function ClaimVerificationCard({ claim, onVerify, isVerifying }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [correctedValue, setCorrectedValue] = useState("");

  const confidenceValue = claim.extraction?.confidence ?? 0;
  const confidenceLevel =
    confidenceValue >= 0.8 ? "high" : confidenceValue >= 0.5 ? "medium" : "low";
  const status = claim.verification?.status ?? claim.status;

  const handleConfirm = () => {
    debugLog("intake", "Claim confirmed", { claimId: claim.id });
    onVerify({ action: "confirm" });
  };

  const handleReject = () => {
    debugLog("intake", "Claim rejected", { claimId: claim.id });
    onVerify({ action: "reject", rejectionReason: "Incorrect value" });
  };

  const handleCorrect = () => {
    debugLog("intake", "Claim corrected", { claimId: claim.id });
    onVerify({ action: "confirm", correctedValue });
    setIsEditing(false);
    setCorrectedValue("");
  };

  return (
    <Card
      className={cn(
        "transition-all",
        status === "BROKER_CONFIRMED" && "border-green-200 bg-green-50/30",
        status === "REJECTED" && "border-red-200 bg-red-50/30"
      )}
    >
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-sm font-medium text-gray-500">
                {claim.fieldLabel || claim.field}
              </span>
              <Badge className={CONFIDENCE_COLORS[confidenceLevel]}>
                {Math.round(confidenceValue * 100)}%
              </Badge>
              {status === "BROKER_CONFIRMED" && (
                <Badge className="bg-green-100 text-green-700">Verified</Badge>
              )}
            </div>

            {isEditing ? (
              <div className="flex gap-2 mt-2">
                <Input
                  value={correctedValue}
                  onChange={(event) => setCorrectedValue(event.target.value)}
                  placeholder={`Current: ${claim.displayValue || claim.value}`}
                  className="flex-1"
                />
                <Button size="sm" onClick={handleCorrect} disabled={!correctedValue}>
                  Save
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <p className="text-lg font-semibold text-gray-900">
                {claim.displayValue || claim.value}
              </p>
            )}
          </div>

          {status === "UNVERIFIED" && !isEditing && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => setIsEditing(true)} title="Edit">
                <Edit2 className="w-4 h-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleConfirm}
                disabled={isVerifying}
                title="Confirm"
              >
                <CheckCircle className="w-4 h-4 text-green-600" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleReject}
                disabled={isVerifying}
                title="Reject"
              >
                <XCircle className="w-4 h-4 text-red-600" />
              </Button>
            </div>
          )}
        </div>

        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-1 text-xs text-gray-400 mt-3 hover:text-gray-600"
        >
          <FileText className="w-3 h-3" />
          <span>Source: {claim.source?.documentName || "Unknown"}</span>
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {isExpanded && claim.source && (
          <div className="mt-2 p-2 bg-gray-50 rounded text-xs text-gray-600">
            <p>
              <strong>Document:</strong> {claim.source.documentName}
            </p>
            <p>
              <strong>Location:</strong> {claim.source.location || "N/A"}
            </p>
            <p>
              <strong>Method:</strong> {claim.extraction?.method}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
