import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain } from "lucide-react";
import { cn } from "@/lib/utils";

export function AIScoreBadge({ score, breakdown, className }) {
  const getColorClass = (value) => {
    if (value >= 80) return "bg-green-100 text-green-700 border-green-200";
    if (value >= 60) return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-red-100 text-red-700 border-red-200";
  };

  const badge = (
    <Badge className={cn("border", getColorClass(score), className)}>
      <Brain className="w-3 h-3 mr-1" />
      {score}
    </Badge>
  );

  if (!breakdown) return badge;

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{badge}</TooltipTrigger>
        <TooltipContent className="max-w-xs">
          <p className="font-medium mb-1">AI Triage Score</p>
          <ul className="text-xs space-y-1">
            {breakdown.map((item, index) => (
              <li key={index} className="flex justify-between gap-4">
                <span>{item.criterion}</span>
                <span className="font-mono">{item.score}</span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
