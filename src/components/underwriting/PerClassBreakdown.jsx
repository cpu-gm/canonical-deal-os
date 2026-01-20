import React, { useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Color mapping for share classes
const CLASS_COLORS = {
  'A': { bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700', accent: 'bg-green-100' },
  'B': { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700', accent: 'bg-blue-100' },
  'P': { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', accent: 'bg-violet-100' },
  'C': { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', accent: 'bg-orange-100' },
  'PREF': { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', accent: 'bg-violet-100' },
  'default': { bg: 'bg-gray-50', border: 'border-gray-200', text: 'text-gray-700', accent: 'bg-gray-100' }
};

function formatCurrency(value) {
  if (!value && value !== 0) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
}

function ClassCard({ code, data, colors }) {
  return (
    <Card className={cn("border-2", colors.border, colors.bg)}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className={cn("text-base font-semibold", colors.text)}>
            {data.className || `Class ${code}`}
          </CardTitle>
          <Badge className={colors.accent}>
            {data.lpCount} LP{data.lpCount !== 1 ? 's' : ''}
          </Badge>
        </div>
        {data.preferredReturn !== null && data.preferredReturn !== undefined && (
          <CardDescription>
            {(data.preferredReturn * 100).toFixed(1)}% Preferred Return
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {/* Total Distributed */}
          <div className="flex justify-between items-baseline">
            <span className="text-sm text-gray-600">Distributed</span>
            <span className={cn("text-lg font-bold", colors.text)}>
              {formatCurrency(data.totalDistributed)}
            </span>
          </div>

          {/* Breakdown */}
          <div className="text-xs space-y-1 pt-2 border-t">
            <div className="flex justify-between">
              <span className="text-gray-500">Pref Paid</span>
              <span>{formatCurrency(data.prefPaid || 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Capital Returned</span>
              <span>{formatCurrency(data.capitalReturned || 0)}</span>
            </div>
          </div>

          {/* Equity Multiple */}
          {data.equityMultiple && (
            <div className="pt-2 border-t">
              <div className="flex justify-between items-baseline">
                <span className="text-xs text-gray-500">Equity Multiple</span>
                <span className={cn("font-semibold", colors.text)}>
                  {data.equityMultiple.toFixed(2)}x
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function PerClassBreakdown({ byClass, totalAmount }) {
  // Debug logging
  useEffect(() => {
    if (byClass && Object.keys(byClass).length > 0) {
      console.log('[PerClassBreakdown] Rendering', {
        classCount: Object.keys(byClass).length,
        classCodes: Object.keys(byClass),
        totalAmount,
        totalDistributed: Object.values(byClass).reduce((s, c) => s + (c.totalDistributed || 0), 0)
      });
    }
  }, [byClass, totalAmount]);

  if (!byClass || Object.keys(byClass).length === 0) {
    console.log('[PerClassBreakdown] No byClass data, not rendering');
    return null;
  }

  const classes = Object.entries(byClass);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">Distribution by Share Class</h4>
        <Badge variant="outline">{classes.length} Class{classes.length !== 1 ? 'es' : ''}</Badge>
      </div>

      <div className={cn(
        "grid gap-4",
        classes.length === 2 ? "grid-cols-2" :
        classes.length >= 3 ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" :
        "grid-cols-1"
      )}>
        {classes.map(([code, data]) => (
          <ClassCard
            key={code}
            code={code}
            data={data}
            colors={CLASS_COLORS[code] || CLASS_COLORS.default}
          />
        ))}
      </div>
    </div>
  );
}

export default PerClassBreakdown;
