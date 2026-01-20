import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { AlertTriangle, FileText } from "lucide-react";
import { debugLog } from "@/lib/debug";

export function ConflictResolutionCard({ conflict, onResolve, isResolving }) {
  const [method, setMethod] = useState(null);
  const [manualValue, setManualValue] = useState("");
  const claims = Array.isArray(conflict.claims)
    ? conflict.claims
    : [conflict.claims?.a, conflict.claims?.b].filter(Boolean);

  const handleResolve = () => {
    const data = { method };
    if (method === "MANUAL_OVERRIDE") {
      data.resolvedValue = manualValue;
    }
    debugLog("intake", "Conflict resolved", { conflictId: conflict.id, method });
    onResolve(data);
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600" />
          Conflict: {conflict.fieldLabel || conflict.field}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4 mb-4">
          {claims.map((claim, idx) => (
            <div key={claim.id} className="p-3 bg-white rounded border">
              <div className="flex items-center gap-1 text-xs text-gray-400 mb-1">
                <FileText className="w-3 h-3" />
                {claim.source?.documentName || `Source ${idx + 1}`}
              </div>
              <p className="text-lg font-semibold">{claim.displayValue || claim.value}</p>
              <p className="text-xs text-gray-400">
                Confidence: {Math.round((claim.extraction?.confidence ?? 0) * 100)}%
              </p>
            </div>
          ))}
        </div>

        <RadioGroup value={method} onValueChange={setMethod} className="space-y-2">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="CHOSE_CLAIM_A" id="claimA" />
            <Label htmlFor="claimA">Use first source value</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="CHOSE_CLAIM_B" id="claimB" />
            <Label htmlFor="claimB">Use second source value</Label>
          </div>
          {conflict.field.includes("price") ||
          conflict.field.includes("rent") ||
          conflict.field.includes("noi") ? (
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="AVERAGED" id="avg" />
              <Label htmlFor="avg">Use average</Label>
            </div>
          ) : null}
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="MANUAL_OVERRIDE" id="manual" />
            <Label htmlFor="manual">Enter manually</Label>
          </div>
        </RadioGroup>

        {method === "MANUAL_OVERRIDE" && (
          <Input
            className="mt-2"
            placeholder="Enter correct value"
            value={manualValue}
            onChange={(event) => setManualValue(event.target.value)}
          />
        )}

        <Button
          className="w-full mt-4"
          onClick={handleResolve}
          disabled={!method || (method === "MANUAL_OVERRIDE" && !manualValue) || isResolving}
        >
          Resolve Conflict
        </Button>
      </CardContent>
    </Card>
  );
}
