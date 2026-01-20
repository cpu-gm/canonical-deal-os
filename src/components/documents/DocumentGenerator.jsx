import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { bff } from '@/api/bffClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";


import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  FileText,
  FileCheck,
  FilePlus,
  FileSignature,
  Download,
  CheckCircle2,
  Loader2,
  ArrowRight,
  Package,
  History,
  Shield,
  Sparkles
} from 'lucide-react';

const DOCUMENT_TYPES = {
  IC_MEMO: {
    label: 'IC Memo',
    description: 'Full investment committee memorandum with all deal analysis',
    icon: FileText,
    category: 'analysis'
  },
  DEAL_TEASER: {
    label: 'Deal Teaser',
    description: 'One-page executive summary for quick review',
    icon: FileText,
    category: 'analysis'
  },
  LOI: {
    label: 'Letter of Intent',
    description: 'Non-binding letter of intent with key terms',
    icon: FileSignature,
    category: 'legal'
  },
  PSA_SKELETON: {
    label: 'PSA Skeleton',
    description: 'Purchase and sale agreement template',
    icon: FileSignature,
    category: 'legal'
  },
  DD_REQUEST_LIST: {
    label: 'DD Request List',
    description: 'Due diligence document request checklist',
    icon: FileCheck,
    category: 'operations'
  },
  CLOSING_STATEMENT: {
    label: 'Closing Statement',
    description: 'ALTA-style settlement statement',
    icon: FileCheck,
    category: 'closing'
  },
  ESTOPPEL_REQUEST: {
    label: 'Estoppel Request',
    description: 'Tenant estoppel certificate template',
    icon: FileText,
    category: 'operations'
  },
  CLOSING_CHECKLIST: {
    label: 'Closing Checklist',
    description: 'Critical dates and tasks for closing',
    icon: FileCheck,
    category: 'closing'
  },
  EXPLAIN_APPENDIX: {
    label: 'Explain Appendix',
    description: 'Complete data provenance for all metrics',
    icon: Shield,
    category: 'compliance'
  }
};

const STATUS_CONFIG = {
  DRAFT: {
    label: 'Draft',
    color: 'bg-gray-100 text-gray-700 border-gray-200',
    icon: FileText
  },
  BINDING: {
    label: 'Binding',
    color: 'bg-blue-100 text-blue-700 border-blue-200',
    icon: FileSignature
  },
  EXECUTED: {
    label: 'Executed',
    color: 'bg-green-100 text-green-700 border-green-200',
    icon: CheckCircle2
  },
  EFFECTIVE: {
    label: 'Effective',
    color: 'bg-violet-100 text-violet-700 border-violet-200',
    icon: Shield
  }
};

const CATEGORY_LABELS = {
  analysis: 'Analysis',
  legal: 'Legal Documents',
  operations: 'Operations',
  closing: 'Closing',
  compliance: 'Compliance'
};

