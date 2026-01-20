import { useState, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Upload, X, FileText, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { debugLog } from "@/lib/debug";

const DOCUMENT_TYPES = [
  { value: "OM", label: "Offering Memorandum" },
  { value: "RENT_ROLL", label: "Rent Roll" },
  { value: "T12", label: "T12 / Operating Statement" },
  { value: "LOI", label: "Letter of Intent" },
  { value: "APPRAISAL", label: "Appraisal" },
  { value: "OTHER", label: "Other" }
];

export function DocumentUploader({ onDocumentsReady, isUploading }) {
  const [files, setFiles] = useState([]);
  const [isDragActive, setIsDragActive] = useState(false);

  const handleFilesSelected = useCallback((fileList) => {
    const acceptedFiles = Array.from(fileList || []);
    if (acceptedFiles.length === 0) return;
    const newFiles = acceptedFiles.map((file) => ({
      file,
      id: crypto.randomUUID(),
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      classifiedType: null,
      storageKey: null
    }));
    setFiles((prev) => [...prev, ...newFiles]);
    debugLog("intake", "Files selected", { count: acceptedFiles.length });
  }, []);

  const handleDragOver = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!isDragActive) setIsDragActive(true);
    },
    [isDragActive]
  );

  const handleDragLeave = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDrop = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragActive(false);
      handleFilesSelected(event.dataTransfer?.files);
    },
    [handleFilesSelected]
  );

  const handleInputChange = useCallback(
    (event) => {
      handleFilesSelected(event.target.files);
      event.target.value = "";
    },
    [handleFilesSelected]
  );

  const removeFile = (id) => {
    setFiles((prev) => prev.filter((file) => file.id !== id));
  };

  const setFileType = (id, type) => {
    setFiles((prev) =>
      prev.map((file) => (file.id === id ? { ...file, classifiedType: type } : file))
    );
  };

  const handleUpload = () => {
    debugLog("intake", "Documents ready", { count: files.length });
    onDocumentsReady(
      files.map((file) => ({
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        classifiedType: file.classifiedType,
        storageKey: file.storageKey || `pending/${file.id}`
      }))
    );
  };

  return (
    <div className="space-y-4">
      <div
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
          isDragActive ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
        )}
      >
        <input
          id="intake-document-uploader"
          type="file"
          multiple
          accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg"
          onChange={handleInputChange}
          className="hidden"
        />
        <label htmlFor="intake-document-uploader" className="block cursor-pointer">
          <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600">
            {isDragActive ? "Drop files here..." : "Drag & drop files, or click to select"}
          </p>
          <p className="text-xs text-gray-400 mt-1">PDF, Excel, Images supported</p>
        </label>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((file) => (
            <Card key={file.id} className="p-3">
              <div className="flex items-center gap-3">
                <FileText className="w-5 h-5 text-gray-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{file.filename}</p>
                  <p className="text-xs text-gray-400">{(file.sizeBytes / 1024).toFixed(1)} KB</p>
                </div>
                <Select value={file.classifiedType || ""} onValueChange={(v) => setFileType(file.id, v)}>
                  <SelectTrigger className="w-40">
                    <SelectValue placeholder="Document type" />
                  </SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" onClick={() => removeFile(file.id)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </Card>
          ))}

          <Button onClick={handleUpload} disabled={isUploading} className="w-full">
            {isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {isUploading ? "Uploading..." : `Upload ${files.length} file(s)`}
          </Button>
        </div>
      )}
    </div>
  );
}
