import { useState } from "react";
import { AlertCircle, RefreshCw, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PageError({ error, title = "Something went wrong", message, onRetry, className }) {
  const [copied, setCopied] = useState(false);
  const safeMessage =
    message || error?.userSafeMessage || error?.message || "Please try again.";

  const showDebug = Boolean(import.meta.env?.DEV && error?.debugDetails);
  const debugText = showDebug
    ? JSON.stringify(
        {
          endpoint: error?.endpoint,
          status: error?.status,
          code: error?.code,
          details: error?.debugDetails
        },
        null,
        2
      )
    : "";

  const handleCopy = async () => {
    if (!debugText) return;
    try {
      await navigator.clipboard.writeText(debugText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className={cn("bg-white rounded-xl border border-[#E5E5E5] p-6", className)}>
      <div className="flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold text-[#171717]">{title}</h3>
          <p className="text-sm text-[#737373] mt-1">{safeMessage}</p>
          <div className="flex items-center gap-2 mt-4">
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try again
              </Button>
            )}
          </div>
          {showDebug && (
            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#737373]">Debug details (dev only)</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 text-xs text-[#525252] hover:text-[#171717]"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="text-xs text-[#525252] bg-[#FAFAFA] border border-[#E5E5E5] rounded-lg p-3 overflow-auto">
                {debugText}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