export default function DocumentGenerator({ dealId, dealName }) {
  const queryClient = useQueryClient();
  const [selectedDocType, setSelectedDocType] = useState(null);
  const [includeWatermark, setIncludeWatermark] = useState(true);
  const [showVersionHistory, setShowVersionHistory] = useState(null);

  // Fetch existing documents
  const { data: documentsData, isLoading: loadingDocs } = useQuery({
    queryKey: ['documents', dealId],
    queryFn: () => bff.documents.getVersions(dealId)
  });

  // Fetch evidence packs
  const { data: packsData } = useQuery({
    queryKey: ['evidencePacks', dealId],
    queryFn: () => bff.evidencePacks.list(dealId)
  });

  // Generate document mutation
  const generateMutation = useMutation({
    mutationFn: ({ documentType, options }) =>
      bff.documents.generate(dealId, { documentType, ...options }),
    onSuccess: (data) => {
      queryClient.invalidateQueries(['documents', dealId]);
      toast({
        title: 'Document Generated',
        description: `${DOCUMENT_TYPES[data.document.documentType]?.label || data.document.documentType} has been generated.`
      });
      setSelectedDocType(null);
    },
    onError: (error) => {
      toast({
        title: 'Generation Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Promote document mutation
  const promoteMutation = useMutation({
    mutationFn: ({ versionId, toStatus }) =>
      bff.documents.promote(versionId, toStatus),
    onSuccess: () => {
      queryClient.invalidateQueries(['documents', dealId]);
      toast({
        title: 'Document Promoted',
        description: 'Document status has been updated.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Promotion Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  // Generate evidence pack mutation
  const generatePackMutation = useMutation({
    mutationFn: (packType) =>
      bff.evidencePacks.generate(dealId, packType),
    onSuccess: () => {
      queryClient.invalidateQueries(['evidencePacks', dealId]);
      toast({
        title: 'Evidence Pack Generated',
        description: 'Your evidence pack is ready for download.'
      });
    },
    onError: (error) => {
      toast({
        title: 'Generation Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  });

  const documents = documentsData?.documents || [];
  const evidencePacks = packsData?.packs || [];

  const handleGenerate = (docType) => {
    generateMutation.mutate({
      documentType: docType,
      options: {
        watermark: includeWatermark ? 'DRAFT - NOT FOR EXECUTION' : null
      }
    });
  };

  const handleDownload = async (document) => {
    try {
      const result = await bff.documents.downloadPDF(document.id);
      const blob = result.blob;
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `${document.title || document.documentType}.pdf`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch (error) {
      toast({
        title: 'Download Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const handleDownloadPack = async (pack) => {
    try {
      const result = await bff.evidencePacks.download(pack.id);
      const blob = result.blob;
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `evidence_pack_${pack.packType.toLowerCase()}.zip`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch (error) {
      toast({
        title: 'Download Failed',
        description: error.message,
        variant: 'destructive'
      });
    }
  };

  const groupedDocTypes = Object.entries(DOCUMENT_TYPES).reduce((acc, [key, value]) => {
    if (!acc[value.category]) acc[value.category] = [];
    acc[value.category].push({ type: key, ...value });
    return acc;
  }, {});

  if (loadingDocs) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Quick Actions */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <FileText className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h3 className="font-medium text-[#171717]">IC Package</h3>
                <p className="text-xs text-[#737373]">Generate full IC documentation</p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => generatePackMutation.mutate('IC_PACK')}
              disabled={generatePackMutation.isPending}
              className="w-full bg-blue-600 hover:bg-blue-700"
            >
              {generatePackMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Package className="w-4 h-4 mr-2" />
              )}
              Generate IC Pack
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-emerald-50 border-green-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <FileCheck className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h3 className="font-medium text-[#171717]">Closing Package</h3>
                <p className="text-xs text-[#737373]">Generate closing documentation</p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => generatePackMutation.mutate('CLOSING_PACK')}
              disabled={generatePackMutation.isPending}
              className="w-full bg-green-600 hover:bg-green-700"
            >
              {generatePackMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Package className="w-4 h-4 mr-2" />
              )}
              Generate Closing Pack
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-violet-50 to-purple-50 border-violet-200">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-violet-100 rounded-lg">
                <Shield className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <h3 className="font-medium text-[#171717]">Audit Package</h3>
                <p className="text-xs text-[#737373]">Full audit trail with provenance</p>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => generatePackMutation.mutate('AUDIT_PACK')}
              disabled={generatePackMutation.isPending}
              className="w-full bg-violet-600 hover:bg-violet-700"
            >
              {generatePackMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Package className="w-4 h-4 mr-2" />
              )}
              Generate Audit Pack
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Document Types by Category */}
      <Card>
        <CardHeader>
          <CardTitle>Generate Documents</CardTitle>
          <CardDescription>
            Create professional documents with full data traceability
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="analysis" className="w-full">
            <TabsList className="mb-4">
              {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                <TabsTrigger key={key} value={key}>{label}</TabsTrigger>
              ))}
            </TabsList>

            {Object.entries(groupedDocTypes).map(([category, docTypes]) => (
              <TabsContent key={category} value={category}>
                <div className="grid grid-cols-2 gap-4">
                  {docTypes.map(doc => {
                    const existingDoc = documents.find(d => d.documentType === doc.type);
                    const Icon = doc.icon;

                    return (
                      <Card key={doc.type} className="relative">
                        <CardContent className="pt-6">
                          <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                              <div className="p-2 bg-[#F5F5F5] rounded-lg">
                                <Icon className="w-5 h-5 text-[#737373]" />
                              </div>
                              <div>
                                <h4 className="font-medium text-[#171717]">{doc.label}</h4>
                                <p className="text-xs text-[#737373] mt-0.5">{doc.description}</p>
                              </div>
                            </div>
                            {existingDoc && (
                              <Badge
                                variant="outline"
                                className={cn("text-xs", STATUS_CONFIG[existingDoc.status]?.color)}
                              >
                                {STATUS_CONFIG[existingDoc.status]?.label}
                              </Badge>
                            )}
                          </div>

                          <div className="mt-4 flex items-center gap-2">
                            {existingDoc ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleDownload(existingDoc)}
                                >
                                  <Download className="w-4 h-4 mr-1" />
                                  Download
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleGenerate(doc.type)}
                                  disabled={generateMutation.isPending}
                                >
                                  <Sparkles className="w-4 h-4 mr-1" />
                                  Regenerate
                                </Button>
                                {existingDoc.status === 'DRAFT' && (
                                  <Button
                                    size="sm"
                                    onClick={() => promoteMutation.mutate({
                                      versionId: existingDoc.id,
                                      toStatus: 'BINDING'
                                    })}
                                    disabled={promoteMutation.isPending}
                                  >
                                    <ArrowRight className="w-4 h-4 mr-1" />
                                    Promote
                                  </Button>
                                )}
                              </>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => handleGenerate(doc.type)}
                                disabled={generateMutation.isPending}
                              >
                                {generateMutation.isPending && selectedDocType === doc.type ? (
                                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                                ) : (
                                  <FilePlus className="w-4 h-4 mr-1" />
                                )}
                                Generate
                              </Button>
                            )}
                          </div>

                          {existingDoc && (
                            <div className="mt-3 pt-3 border-t border-[#E5E5E5] text-xs text-[#737373]">
                              <div className="flex items-center justify-between">
                                <span>v{existingDoc.version} • {new Date(existingDoc.createdAt).toLocaleDateString()}</span>
                                <button
                                  onClick={() => setShowVersionHistory(doc.type)}
                                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
                                >
                                  <History className="w-3 h-3" />
                                  History
                                </button>
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

      {/* Generated Documents List */}
      {documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Generated Documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-[#E5E5E5]">
              {documents.map(doc => {
                const config = DOCUMENT_TYPES[doc.documentType];
                const statusConfig = STATUS_CONFIG[doc.status];
                const Icon = config?.icon || FileText;
                const StatusIcon = statusConfig?.icon || FileText;

                return (
                  <div key={doc.id} className="py-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Icon className="w-5 h-5 text-[#737373]" />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#171717]">
                            {config?.label || doc.documentType}
                          </span>
                          <Badge
                            variant="outline"
                            className={cn("text-xs", statusConfig?.color)}
                          >
                            <StatusIcon className="w-3 h-3 mr-1" />
                            {statusConfig?.label}
                          </Badge>
                        </div>
                        <div className="text-xs text-[#737373]">
                          Version {doc.version} • Generated {new Date(doc.generatedAt).toLocaleString()}
                          {doc.generatedByName && ` by ${doc.generatedByName}`}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleDownload(doc)}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Evidence Packs */}
      {evidencePacks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Evidence Packs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-[#E5E5E5]">
              {evidencePacks.map(pack => (
                <div key={pack.id} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Package className="w-5 h-5 text-violet-500" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-[#171717]">{pack.name}</span>
                        <Badge variant="outline" className="text-xs">
                          {pack.packType}
                        </Badge>
                      </div>
                      <div className="text-xs text-[#737373]">
                        {pack.fileCount} files • {formatBytes(pack.sizeBytes)} •
                        Generated {new Date(pack.generatedAt).toLocaleString()}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleDownloadPack(pack)}
                  >
                    <Download className="w-4 h-4 mr-1" />
                    Download ZIP
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Version History Dialog */}
      <Dialog open={!!showVersionHistory} onOpenChange={() => setShowVersionHistory(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Version History</DialogTitle>
            <DialogDescription>
              View all versions of {DOCUMENT_TYPES[showVersionHistory]?.label}
            </DialogDescription>
          </DialogHeader>
          <VersionHistoryContent
            dealId={dealId}
            documentType={showVersionHistory}
            onDownload={handleDownload}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VersionHistoryContent({ dealId, documentType, onDownload }) {
  const { data, isLoading } = useQuery({
    queryKey: ['documentVersions', dealId, documentType],
    queryFn: () => bff.documents.getVersions(dealId, documentType),
    enabled: !!documentType
  });

  if (isLoading) {
    return <Skeleton className="h-48 w-full" />;
  }

  const versions = data?.versions || [];

  if (versions.length === 0) {
    return (
      <div className="py-8 text-center text-[#737373]">
        No version history available
      </div>
    );
  }

  return (
    <div className="divide-y divide-[#E5E5E5] max-h-[400px] overflow-y-auto">
      {versions.map(version => {
        const statusConfig = STATUS_CONFIG[version.status];

        return (
          <div key={version.id} className="py-3 flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-medium text-[#171717]">Version {version.version}</span>
                <Badge
                  variant="outline"
                  className={cn("text-xs", statusConfig?.color)}
                >
                  {statusConfig?.label}
                </Badge>
              </div>
              <div className="text-xs text-[#737373]">
                {new Date(version.createdAt).toLocaleString()}
                {version.createdByName && ` by ${version.createdByName}`}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onDownload(version)}
            >
              <Download className="w-4 h-4" />
            </Button>
          </div>
        );
      })}
    </div>
  );
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
