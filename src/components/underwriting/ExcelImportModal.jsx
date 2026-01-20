import React, { useState, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  FileSpreadsheet,
  Upload,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  X,
  RefreshCw,
  Table
} from 'lucide-react';

export default function ExcelImportModal({ dealId, open, onClose, onSuccess }) {
  const [file, setFile] = useState(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [isUploading, setIsUploading] = useState(false);

  // Fetch mappable fields
  const { data: fieldsData } = useQuery({
    queryKey: ['mappable-fields'],
    queryFn: () => bff.underwriting.getMappableFields()
  });

  const applyMutation = useMutation({
    mutationFn: (importId) => bff.underwriting.applyExcelImport(importId),
    onSuccess: (data) => {
      toast({
        title: 'Excel import applied',
        description: `${data.applied?.length || 0} fields applied to model.`
      });
      onSuccess();
    },
    onError: (error) => {
      toast({ title: 'Apply failed', description: error.message, variant: 'destructive' });
    }
  });

  const handleDrag = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  }, []);

  const handleFileInput = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  const handleFile = async (selectedFile) => {
    // Validate file type
    if (!selectedFile.name.match(/\.(xlsx|xls)$/i)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an Excel file (.xlsx or .xls)',
        variant: 'destructive'
      });
      return;
    }

    setFile(selectedFile);
    setIsUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch(`/api/deals/${dealId}/excel-import`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();
      setUploadResult(result);
      toast({ title: 'Excel parsed', description: `Found ${Object.keys(result.mappings || {}).length} mappable fields.` });
    } catch (error) {
      toast({ title: 'Upload failed', description: error.message, variant: 'destructive' });
      setFile(null);
    } finally {
      setIsUploading(false);
    }
  };

  const handleApply = () => {
    if (uploadResult?.import?.id) {
      applyMutation.mutate(uploadResult.import.id);
    }
  };

  const reset = () => {
    setFile(null);
    setUploadResult(null);
  };

  if (!open) return null;

  const mappings = uploadResult?.mappings || {};
  const unmapped = uploadResult?.unmapped || [];
  const stats = uploadResult?.stats || {};

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#E5E5E5]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-50">
              <FileSpreadsheet className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Import Excel Model</h2>
              <p className="text-sm text-[#737373]">
                Upload a financial model to auto-populate underwriting fields
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {!uploadResult ? (
            /* Upload zone */
            <div
              className={cn(
                "border-2 border-dashed rounded-xl p-8 text-center transition-all",
                dragActive ? "border-green-500 bg-green-50" : "border-[#E5E5E5]",
                isUploading && "opacity-50 pointer-events-none"
              )}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
            >
              {isUploading ? (
                <>
                  <RefreshCw className="w-12 h-12 text-green-500 mx-auto mb-4 animate-spin" />
                  <p className="text-sm text-[#737373]">Parsing Excel file...</p>
                </>
              ) : (
                <>
                  <Upload className="w-12 h-12 text-[#A3A3A3] mx-auto mb-4" />
                  <p className="text-lg font-medium text-[#171717] mb-2">
                    Drop your Excel file here
                  </p>
                  <p className="text-sm text-[#737373] mb-4">
                    or click to browse
                  </p>
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                    id="excel-upload"
                  />
                  <label htmlFor="excel-upload">
                    <Button variant="outline" className="cursor-pointer" asChild>
                      <span>Select File</span>
                    </Button>
                  </label>
                  <p className="text-xs text-[#A3A3A3] mt-4">
                    Supports .xlsx and .xls files
                  </p>
                </>
              )}
            </div>
          ) : (
            /* Mapping results */
            <div className="space-y-4">
              {/* File info */}
              <div className="flex items-center justify-between p-3 bg-[#FAFAFA] rounded-lg">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-green-600" />
                  <div>
                    <div className="font-medium text-sm">{file?.name}</div>
                    <div className="text-xs text-[#737373]">
                      {uploadResult.sheets?.length || 0} sheets · {uploadResult.cellCount || 0} cells
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={reset}>
                  Change File
                </Button>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <StatBox
                  icon={CheckCircle2}
                  label="Mapped"
                  value={stats.mapped || 0}
                  color="green"
                />
                <StatBox
                  icon={AlertTriangle}
                  label="Unmapped"
                  value={stats.unmapped || 0}
                  color="amber"
                />
                <StatBox
                  icon={Table}
                  label="Confidence"
                  value={`${Math.round((stats.confidence || 0) * 100)}%`}
                  color="blue"
                />
              </div>

              {/* Mapping table */}
              <div className="border border-[#E5E5E5] rounded-lg overflow-hidden">
                <div className="bg-[#FAFAFA] px-4 py-2 border-b border-[#E5E5E5]">
                  <h3 className="text-sm font-medium">Field Mappings</h3>
                </div>
                <div className="max-h-64 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-[#FAFAFA] sticky top-0">
                      <tr>
                        <th className="text-left px-4 py-2 font-medium text-[#737373]">Field</th>
                        <th className="text-left px-4 py-2 font-medium text-[#737373]">Cell</th>
                        <th className="text-right px-4 py-2 font-medium text-[#737373]">Value</th>
                        <th className="text-center px-4 py-2 font-medium text-[#737373]">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(mappings).map(([field, mapping]) => (
                        <tr key={field} className="border-t border-[#F5F5F5]">
                          <td className="px-4 py-2">
                            <div className="font-medium">{mapping.metadata?.label || field}</div>
                            <div className="text-xs text-[#A3A3A3]">{mapping.label}</div>
                          </td>
                          <td className="px-4 py-2 text-[#737373]">
                            {mapping.sheet}!{mapping.cell}
                          </td>
                          <td className="px-4 py-2 text-right font-mono">
                            {formatValue(mapping.value, mapping.metadata?.type)}
                          </td>
                          <td className="px-4 py-2 text-center">
                            {mapping.confidence >= 0.9 ? (
                              <CheckCircle2 className="w-4 h-4 text-green-500 inline" />
                            ) : mapping.confidence >= 0.7 ? (
                              <AlertTriangle className="w-4 h-4 text-amber-500 inline" />
                            ) : (
                              <XCircle className="w-4 h-4 text-red-500 inline" />
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Unmapped fields */}
              {unmapped.length > 0 && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <div className="flex items-center gap-2 text-amber-700 text-sm font-medium mb-2">
                    <AlertTriangle className="w-4 h-4" />
                    {unmapped.length} fields not auto-mapped
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {unmapped.slice(0, 10).map(item => (
                      <Badge key={item.field} variant="outline" className="text-xs">
                        {item.metadata?.label || item.field}
                      </Badge>
                    ))}
                    {unmapped.length > 10 && (
                      <Badge variant="outline" className="text-xs">
                        +{unmapped.length - 10} more
                      </Badge>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {uploadResult && (
          <div className="flex items-center justify-between p-4 border-t border-[#E5E5E5] bg-[#FAFAFA]">
            <p className="text-sm text-[#737373]">
              Ready to apply {Object.keys(mappings).length} fields to your model
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                onClick={handleApply}
                disabled={applyMutation.isPending || Object.keys(mappings).length === 0}
                className="gap-2"
              >
                {applyMutation.isPending ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowRight className="w-4 h-4" />
                )}
                Apply to Model
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function StatBox({ icon: Icon, label, value, color }) {
  const colorMap = {
    green: 'bg-green-50 text-green-600 border-green-100',
    amber: 'bg-amber-50 text-amber-600 border-amber-100',
    blue: 'bg-blue-50 text-blue-600 border-blue-100'
  };

  return (
    <div className={cn("p-3 rounded-lg border", colorMap[color])}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs">{label}</span>
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function formatValue(value, type) {
  if (value === null || value === undefined) return '—';

  switch (type) {
    case 'currency':
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
      }).format(value);
    case 'percentage':
      return `${(value * 100).toFixed(2)}%`;
    case 'ratio':
    case 'multiple':
      return `${value.toFixed(2)}x`;
    case 'years':
      return `${value} yrs`;
    default:
      if (typeof value === 'number') {
        return value.toLocaleString();
      }
      return String(value);
  }
}
