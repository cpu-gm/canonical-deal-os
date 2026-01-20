# Security Guidelines for canonical-deal-os

This document defines security patterns that MUST be followed for all new code.

---

## Core Principles

1. **Never trust headers for authorization** - Only use `authUser` from validated JWT
2. **Always enforce org isolation** - Every resource access must verify organizationId
3. **Audit privileged operations** - Financial mutations and access control changes need logs
4. **Fail closed** - If in doubt, deny access

---

## Authentication Patterns

### For GP/Admin endpoints:
```javascript
// In dispatch (index.js)
const authUser = await requireGP(req, res);
if (!authUser) return;
return handleSomething(req, res, authUser);

// In handler
export async function handleSomething(req, res, authUser) {
  // authUser is guaranteed to be GP or Admin
}
```

### For any authenticated user:
```javascript
const authUser = await requireAuth(req, res);
if (!authUser) return;
```

### For LP endpoints:
```javascript
const lpContext = await requireLPEntitlement(req, res, dealId, token);
if (!lpContext) return;
// lpContext.lpEmail and lpContext.lpActorId are verified
```

---

## Organization Isolation Patterns

### Pattern 1: Direct resource with organizationId
```javascript
const resource = await prisma.someModel.findUnique({ where: { id } });
if (!resource) return sendError(res, 404, "Not found");

if (resource.organizationId && resource.organizationId !== authUser.organizationId) {
  return sendError(res, 403, "Access denied - belongs to different organization");
}
```

### Pattern 2: Resource linked to deal (FK chain)
```javascript
const resource = await prisma.someModel.findUnique({
  where: { id },
  include: { deal: true }  // Include the deal to access organizationId
});
if (!resource) return sendError(res, 404, "Not found");

if (resource.deal?.organizationId && resource.deal.organizationId !== authUser.organizationId) {
  return sendError(res, 403, "Access denied - belongs to different organization");
}
```

### Pattern 3: Using requireDealAccess helper
```javascript
import { requireDealAccess } from "../middleware/auth.js";

// Verify deal access (handles 404 and 403 responses)
const hasAccess = await requireDealAccess(authUser, dealId, res);
if (!hasAccess) return;
```

---

## Audit Logging Patterns

### When to log:
- Financial operations (capital calls, distributions, payments)
- Access control changes (role changes, assignments, permissions)
- Sensitive data modifications (verification approvals, document deletions)

### How to log:
```javascript
import { logPermissionAction } from "../middleware/auth.js";

await logPermissionAction({
  actorId: authUser.id,
  actorName: authUser.name,
  targetUserId: targetUser.id,        // Optional - who is affected
  targetUserName: targetUser.name,    // Optional
  action: 'DISTRIBUTION_MARKED_PAID', // Descriptive action name
  beforeValue: { status: 'PENDING' }, // Optional - state before change
  afterValue: { status: 'PAID', amount: 50000 },
  ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
});
```

### Standard action names:
- `USER_ROLE_CHANGED`
- `USER_STATUS_CHANGED`
- `DEAL_ASSIGNMENT_CREATED`
- `DEAL_ASSIGNMENT_REMOVED`
- `DISTRIBUTION_MARKED_PAID`
- `CAPITAL_CALL_ISSUED`
- `VERIFICATION_APPROVED`
- `VERIFICATION_REJECTED`
- `DOCUMENT_DELETED`
- `PERMISSIONS_UPDATED`

---

## IDOR Prevention Checklist

When creating an endpoint that accepts an ID parameter:

1. **Identify the resource's org chain**:
   - Does the model have `organizationId`? -> Check directly
   - Does it have `dealId`? -> Include deal and check `deal.organizationId`
   - Is it a sub-resource? -> Trace the FK chain to deal/org

2. **Add the check BEFORE any mutation or data return**

3. **Use consistent error messages**: "Access denied - [resource] belongs to different organization"

---

## Identity: What to Use vs. Avoid

### SAFE (use these):
| Source | Usage |
|--------|-------|
| `authUser.id` | User identification for all purposes |
| `authUser.email` | User email (validated from JWT) |
| `authUser.role` | Role-based authorization |
| `authUser.organizationId` | Org isolation checks |
| `authUser.name` | Display name |

### UNSAFE (never use for authorization):
| Header | Problem |
|--------|---------|
| `x-user-id` | Spoofable - client can set any value |
| `x-actor-role` | Spoofable - client can claim any role |
| `x-user-name` | Spoofable - only use for display fallback |
| `x-canonical-user-id` | Debug only - disabled in production |
| `x-debug-user-id` | Debug only - disabled in production |

---

## New Endpoint Template

```javascript
/**
 * [Description of what this endpoint does]
 * [HTTP METHOD] /api/path/:id
 *
 * Security:
 * - Auth: requireGP | requireAuth | requireLPEntitlement
 * - Org isolation: Via [direct|deal FK|requireDealAccess]
 * - Audit: [Yes - action name | No - read only]
 */
export async function handleSomething(req, res, resourceId, authUser) {
  const prisma = getPrisma();

  // 1. Fetch resource with org chain
  const resource = await prisma.model.findUnique({
    where: { id: resourceId },
    include: { deal: true }  // If needed for org check
  });

  if (!resource) {
    return sendError(res, 404, "Resource not found");
  }

  // 2. Org isolation check
  if (resource.deal?.organizationId && resource.deal.organizationId !== authUser.organizationId) {
    return sendError(res, 403, "Access denied - resource belongs to different organization");
  }

  // 3. Business logic...

  // 4. Audit log (if mutation)
  if (isMutation) {
    await logPermissionAction({
      actorId: authUser.id,
      actorName: authUser.name,
      action: 'ACTION_NAME',
      afterValue: { /* relevant data */ },
      ipAddress: req.headers["x-forwarded-for"] || req.socket?.remoteAddress
    });
  }

  // 5. Return response
  sendJson(res, 200, { resource });
}
```

---

## Code Review Security Checklist

When reviewing PRs, verify:

- [ ] All new endpoints use `requireAuth`/`requireGP`/`requireAdmin` from dispatch
- [ ] No use of `x-actor-role` or `x-user-id` headers for authorization
- [ ] Resources fetched by ID include org chain and have isolation check
- [ ] Financial operations create audit log entries
- [ ] Error messages don't leak internal details
- [ ] No new `resolveUserId(req)` calls - use `authUser.id` instead

---

## Testing Security

After implementing, verify with curl:

```bash
# Cross-org access should fail
curl -X GET "http://localhost:8787/api/resource/$OTHER_ORG_ID" \
  -H "Authorization: Bearer $MY_JWT"
# Expected: 403

# Header spoofing should fail
curl -X POST "http://localhost:8787/api/protected" \
  -H "Authorization: Bearer $LP_JWT" \
  -H "x-actor-role: Admin"
# Expected: 403 (role from JWT used, not header)

# Audit log created for privileged operations
# Check: SELECT * FROM PermissionAuditLog WHERE action='YOUR_ACTION'
```

---

## Quick Reference: Auth Middleware

| Middleware | Use When |
|------------|----------|
| `requireAuth(req, res)` | Any authenticated user needed |
| `requireGP(req, res)` | GP or Admin role required |
| `requireAdmin(req, res)` | Admin role only |
| `requireDealAccess(authUser, dealId, res)` | Verify user can access specific deal |
| `requireLPEntitlement(req, res, dealId, token)` | LP portal access |
| `validateNotSelfApproval(approverId, creatorId)` | Prevent maker-checker bypass |
| `checkApprovalExists(dealId, approvalType)` | Verify prerequisite approval |
| `logPermissionAction({...})` | Create audit trail |
