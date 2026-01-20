import { Badge } from "@/components/ui/badge";
import {
  Clock,
  FileText,
  CheckCircle,
  Send,
  Users,
  Shield
} from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_CONFIG = {
  DRAFT_INGESTED: { label: "Draft", color: "bg-slate-100 text-slate-700", icon: Clock },
  OM_DRAFTED: { label: "OM Drafted", color: "bg-blue-100 text-blue-700", icon: FileText },
  OM_BROKER_APPROVED: { label: "Broker Approved", color: "bg-amber-100 text-amber-700", icon: CheckCircle },
  OM_APPROVED_FOR_MARKETING: { label: "Ready to Distribute", color: "bg-green-100 text-green-700", icon: Send },
  DISTRIBUTED: { label: "Distributed", color: "bg-purple-100 text-purple-700", icon: Users },
  ACTIVE_DD: { label: "Active DD", color: "bg-emerald-100 text-emerald-700", icon: Shield }
};

export function StatusBadge({ status, showIcon = true, className }) {
  const config = STATUS_CONFIG[status] || {
    label: status,
    color: "bg-gray-100 text-gray-700"
  };
  const Icon = config.icon;

  return (
    <Badge className={cn(config.color, "font-medium", className)}>
      {showIcon && Icon && <Icon className="w-3 h-3 mr-1" />}
      {config.label}
    </Badge>
  );
}
