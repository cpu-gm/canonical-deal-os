import React, { useMemo, useState, useCallback } from 'react';
import { bff } from '@/api/bffClient';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '../utils';
import { cn } from '@/lib/utils';
import {
  Sparkles,
  FileText,
  AlertCircle,
  Loader2,
  ArrowRight
} from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCurrency, formatPercent } from '@/lib/fieldHumanization';

// Currency input that displays formatted value but stores raw number
function CurrencyInput({ value, onChange, className, ...props }) {
  const [focused, setFocused] = useState(false);
  const displayValue = focused
    ? (value || '')
    : (value ? formatCurrency(value) : '');

  return (
    <Input
      {...props}
      type={focused ? "number" : "text"}
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

// Percentage input that displays with % but stores decimal
function PercentInput({ value, onChange, className, ...props }) {
  const [focused, setFocused] = useState(false);
  // Store as decimal (0.05) but display as percent (5%)
  const displayValue = focused
    ? (value ? (value * 100).toFixed(2) : '')
    : (value ? formatPercent(value) : '');

  return (
    <Input
      {...props}
      type={focused ? "number" : "text"}
      step="0.01"
      value={displayValue}
      onChange={(e) => {
        const val = parseFloat(e.target.value);
        onChange(isNaN(val) ? '' : val / 100);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={className}
    />
  );
}

// Field with validation state and inline error
function FormField({ label, required, error, hint, children, className }) {
  return (
    <div className={className}>
      <Label className={cn(
        "text-sm font-medium",
        error ? "text-red-600" : "text-[#171717]"
      )}>
        {label} {required && <span className="text-red-500">*</span>}
      </Label>
      <div className="mt-1.5">
        {children}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-xs text-[#A3A3A3]">{hint}</p>
      ) : null}
    </div>
  );
}

export default function CreateDealPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('ai');
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiInput, setAiInput] = useState('');
  const [parsedDeal, setParsedDeal] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [aiEdits, setAiEdits] = useState(null);
  const [forceRationale, setForceRationale] = useState('');
  const [forceAccepted, setForceAccepted] = useState(false);
  const [parseError, setParseError] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    asset_type: '',
    asset_address: '',
    asset_city: '',
    asset_state: '',
    purchase_price: '',
    noi: '',
    gp_name: '',
    lender_name: '',
    deal_summary: ''
  });

  // Field-level validation errors
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});

  // Mark field as touched on blur
  const handleBlur = useCallback((field) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  }, []);

  // Validate a single field
  const validateField = useCallback((field, value) => {
    switch (field) {
      case 'name':
        if (!value?.trim()) return 'Deal name is required';
        if (value.trim().length < 3) return 'Name must be at least 3 characters';
        if (value.trim().length > 100) return 'Name must be less than 100 characters';
        return null;
      case 'purchase_price':
        if (value && (isNaN(value) || value < 0)) return 'Enter a valid price';
        if (value && value > 10000000000) return 'Price seems too high - check the value';
        return null;
      case 'noi':
        if (value && (isNaN(value) || value < 0)) return 'Enter a valid NOI';
        return null;
      case 'asset_state':
        if (value && value.length > 2) return 'Use 2-letter state code (e.g., CA)';
        return null;
      default:
        return null;
    }
  }, []);

  // Validate all fields before submission
  const validateForm = useCallback(() => {
    const newErrors = {};
    Object.entries(formData).forEach(([field, value]) => {
      const error = validateField(field, value);
      if (error) newErrors[field] = error;
    });
    setErrors(newErrors);
    // Mark all fields as touched
    const allTouched = {};
    Object.keys(formData).forEach(field => { allTouched[field] = true; });
    setTouched(allTouched);
    return Object.keys(newErrors).length === 0;
  }, [formData, validateField]);

  // Update form data with validation
  const updateFormData = useCallback((field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear error when user starts typing
    if (errors[field]) {
      const error = validateField(field, value);
      setErrors(prev => ({ ...prev, [field]: error }));
    }
  }, [errors, validateField]);

  const toNumber = (value) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    const number = Number(value);
    return Number.isNaN(number) ? null : number;
  };

  const provenanceByField = useMemo(() => {
    const map = new Map();
    if (parseResult?.provenance) {
      for (const entry of parseResult.provenance) {
        map.set(entry.fieldPath, entry);
      }
    }
    return map;
  }, [parseResult]);

  const getProvenance = (fieldPath) => provenanceByField.get(fieldPath) || null;

  const updateAiField = (field, value) => {
    setAiEdits((prev) => ({
      ...(prev || {}),
      [field]: value
    }));
  };

  const buildDiffs = (original, edited) => {
    if (!original || !edited) return [];
    const fields = Object.keys(edited);
    const diffs = [];
    for (const field of fields) {
      const before = original[field];
      const after = edited[field];
      const beforeValue = before === undefined ? null : before;
      const afterValue = after === undefined ? null : after;
      if (beforeValue === afterValue) continue;
      diffs.push({
        fieldPath: field === 'name' ? 'name' : `profile.${field}`,
        oldValue: beforeValue,
        newValue: afterValue,
        correctionType: beforeValue === null ? 'ADD' : afterValue === null ? 'DELETE' : 'EDIT'
      });
    }
    return diffs;
  };

  const handleAIParse = async () => {
    if (!aiInput.trim()) return;

    setIsProcessing(true);
    setParseError(null);
    try {
      const result = await bff.llm.parseDeal({
        inputText: aiInput,
        inputSource: 'USER_TEXT'
      });

      setParseResult(result);
      setParsedDeal(result.parsedDeal);
      setAiEdits(result.parsedDeal);
      setForceAccepted(false);
      setForceRationale('');
    } catch (error) {
      console.error('Error parsing deal:', error);
      setParseError(error.message || 'Failed to parse deal. The AI service may be unavailable.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleForceAccept = async () => {
    if (!parseResult?.sessionId || !forceRationale.trim()) return;
    setIsProcessing(true);
    try {
      await bff.llm.forceAccept({
        sessionId: parseResult.sessionId,
        rationale: forceRationale.trim()
      });
      setForceAccepted(true);
    } catch (error) {
      console.error('Error forcing accept:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateFromAI = async () => {
    if (!parsedDeal || !aiEdits) return;
    
    setIsProcessing(true);
    try {
      // Calculate LTV and DSCR if possible
      let ltv = null;
      let dscr = null;
      
      const purchasePrice = toNumber(aiEdits.purchase_price);
      const noi = toNumber(aiEdits.noi);
      const seniorDebt = toNumber(aiEdits.senior_debt);
      const mezzanineDebt = toNumber(aiEdits.mezzanine_debt);
      const totalDebt = (seniorDebt ?? 0) + (mezzanineDebt ?? 0);
      if (purchasePrice && totalDebt) {
        ltv = totalDebt / purchasePrice;
      }
      
      // Assuming 6% debt service rate for DSCR calculation
      if (noi && totalDebt) {
        const annualDebtService = totalDebt * 0.06;
        dscr = noi / annualDebtService;
      }

      const profile = {
        asset_type: aiEdits.asset_type ?? null,
        asset_address: aiEdits.asset_address ?? null,
        asset_city: aiEdits.asset_city ?? null,
        asset_state: aiEdits.asset_state ?? null,
        square_footage: toNumber(aiEdits.square_footage),
        unit_count: toNumber(aiEdits.unit_count),
        year_built: toNumber(aiEdits.year_built),
        purchase_price: purchasePrice,
        noi,
        cap_rate: toNumber(aiEdits.cap_rate),
        senior_debt: seniorDebt,
        mezzanine_debt: mezzanineDebt,
        preferred_equity: toNumber(aiEdits.preferred_equity),
        common_equity: toNumber(aiEdits.common_equity),
        gp_name: aiEdits.gp_name ?? null,
        lender_name: aiEdits.lender_name ?? null,
        deal_summary: aiEdits.deal_summary ?? null,
        ltv,
        dscr,
        ai_derived: true,
        verification_status: 'pending_verification'
      };

      // Auto-generate deal name from address + asset type if not provided
      const name =
        aiEdits.name?.trim() ||
        // Auto-generate from address + asset type (e.g., "9 Rolling Hill Lane Industrial")
        (aiEdits.asset_address && aiEdits.asset_type
          ? `${aiEdits.asset_address.trim()} ${aiEdits.asset_type.trim()}`
          : aiEdits.asset_address?.trim()) ||
        'Untitled Deal';

      const deal = await bff.deals.create({
        name,
        profile,
        sessionId: parseResult?.sessionId
      });

      const diffs = buildDiffs(parsedDeal, aiEdits);
      if (diffs.length > 0) {
        await bff.deals.corrections(deal.id, {
          sessionId: parseResult?.sessionId,
          diffs
        });
      }

      navigate(createPageUrl(`DealOverview?id=${deal.id}`));
    } catch (error) {
      console.error('Error creating deal:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCreateManual = async () => {
    // Validate form before submission
    if (!validateForm()) {
      return;
    }

    setIsProcessing(true);
    try {
      const profile = {
        asset_type: formData.asset_type || null,
        asset_address: formData.asset_address || null,
        asset_city: formData.asset_city || null,
        asset_state: formData.asset_state || null,
        purchase_price: toNumber(formData.purchase_price),
        noi: toNumber(formData.noi),
        gp_name: formData.gp_name || null,
        lender_name: formData.lender_name || null,
        deal_summary: formData.deal_summary || null,
        ai_derived: false,
        verification_status: 'pending_verification'
      };

      const deal = await bff.deals.create({
        name: formData.name.trim(),
        profile
      });

      navigate(createPageUrl(`DealOverview?id=${deal.id}`));
    } catch (error) {
      console.error('Error creating deal:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  // Only block if we have no parsed data at all, or if EVAL_FAILED without force accept
  // VALIDATION_FAILED with actual data should still allow creation (user can review/edit)
  const blockCreate =
    parseResult?.status === 'EVAL_FAILED' && !forceAccepted;

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-[#171717] tracking-tight">Create Deal</h1>
        <p className="text-sm text-[#737373] mt-1">AI-assisted or manual deal intake</p>
      </div>

      <div className="bg-white rounded-xl border border-[#E5E5E5] overflow-hidden">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full border-b border-[#E5E5E5] rounded-none bg-[#FAFAFA] p-0 h-auto">
            <TabsTrigger 
              value="ai" 
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-[#0A0A0A] data-[state=active]:bg-white py-4 px-6"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              AI-Assisted Intake
            </TabsTrigger>
            <TabsTrigger 
              value="manual"
              className="flex-1 rounded-none border-b-2 border-transparent data-[state=active]:border-[#0A0A0A] data-[state=active]:bg-white py-4 px-6"
            >
              <FileText className="w-4 h-4 mr-2" />
              Manual Entry
            </TabsTrigger>
          </TabsList>

          {/* AI Tab */}
          <TabsContent value="ai" className="p-6 m-0">
            <div className="space-y-6">
              {/* AI Input */}
              <div>
                <Label className="text-sm font-medium text-[#171717]">
                  Paste deal memo or describe the deal
                </Label>
                <Textarea 
                  placeholder="Paste your deal memo, term sheet, or describe the deal in plain text..."
                  value={aiInput}
                  onChange={(e) => setAiInput(e.target.value)}
                  className="mt-2 min-h-[200px] border-[#E5E5E5] focus:border-[#171717] focus:ring-0"
                />
                <p className="text-xs text-[#A3A3A3] mt-2">
                  The AI will extract structured data from your input. All AI-derived fields require verification.
                </p>
              </div>

              <Button 
                onClick={handleAIParse}
                disabled={!aiInput.trim() || isProcessing}
                className="bg-[#0A0A0A] hover:bg-[#171717]"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Parsing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Parse with AI
                  </>
                )}
              </Button>

              {/* Parse Error */}
              {parseError && (
                <div className="border border-red-200 rounded-xl p-4 bg-red-50">
                  <p className="text-sm text-red-800 font-medium">
                    {parseError}
                  </p>
                  <p className="text-xs text-red-600 mt-1">
                    You can still create a deal using the manual form below.
                  </p>
                </div>
              )}

              {/* Parsed Result */}
              {parsedDeal && (
                <div className="border border-[#E5E5E5] rounded-xl p-6 bg-[#FAFAFA]">
                  {parseResult?.status === 'VALIDATION_FAILED' && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800 font-medium">
                        Some fields may be incomplete. Review the extracted data below and edit if needed.
                      </p>
                      <p className="text-xs text-amber-700 mt-1">
                        You can still create the deal - missing fields can be added later.
                      </p>
                    </div>
                  )}
                  {parseResult?.status === 'EVAL_FAILED' && (
                    <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                      <p className="text-sm text-amber-800 font-medium">
                        Evaluation flags found. Review fields or force accept with rationale.
                      </p>
                      {parseResult?.evaluatorReport?.criticalFlags?.length > 0 && (
                        <p className="text-xs text-amber-700 mt-1">
                          {parseResult.evaluatorReport.criticalFlags.join(', ')}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-4">
                    <div className="px-2 py-1 bg-violet-50 rounded text-xs font-medium text-violet-700 flex items-center gap-1">
                      🤖 AI-Derived
                    </div>
                    <div className="px-2 py-1 bg-amber-50 rounded text-xs font-medium text-amber-700 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      Pending verification
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    {parsedDeal.name && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Deal Name</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#171717]">{parsedDeal.name}</p>
                          <ProvenanceBadge entry={getProvenance('name')} />
                        </div>
                      </div>
                    )}
                    {parsedDeal.asset_type && (
                      <div>
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Asset Type</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#171717]">{parsedDeal.asset_type}</p>
                          <ProvenanceBadge entry={getProvenance('profile.asset_type')} />
                        </div>
                      </div>
                    )}
                    {parsedDeal.purchase_price && (
                      <div>
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Purchase Price</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#171717]">${(parsedDeal.purchase_price / 1000000).toFixed(2)}M</p>
                          <ProvenanceBadge entry={getProvenance('profile.purchase_price')} />
                        </div>
                      </div>
                    )}
                    {parsedDeal.noi && (
                      <div>
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">NOI</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#171717]">${(parsedDeal.noi / 1000).toFixed(0)}K</p>
                          <ProvenanceBadge entry={getProvenance('profile.noi')} />
                        </div>
                      </div>
                    )}
                    {parsedDeal.cap_rate && (
                      <div>
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Cap Rate</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#171717]">{(parsedDeal.cap_rate * 100).toFixed(2)}%</p>
                          <ProvenanceBadge entry={getProvenance('profile.cap_rate')} />
                        </div>
                      </div>
                    )}
                    {parsedDeal.asset_address && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Address</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[#171717]">
                            {parsedDeal.asset_address}, {parsedDeal.asset_city}, {parsedDeal.asset_state}
                          </p>
                          <ProvenanceBadge entry={getProvenance('profile.asset_address')} />
                        </div>
                      </div>
                    )}
                    {parsedDeal.deal_summary && (
                      <div className="col-span-2">
                        <span className="text-[10px] text-[#A3A3A3] uppercase tracking-wider">Summary</span>
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-[#737373]">{parsedDeal.deal_summary}</p>
                          <ProvenanceBadge entry={getProvenance('profile.deal_summary')} />
                        </div>
                      </div>
                    )}
                  </div>

                  {aiEdits && (
                    <div className="mt-6 border-t border-[#E5E5E5] pt-4">
                      <p className="text-xs text-[#A3A3A3] uppercase tracking-wider mb-3">
                        Review & Edit
                      </p>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="col-span-2">
                          <Label className="text-sm font-medium text-[#171717]">Deal Name</Label>
                          <Input
                            value={aiEdits.name || ''}
                            onChange={(e) => updateAiField('name', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">Asset Type</Label>
                          <Input
                            value={aiEdits.asset_type || ''}
                            onChange={(e) => updateAiField('asset_type', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">Purchase Price</Label>
                          <CurrencyInput
                            value={aiEdits.purchase_price}
                            onChange={(val) => updateAiField('purchase_price', val)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-sm font-medium text-[#171717]">Address</Label>
                          <Input
                            value={aiEdits.asset_address || ''}
                            onChange={(e) => updateAiField('asset_address', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">City</Label>
                          <Input
                            value={aiEdits.asset_city || ''}
                            onChange={(e) => updateAiField('asset_city', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">State</Label>
                          <Input
                            value={aiEdits.asset_state || ''}
                            onChange={(e) => updateAiField('asset_state', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">NOI</Label>
                          <CurrencyInput
                            value={aiEdits.noi}
                            onChange={(val) => updateAiField('noi', val)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">Cap Rate</Label>
                          <PercentInput
                            value={aiEdits.cap_rate}
                            onChange={(val) => updateAiField('cap_rate', val)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">GP Name</Label>
                          <Input
                            value={aiEdits.gp_name || ''}
                            onChange={(e) => updateAiField('gp_name', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div>
                          <Label className="text-sm font-medium text-[#171717]">Lender Name</Label>
                          <Input
                            value={aiEdits.lender_name || ''}
                            onChange={(e) => updateAiField('lender_name', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5]"
                          />
                        </div>
                        <div className="col-span-2">
                          <Label className="text-sm font-medium text-[#171717]">Deal Summary</Label>
                          <Textarea
                            value={aiEdits.deal_summary || ''}
                            onChange={(e) => updateAiField('deal_summary', e.target.value)}
                            className="mt-1.5 border-[#E5E5E5] min-h-[80px]"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {parseResult?.status === 'EVAL_FAILED' && (
                    <div className="mt-6 p-4 border border-[#E5E5E5] rounded-lg bg-white">
                      <Label className="text-sm font-medium text-[#171717]">Force Accept Rationale</Label>
                      <Textarea
                        value={forceRationale}
                        onChange={(e) => setForceRationale(e.target.value)}
                        className="mt-2 border-[#E5E5E5]"
                        placeholder="Explain why you are accepting this parse."
                      />
                      <div className="mt-3 flex justify-end">
                        <Button
                          variant="outline"
                          disabled={!forceRationale.trim() || isProcessing}
                          onClick={handleForceAccept}
                        >
                          Force Accept
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="mt-6 pt-4 border-t border-[#E5E5E5] flex justify-end">
                    <Button 
                      onClick={handleCreateFromAI}
                      disabled={isProcessing || blockCreate}
                      className="bg-[#0A0A0A] hover:bg-[#171717]"
                    >
                      {isProcessing ? (
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      ) : (
                        <ArrowRight className="w-4 h-4 mr-2" />
                      )}
                      Create Deal
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </TabsContent>

          {/* Manual Tab */}
          <TabsContent value="manual" className="p-6 m-0">
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  label="Deal Name"
                  required
                  error={touched.name && errors.name}
                  hint="A descriptive name for this deal"
                  className="col-span-2"
                >
                  <Input
                    placeholder="e.g., 123 Main Street Acquisition"
                    value={formData.name}
                    onChange={(e) => updateFormData('name', e.target.value)}
                    onBlur={() => handleBlur('name')}
                    className={cn(
                      "border-[#E5E5E5] focus:border-[#171717] focus:ring-0",
                      touched.name && errors.name && "border-red-300 focus:border-red-500"
                    )}
                  />
                </FormField>

                <FormField label="Asset Type" hint="Property classification">
                  <Select value={formData.asset_type} onValueChange={(v) => updateFormData('asset_type', v)}>
                    <SelectTrigger className="border-[#E5E5E5]">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Multifamily">Multifamily</SelectItem>
                      <SelectItem value="Office">Office</SelectItem>
                      <SelectItem value="Industrial">Industrial</SelectItem>
                      <SelectItem value="Retail">Retail</SelectItem>
                      <SelectItem value="Mixed-Use">Mixed-Use</SelectItem>
                      <SelectItem value="Hospitality">Hospitality</SelectItem>
                      <SelectItem value="Healthcare">Healthcare</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>

                <FormField
                  label="Purchase Price"
                  error={touched.purchase_price && errors.purchase_price}
                  hint="Total acquisition cost"
                >
                  <CurrencyInput
                    placeholder="e.g., $25,000,000"
                    value={formData.purchase_price}
                    onChange={(val) => updateFormData('purchase_price', val)}
                    onBlur={() => handleBlur('purchase_price')}
                    className={cn(
                      "border-[#E5E5E5] focus:border-[#171717] focus:ring-0",
                      touched.purchase_price && errors.purchase_price && "border-red-300 focus:border-red-500"
                    )}
                  />
                </FormField>

                <FormField
                  label="Address"
                  hint="Property street address"
                  className="col-span-2"
                >
                  <Input
                    placeholder="e.g., 123 Main Street"
                    value={formData.asset_address}
                    onChange={(e) => updateFormData('asset_address', e.target.value)}
                    className="border-[#E5E5E5] focus:border-[#171717] focus:ring-0"
                  />
                </FormField>

                <FormField label="City">
                  <Input
                    placeholder="e.g., San Francisco"
                    value={formData.asset_city}
                    onChange={(e) => updateFormData('asset_city', e.target.value)}
                    className="border-[#E5E5E5] focus:border-[#171717] focus:ring-0"
                  />
                </FormField>

                <FormField
                  label="State"
                  error={touched.asset_state && errors.asset_state}
                  hint="2-letter code"
                >
                  <Input
                    placeholder="e.g., CA"
                    maxLength={2}
                    value={formData.asset_state}
                    onChange={(e) => updateFormData('asset_state', e.target.value.toUpperCase())}
                    onBlur={() => handleBlur('asset_state')}
                    className={cn(
                      "border-[#E5E5E5] focus:border-[#171717] focus:ring-0",
                      touched.asset_state && errors.asset_state && "border-red-300 focus:border-red-500"
                    )}
                  />
                </FormField>

                <FormField
                  label="NOI"
                  error={touched.noi && errors.noi}
                  hint="Annual Net Operating Income"
                >
                  <CurrencyInput
                    placeholder="e.g., $1,500,000"
                    value={formData.noi}
                    onChange={(val) => updateFormData('noi', val)}
                    onBlur={() => handleBlur('noi')}
                    className={cn(
                      "border-[#E5E5E5] focus:border-[#171717] focus:ring-0",
                      touched.noi && errors.noi && "border-red-300 focus:border-red-500"
                    )}
                  />
                </FormField>

                <FormField label="GP Name" hint="General Partner / Sponsor">
                  <Input
                    placeholder="e.g., Acme Capital Partners"
                    value={formData.gp_name}
                    onChange={(e) => updateFormData('gp_name', e.target.value)}
                    className="border-[#E5E5E5] focus:border-[#171717] focus:ring-0"
                  />
                </FormField>

                <FormField label="Deal Summary" hint="Brief overview of the investment" className="col-span-2">
                  <Textarea
                    placeholder="Describe the property, strategy, and investment thesis..."
                    value={formData.deal_summary}
                    onChange={(e) => updateFormData('deal_summary', e.target.value)}
                    className="min-h-[100px] border-[#E5E5E5] focus:border-[#171717] focus:ring-0"
                  />
                </FormField>
              </div>

              {/* Validation Summary */}
              {Object.keys(errors).length > 0 && Object.values(touched).some(t => t) && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-800 font-medium flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    Please fix the errors above before creating the deal
                  </p>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-[#E5E5E5]">
                <Button
                  onClick={handleCreateManual}
                  disabled={isProcessing}
                  className="bg-[#0A0A0A] hover:bg-[#171717]"
                >
                  {isProcessing ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <ArrowRight className="w-4 h-4 mr-2" />
                  )}
                  Create Deal
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function ProvenanceBadge({ entry }) {
  if (!entry) {
    return null;
  }

  const label = entry.source || 'AI';
  const confidence =
    typeof entry.confidence === 'number'
      ? `${Math.round(entry.confidence * 100)}%`
      : null;

  const className =
    label === 'DOC'
      ? 'bg-green-50 text-green-700'
      : label === 'HUMAN'
        ? 'bg-blue-50 text-blue-700'
        : 'bg-violet-50 text-violet-700';

  return (
    <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${className}`}>
      {label}{confidence ? ` - ${confidence}` : ''}
    </span>
  );
}
