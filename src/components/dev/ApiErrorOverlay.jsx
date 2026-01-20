/**
 * API Error Overlay - Development Only
 *
 * Shows a floating panel with recent API errors for quick debugging.
 * Only renders in development mode.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, AlertTriangle, Copy, Check, Trash2 } from 'lucide-react';

// Global error store - persists across component re-renders
const errorStore = {
  errors: [],
  listeners: new Set(),
  maxErrors: 50,

  addError(error) {
    this.errors.unshift({
      id: Date.now() + Math.random(),
      timestamp: new Date(),
      ...error,
    });
    if (this.errors.length > this.maxErrors) {
      this.errors.pop();
    }
    this.notify();
  },

  clear() {
    this.errors = [];
    this.notify();
  },

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  notify() {
    this.listeners.forEach(l => l([...this.errors]));
  },
};

// Export for use in bffClient.js
export function reportApiError(error) {
  errorStore.addError(error);
}

// Hook to subscribe to errors
function useApiErrors() {
  const [errors, setErrors] = useState(errorStore.errors);

  useEffect(() => {
    return errorStore.subscribe(setErrors);
  }, []);

  return errors;
}

export default function ApiErrorOverlay() {
  const isDev = import.meta.env.DEV;
  const errors = useApiErrors();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  const handleCopy = useCallback((error) => {
    const text = `${error.method} ${error.path}
Status: ${error.status}
Error: ${error.message}
Time: ${error.timestamp.toISOString()}
${error.details ? `\nDetails: ${JSON.stringify(error.details, null, 2)}` : ''}`;

    navigator.clipboard.writeText(text);
    setCopiedId(error.id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  // Only render in development
  if (!isDev) return null;

  // Don't render if hidden or no errors
  if (isHidden || errors.length === 0) {
    // Show small indicator if hidden but has errors
    if (isHidden && errors.length > 0) {
      return (
        <button
          onClick={() => setIsHidden(false)}
          className="fixed bottom-4 right-4 z-[9999] bg-red-500 text-white rounded-full w-10 h-10 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
          title="Show API Errors"
        >
          <AlertTriangle className="w-5 h-5" />
          <span className="absolute -top-1 -right-1 bg-white text-red-500 text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
            {errors.length}
          </span>
        </button>
      );
    }
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-96 max-h-[60vh] bg-gray-900 text-white rounded-lg shadow-2xl border border-gray-700 overflow-hidden font-mono text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-red-600 cursor-pointer" onClick={() => setIsCollapsed(!isCollapsed)}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          <span className="font-semibold">API Errors ({errors.length})</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={(e) => { e.stopPropagation(); errorStore.clear(); }}
            className="p-1 hover:bg-red-700 rounded"
            title="Clear all"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); setIsHidden(true); }}
            className="p-1 hover:bg-red-700 rounded"
            title="Hide panel"
          >
            <X className="w-4 h-4" />
          </button>
          {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {/* Error List */}
      {!isCollapsed && (
        <div className="max-h-[50vh] overflow-y-auto">
          {errors.map((error) => (
            <div key={error.id} className="border-b border-gray-700 last:border-b-0">
              <div className="px-3 py-2 hover:bg-gray-800">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                      error.status >= 500 ? 'bg-red-500' :
                      error.status >= 400 ? 'bg-yellow-500 text-black' :
                      'bg-gray-500'
                    }`}>
                      {error.status || 'ERR'}
                    </span>
                    <span className="text-gray-400 text-xs">{error.method}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500 text-xs">
                      {error.timestamp.toLocaleTimeString()}
                    </span>
                    <button
                      onClick={() => handleCopy(error)}
                      className="p-1 hover:bg-gray-700 rounded"
                      title="Copy details"
                    >
                      {copiedId === error.id ? (
                        <Check className="w-3 h-3 text-green-400" />
                      ) : (
                        <Copy className="w-3 h-3 text-gray-400" />
                      )}
                    </button>
                  </div>
                </div>
                <div className="text-gray-300 text-xs mt-1 truncate" title={error.path}>
                  {error.path}
                </div>
                <div className="text-red-400 text-xs mt-1">
                  {error.message}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
