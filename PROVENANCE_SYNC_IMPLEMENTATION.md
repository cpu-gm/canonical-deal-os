# Provenance-to-Material Sync Implementation

## Summary

Implemented automatic material synchronization when marking fields as DOC-backed. This fixes the critical "silent failure" gap where users could mark provenance as verified but kernel gating would still block.

## Changes Made

### 1. Added Field-to-Material Mapping ([server/mappers.js:272-297](canonical-deal-os/server/mappers.js#L272))

```javascript
export function mapFieldToMaterialType(fieldPath) {
  const mapping = {
    // Underwriting Summary fields (for APPROVE_DEAL)
    "profile.purchase_price": "UnderwritingSummary",
    "profile.noi": "UnderwritingSummary",
    "profile.cap_rate": "UnderwritingSummary",
    // ... more mappings

    // Final Underwriting fields (for ATTEST_READY_TO_CLOSE)
    "profile.ltv": "FinalUnderwriting",
    "profile.dscr": "FinalUnderwriting",
    // ... more mappings
  };

  return mapping[fieldPath] || null; // null for dynamic/custom fields
}
```

**Key Design Decisions**:
- ✅ Hardcoded mapping for standard fields (fast, explicit)
- ✅ Returns `null` for unknown fields (cautious AI - no assumptions)
- ✅ Multiple fields can map to same material (purchase_price, noi → UnderwritingSummary)

### 2. Added Material Sync Helper ([server/kernel.js:139-202](canonical-deal-os/server/kernel.js#L139))

```javascript
export async function createOrUpdateMaterial(
  kernelBaseUrl, dealId, materialType, artifactId, fieldPath
) {
  const materials = await kernelFetchJson(...);
  const existing = materials.find(m => m.type === materialType);

  if (existing) {
    // Update: Add artifact to evidenceRefs, upgrade to DOC
    return { action: "updated", material: ... };
  } else {
    // Create: New material with DOC truthClass
    return { action: "created", material: ... };
  }
}
```

**Behavior**:
- ✅ Creates material immediately when FIRST field is marked DOC
- ✅ Adds artifact to evidenceRefs (avoids duplicates)
- ✅ Always upgrades truthClass to DOC
- ✅ Preserves kernel as source of truth (BFF proposes, kernel accepts)

### 3. Enhanced Provenance Update with Rollback ([server/index.js:584-759](canonical-deal-os/server/index.js#L584))

**New Flow**:
1. Store original provenance values
2. Update provenance in BFF SQLite
3. Map field → material type
4. If mapped:
   - Create/update kernel material
   - If fails → **rollback provenance** + return error
5. Close related tasks
6. Invalidate caches
7. Return success with sync details

**Error Handling**:
- ✅ Atomic operation: rollback on failure
- ✅ Returns 502 if kernel sync fails
- ✅ Logs all sync events for debugging
- ✅ Graceful degradation for custom fields

## Testing Checklist

### Manual Testing
- [ ] Create deal from text → verify provenance created
- [ ] Upload artifact → verify kernel artifact exists
- [ ] Mark `profile.purchase_price` as DOC:
  - [ ] Verify provenance updated (source=DOC, artifactId set)
  - [ ] Verify material created (type=UnderwritingSummary, truthClass=DOC)
  - [ ] Verify task closed
- [ ] Attempt "Approve Deal" action:
  - [ ] Should now pass (material exists with DOC truthClass)
- [ ] Mark `profile.noi` as DOC (second field → same material):
  - [ ] Verify material updated (evidenceRefs has both artifacts)
  - [ ] Verify truthClass still DOC
- [ ] Mark custom field as DOC:
  - [ ] Verify provenance updated
  - [ ] Verify NO material created (log should show "No material mapping")

### Error Scenarios
- [ ] Kernel down when marking DOC:
  - [ ] Verify provenance NOT updated (rolled back)
  - [ ] Verify error returned to user
- [ ] Invalid artifact ID:
  - [ ] Verify kernel rejects
  - [ ] Verify provenance rolled back

### Automated Testing
- [ ] Add BFF integration test: provenance → material sync
- [ ] Add kernel test: material gating with auto-created materials
- [ ] Run diagnostics: `node server/diagnostics/prove-invariants.mjs`

## User Experience Changes

### Before
1. User uploads PSA.pdf ✅
2. User marks "purchase_price" as DOC ✅
3. UI shows green checkmark ✅
4. User clicks "Approve Deal" ❌ **BLOCKED** - "Missing material UnderwritingSummary"

### After
1. User uploads PSA.pdf ✅
2. User marks "purchase_price" as DOC ✅
   - **BFF auto-creates UnderwritingSummary material with DOC truthClass**
3. UI shows green checkmark ✅
4. User clicks "Approve Deal" ✅ **ALLOWED** - Gating passes

## API Response Changes

### Before
```json
{
  "ok": true
}
```

### After
```json
{
  "ok": true,
  "provenance": {
    "fieldPath": "profile.purchase_price",
    "source": "DOC",
    "artifactId": "uuid"
  },
  "materialSync": {
    "action": "created",
    "materialType": "UnderwritingSummary",
    "materialId": "uuid"
  }
}
```

**For custom fields** (no mapping):
```json
{
  "ok": true,
  "provenance": { ... },
  "materialSync": null  // No material created
}
```

## Logging

Console logs added for debugging:
- `[Provenance Sync] created material UnderwritingSummary for field profile.purchase_price`
- `[Provenance Sync] updated material UnderwritingSummary for field profile.noi`
- `[Provenance Sync] No material mapping for field profile.custom_field, skipping kernel sync`
- `[Provenance Sync] Material sync failed, rolling back provenance`

## Configuration

### Material Type Mappings (Edit in [server/mappers.js:275-292](canonical-deal-os/server/mappers.js#L275))

To add new mappings:
```javascript
const mapping = {
  "profile.your_field": "YourMaterialType",
  // ... existing mappings
};
```

**Rules**:
- Field path must match BFF provenance structure (`profile.*`)
- Material type must match kernel requirements
- Multiple fields can map to same material

## Architecture Alignment

### Living System Doctrine ✅
- **Fail visibly, not silently**: Errors return 502, rollback prevents inconsistent state
- **Ambiguity halts progression**: No assumptions for unmapped fields
- **Kernel as source of truth**: BFF proposes, kernel enforces

### Truth Hierarchy ✅
- DOC > HUMAN > AI maintained
- Automatic upgrade to DOC when document linked
- No silent downgrades

### Explainability ✅
- Sync result returned in API response
- Console logs for audit trail
- Material meta tracks `createdBy: "provenance-sync"`

## Next Steps

1. **Add UI feedback** - Show material sync status in DealOverview
2. **Add diagnostics** - Extend `prove-invariants.mjs` to test sync
3. **Add reconciliation tool** - Compare provenance vs materials, detect drift
4. **Consider: Reverse sync** - If material created manually, update provenance?

## Backward Compatibility

✅ Fully backward compatible:
- Existing provenance records unchanged
- Manually created materials still work
- API remains compatible (new fields in response are additive)
- Custom fields gracefully skip sync
