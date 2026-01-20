import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { DocumentUploader } from "@/components/intake/DocumentUploader";
import { bff } from "@/api/bffClient";
import { createPageUrl } from "@/utils";
import { toast } from "@/components/ui/use-toast";
import { debugLog } from "@/lib/debug";

const INGEST_OPTIONS = [
  { value: "UPLOAD", label: "Upload documents", description: "Drag and drop files" },
  { value: "PASTE", label: "Paste deal text", description: "Paste email or summary" },
  { value: "URL", label: "Paste a URL", description: "Link to a deal folder" },
  { value: "EMAIL", label: "Forward an email", description: "Use broker intake email" },
  { value: "VOICE", label: "Voice memo", description: "Upload or record audio" },
  { value: "PHOTO", label: "Photo capture", description: "Upload images" }
];

export default function CreateDealDraft() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [ingestSource, setIngestSource] = useState("UPLOAD");
  const [documents, setDocuments] = useState([]);
  const [pasteText, setPasteText] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sellerName, setSellerName] = useState("");
  const [sellerEmail, setSellerEmail] = useState("");
  const [sellerEntity, setSellerEntity] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canContinueFromSource = Boolean(ingestSource);
  const canContinueFromContent =
    (ingestSource === "UPLOAD" && documents.length > 0) ||
    (ingestSource === "PASTE" && pasteText.trim().length > 0) ||
    (ingestSource === "URL" && sourceUrl.trim().length > 0) ||
    ["EMAIL", "VOICE", "PHOTO"].includes(ingestSource);

  const handleCreate = async () => {
    setIsSubmitting(true);
    debugLog("intake", "Create deal draft", { ingestSource });

    const seller =
      sellerName && sellerEmail
        ? { name: sellerName, email: sellerEmail, entityName: sellerEntity }
        : null;

    const sourceData = {
      sourceName: sourceName || null,
      text: pasteText || null,
      url: sourceUrl || null
    };

    try {
      const draft = await bff.dealIntake.createDraft({
        ingestSource,
        sourceData,
        seller
      });

      if (documents.length > 0) {
        const withStorageKeys = documents.map((doc, index) => ({
          ...doc,
          storageKey: doc.storageKey || `mock/${draft.id}/${index}-${doc.filename}`
        }));
        await bff.dealIntake.uploadDocuments(draft.id, withStorageKeys);
      }

      if (pasteText.trim()) {
        await bff.dealIntake.pasteText(draft.id, pasteText, sourceName || "Pasted Text");
      }

      toast({
        title: "Draft created",
        description: "Deal draft is ready for review."
      });
      navigate(createPageUrl(`DealDraftDetail?id=${draft.id}`));
    } catch (error) {
      debugLog("intake", "Create draft failed", { message: error?.message });
      toast({
        title: "Create failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Create Deal Draft</h1>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Select intake source</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {INGEST_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setIngestSource(option.value)}
                className={`p-4 border rounded-lg text-left transition-colors ${
                  ingestSource === option.value
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="font-medium text-gray-900">{option.label}</div>
                <div className="text-sm text-gray-500">{option.description}</div>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Provide source content</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {ingestSource === "UPLOAD" && (
              <DocumentUploader onDocumentsReady={setDocuments} isUploading={false} />
            )}
            {ingestSource === "PASTE" && (
              <div className="space-y-2">
                <Label htmlFor="sourceName">Source name (optional)</Label>
                <Input
                  id="sourceName"
                  value={sourceName}
                  onChange={(event) => setSourceName(event.target.value)}
                  placeholder="Email subject or note"
                />
                <Label htmlFor="pasteText">Paste deal text</Label>
                <Textarea
                  id="pasteText"
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  rows={8}
                  placeholder="Paste the deal summary or email body..."
                />
              </div>
            )}
            {ingestSource === "URL" && (
              <div className="space-y-2">
                <Label htmlFor="sourceUrl">URL</Label>
                <Input
                  id="sourceUrl"
                  value={sourceUrl}
                  onChange={(event) => setSourceUrl(event.target.value)}
                  placeholder="https://..."
                />
              </div>
            )}
            {["EMAIL", "VOICE", "PHOTO"].includes(ingestSource) && (
              <div className="text-sm text-gray-500">
                This source type is supported by the backend. For now, create the draft and add
                documents in the next step.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Optional seller details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="sellerName">Seller name</Label>
              <Input
                id="sellerName"
                value={sellerName}
                onChange={(event) => setSellerName(event.target.value)}
                placeholder="Seller contact name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sellerEmail">Seller email</Label>
              <Input
                id="sellerEmail"
                value={sellerEmail}
                onChange={(event) => setSellerEmail(event.target.value)}
                placeholder="seller@email.com"
              />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="sellerEntity">Seller entity (optional)</Label>
              <Input
                id="sellerEntity"
                value={sellerEntity}
                onChange={(event) => setSellerEntity(event.target.value)}
                placeholder="Entity name"
              />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between mt-6">
        <Button variant="ghost" onClick={() => setStep((prev) => Math.max(prev - 1, 1))}>
          Back
        </Button>
        {step < 3 ? (
          <Button
            onClick={() => setStep((prev) => prev + 1)}
            disabled={(step === 1 && !canContinueFromSource) || (step === 2 && !canContinueFromContent)}
          >
            Continue
          </Button>
        ) : (
          <Button onClick={handleCreate} disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Draft"}
          </Button>
        )}
      </div>
    </div>
  );
}
