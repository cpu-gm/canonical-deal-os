import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, CheckCircle, XCircle, Clock, MessageSquare, Shield } from "lucide-react";
import { AIScoreBadge } from "./AIScoreBadge";
import { formatDistanceToNow } from "date-fns";
import { debugLog } from "@/lib/debug";

const RESPONSE_CONFIG = {
  INTERESTED: { label: "Interested", color: "bg-green-100 text-green-700", icon: CheckCircle },
  PASS: { label: "Passed", color: "bg-gray-100 text-gray-700", icon: XCircle },
  INTERESTED_WITH_CONDITIONS: { label: "Interested w/ Conditions", color: "bg-amber-100 text-amber-700", icon: Clock }
};

export function BuyerResponseCard({
  response,
  authorization,
  buyer,
  aiScore,
  onAuthorize,
  onDecline,
  onSendNDA,
  isAnonymous = false
}) {
  const config = RESPONSE_CONFIG[response.response] || RESPONSE_CONFIG.INTERESTED;
  const Icon = config.icon;
  const showActions =
    response.response !== "PASS" && (!authorization || authorization.status === "PENDING");

  const handleAuthorize = () => {
    debugLog("distribution", "Authorize buyer", { buyerId: buyer?.id });
    onAuthorize?.();
  };

  const handleDecline = () => {
    debugLog("distribution", "Decline buyer", { buyerId: buyer?.id });
    onDecline?.();
  };

  const handleSendNDA = () => {
    debugLog("distribution", "Send NDA", { buyerId: buyer?.id });
    onSendNDA?.();
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-gray-400" />
              <span className="font-medium">
                {isAnonymous
                  ? buyer?.anonymousLabel || "Anonymous Buyer"
                  : buyer?.firmName || buyer?.name || "Unknown Buyer"}
              </span>
            </div>
            {!isAnonymous && buyer?.email && (
              <p className="text-sm text-gray-500 ml-6">{buyer.email}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {aiScore !== undefined && <AIScoreBadge score={aiScore} />}
            <Badge className={config.color}>
              <Icon className="w-3 h-3 mr-1" />
              {config.label}
            </Badge>
          </div>
        </div>

        {response.questionsForBroker?.length > 0 && (
          <div className="mb-3 p-2 bg-blue-50 rounded">
            <div className="flex items-center gap-1 text-xs text-blue-600 mb-1">
              <MessageSquare className="w-3 h-3" />
              Questions for broker
            </div>
            <ul className="text-sm text-gray-700 list-disc list-inside">
              {response.questionsForBroker.map((question, index) => (
                <li key={index}>{question}</li>
              ))}
            </ul>
          </div>
        )}

        {response.conditions?.length > 0 && (
          <div className="mb-3 p-2 bg-amber-50 rounded">
            <div className="text-xs text-amber-600 mb-1">Conditions</div>
            <ul className="text-sm text-gray-700 list-disc list-inside">
              {response.conditions.map((condition, index) => (
                <li key={index}>{condition}</li>
              ))}
            </ul>
          </div>
        )}

        {response.indicativePriceMin && response.indicativePriceMax && (
          <p className="text-sm text-gray-600 mb-3">
            <strong>Indicative range:</strong> ${response.indicativePriceMin.toLocaleString()} - $
            {response.indicativePriceMax.toLocaleString()}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {formatDistanceToNow(new Date(response.respondedAt), { addSuffix: true })}
          </span>

          {authorization?.status === "AUTHORIZED" ? (
            <div className="flex items-center gap-2">
              <Badge className="bg-green-100 text-green-700">
                <Shield className="w-3 h-3 mr-1" />
                Authorized
              </Badge>
              {authorization.ndaStatus === "NOT_SENT" && (
                <Button size="sm" variant="outline" onClick={handleSendNDA}>
                  Send NDA
                </Button>
              )}
              {authorization.ndaStatus === "SENT" && (
                <Badge className="bg-blue-100 text-blue-700">NDA Sent</Badge>
              )}
              {authorization.ndaStatus === "SIGNED" && (
                <Badge className="bg-emerald-100 text-emerald-700">NDA Signed</Badge>
              )}
            </div>
          ) : showActions ? (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleDecline}>
                Decline
              </Button>
              <Button size="sm" onClick={handleAuthorize}>
                Authorize
              </Button>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
