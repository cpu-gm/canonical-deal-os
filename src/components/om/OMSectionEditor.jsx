import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Save, RotateCcw, Loader2 } from "lucide-react";
import { debugLog } from "@/lib/debug";

export function OMSectionEditor({
  section,
  content,
  onSave,
  isSaving,
  isEditable = true,
  showAutoSave = true
}) {
  const [localContent, setLocalContent] = useState(content || "");
  const [hasChanges, setHasChanges] = useState(false);
  const saveTimeoutRef = useRef(null);

  useEffect(() => {
    setLocalContent(content || "");
    setHasChanges(false);
  }, [content]);

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  const scheduleSave = (value) => {
    if (!showAutoSave || !isEditable) return;
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      debugLog("om", "Auto-saving section", { sectionId: section.id });
      onSave(value);
    }, 2000);
  };

  const handleChange = (event) => {
    const value = event.target.value;
    setLocalContent(value);
    setHasChanges(value !== content);
    scheduleSave(value);
  };

  const handleManualSave = () => {
    debugLog("om", "Saving section", { sectionId: section.id });
    onSave(localContent);
    setHasChanges(false);
  };

  const handleRevert = () => {
    debugLog("om", "Reverting section", { sectionId: section.id });
    setLocalContent(content || "");
    setHasChanges(false);
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">{section.title}</CardTitle>
          <div className="flex items-center gap-2">
            {section.required && <Badge variant="outline">Required</Badge>}
            {hasChanges && <Badge className="bg-amber-100 text-amber-700">Unsaved</Badge>}
            {isSaving && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Textarea
          value={localContent}
          onChange={handleChange}
          disabled={!isEditable}
          rows={8}
          className="font-mono text-sm"
          placeholder={`Enter ${section.title.toLowerCase()} content...`}
        />

        {isEditable && (
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" onClick={handleRevert} disabled={!hasChanges}>
              <RotateCcw className="w-4 h-4 mr-1" />
              Revert
            </Button>
            <Button size="sm" onClick={handleManualSave} disabled={!hasChanges || isSaving}>
              <Save className="w-4 h-4 mr-1" />
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
