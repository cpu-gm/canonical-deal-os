import React, { useState, useRef } from 'react';
import { Upload, File, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * FileUploadZone Component
 *
 * A drag-and-drop file upload zone with file selection fallback.
 * Accepts file type filtering and displays selected file preview.
 */
export default function FileUploadZone({
  onFileSelect,
  accept = ".pdf,.docx,.xlsx,.doc,.xls,.csv",
  selectedFile = null,
  onClearFile = null,
  className = ""
}) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      onFileSelect?.(files[0]);
    }
  };

  const handleFileInputChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelect?.(files[0]);
    }
  };

  const handleClick = () => {
    fileInputRef.current?.click();
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onClearFile?.();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className={cn("w-full", className)}>
      {!selectedFile ? (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={handleClick}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors",
            isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-[#E5E5E5] bg-[#FAFAFA] hover:border-blue-400 hover:bg-blue-50"
          )}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept={accept}
            onChange={handleFileInputChange}
            className="hidden"
          />
          <Upload className={cn(
            "w-8 h-8 mx-auto mb-2",
            isDragging ? "text-blue-500" : "text-[#A3A3A3]"
          )} />
          <p className="text-sm font-medium text-[#171717] mb-1">
            {isDragging ? "Drop file here" : "Click to upload or drag and drop"}
          </p>
          <p className="text-xs text-[#A3A3A3]">
            Accepted formats: PDF, DOCX, XLSX
          </p>
        </div>
      ) : (
        <div className="border border-[#E5E5E5] rounded-lg p-4 bg-white">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
              <File className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#171717] truncate">
                {selectedFile.name}
              </p>
              <p className="text-xs text-[#A3A3A3]">
                {formatFileSize(selectedFile.size)}
              </p>
            </div>
            <button
              onClick={handleClear}
              className="flex-shrink-0 p-1 hover:bg-red-100 rounded transition-colors"
              aria-label="Remove file"
            >
              <X className="w-4 h-4 text-red-600" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
