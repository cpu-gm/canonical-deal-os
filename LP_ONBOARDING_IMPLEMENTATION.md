# LP Onboarding Implementation (Phase 2)

## Overview

The LP (Limited Partner) onboarding feature enables read-only access to deal information for LPs, with invitation-based access control, capital event tracking, and compliance reporting.

**Core Philosophy**: "LPs see the same truth the GP sees − minus the machinery."

## Implementation Status

✅ **COMPLETED** - All core features implemented and tested

### Features Implemented

1. **LP Invitation System** - GP sends invite, LP accepts, Kernel actor created
2. **LP Portal Landing** - Portfolio summary with list of active investments  
3. **LP Investment Detail** - Capital events, compliance status, performance metrics
4. **LP Document Access** - Read-only access to offering documents, amendments, reports
5. **LP Exports** - Timestamped capital statements with compliance disclaimers
6. **Data Models** - LPInvitation and LPActor tables in SQLite

## Project Structure

### New Files Created

```
canonical-deal-os/
  server/
    routes/lp-onboarding.js           (550 lines - all LP endpoints)
  src/lib/
    contracts.js                      (updated with LP schemas)
  server/prisma/
    schema.prisma                     (updated with LP models)
```

### Route Files Modified

```
canonical-deal-os/
  server/
    index.js                          (added LP route registration)
```

## API Endpoints

### LP Invitation Management

**POST /api/lp/invitations**
- Send invitation to LP for a deal
- Body: `{ lpEntityName, lpEmail, dealId, commitment, ownershipPct }`
- Response: 201 Created with invitation details
- Access: GP (verifies deal exists)

**POST /api/lp/invitations/:invitationId/accept**
- Accept LP invitation
- Body: `{ acceptanceToken }`
- Creates Kernel actor with role "LP"
- Response: 200 OK with updated invitation
- Access: LP via token

**GET /api/lp/deals/:dealId/invitations**
- List all invitations for a deal
- Response: Array of invitations with status
- Access: GP

**GET /api/lp/actors/:dealId**
- List active LP actors for a deal
- Response: Array of LP actor profiles
- Access: GP

### LP Portal Access

**GET /api/lp/portal**
- LP portfolio landing screen
- Returns:
  - Portfolio summary: active investments, capital committed/deployed, distributions YTD
  - Investment list: name, asset type, status, last update, key notes
- Access: LP (authenticated by email header `X-User-Id` or `X-Canonical-User-Id`)
- Cache: 5 seconds per user

**GET /api/lp/portal/deals/:dealId**
- Investment detail with capital events and compliance
- Returns:
  - Ownership: entity, commitment, ownership %, effective dates
  - Capital events: calls, distributions, returns
  - Compliance: status, amended covenants count, notes
  - Performance: cash in/out, net invested, distributions to date
  - Documents: offering docs, amendments, reports
- Access: LP (verified access to deal)
- Cache: 5 seconds per deal per user

**GET /api/lp/portal/deals/:dealId/report**
- Export timestamped capital statement
- Returns JSON file with:
  - Generation timestamp
  - Capital statement (commitment, called, distributed)
  - Disclaimers for disputes
- Access: LP (verified access)
- Content-Type: application/json (downloadable)

## Data Models

### LPInvitation

```prisma
model LPInvitation {
  id               String     @id @default(uuid())
  dealId           String
  lpEntityName     String
  lpEmail          String
  commitment       Float
  ownershipPct     Float
  status           String     @default("PENDING")
  createdByUserId  String?
  createdAt        DateTime   @default(now())
  acceptedAt       DateTime?
  expiresAt        DateTime
  actorId          String?    // Kernel actor ID when accepted

  @@index([dealId])
  @@index([lpEmail])
  @@index([status])
  @@unique([dealId, lpEmail])
}
```

### LPActor

```prisma
model LPActor {
  id              String     @id @default(uuid())
  dealId          String
  email           String
  entityName      String
  actorId         String     // Kernel actor ID
  commitment      Float
  ownershipPct    Float
  status          String     @default("ACTIVE")
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@unique([email, dealId])
  @@index([dealId])
  @@index([email])
  @@index([status])
}
```

## Zod Schemas

All LP data validation uses Zod schemas in [src/lib/contracts.js](src/lib/contracts.js):

- `lpInvitationRequestSchema` - Send invite validation
- `lpInvitationSchema` - Invitation response
- `lpInvestmentDetailSchema` - Investment detail response
- `lpPortalLandingSchema` - Portal landing response
- `lpOwnershipSchema` - Ownership structure
- `lpCapitalEventSchema` - Capital event (call, distribution, return, fee)
- `lpCovenantComplianceSchema` - Compliance status
- `lpPerformanceSnapshotSchema` - Performance metrics

## Environment Variables

Add to `.env`:

```
# LP Portal caching
BFF_LP_PORTAL_TTL_MS=5000        # Cache LP portal queries (default: 5000ms)

# Invitation expiration
BFF_LP_INVITATION_EXPIRY_DAYS=30 # Invitation validity period (default: 30 days)
```

## Caching Strategy

- **LP portal landing**: 5-second cache per user
  - Key: `lp-portal:landing:{userId}`
  - Invalidated on: deal event append, new capital call, distribution
- **Investment detail**: 5-second cache per deal per user
  - Key: `lp-portal:detail:{dealId}:{userId}`
  - Invalidated on: deal event append, new capital call, distribution
- **Snapshots**: Reused from deal caching (5000ms TTL)

## Error Handling

All LP errors are user-facing (no tech jargon):

| Error | Status | Message |
|-------|--------|---------|
| Invalid request | 400 | "Invalid request" |
| Deal not found | 404 | "Deal not found" |
| Invitation not found | 404 | "Invitation not found" |
| Invitation expired | 410 | "Invitation expired" |
| No LP access | 403 | "LP does not have access to this deal" |
| Kernel unavailable | 502 | "Kernel unavailable" |
| Already processed | 409 | "Invitation already processed" |

## Workflow: Inviting an LP

1. **GP sends invitation** via `POST /api/lp/invitations`
   ```json
   {
     "lpEntityName": "Acme Capital Partners",
     "lpEmail": "contact@acmecapital.com",
     "dealId": "550e8400-e29b-41d4-a716-446655440000",
     "commitment": 5000000,
     "ownershipPct": 10.5
   }
   ```
   - BFF creates pending invitation (expires in 30 days)
   - Returns invitation ID for tracking
   - Sends invitation email with accept link to the configured notification endpoint

2. **LP accepts via link** → `POST /api/lp/invitations/:invitationId/accept`
   - BFF creates Kernel actor with role "LP"
   - Stores LPActor record for future access
   - Updates invitation status → ACCEPTED

3. **LP accesses portal** → `GET /api/lp/portal`
   - Authenticated by email header (`X-User-Id` or `X-Canonical-User-Id`)
   - BFF verifies LP has accepted invitations
   - Returns portfolio summary + investment list
   - All data timestamp-verified from Kernel

4. **LP views investment detail** → `GET /api/lp/portal/deals/:dealId`
   - BFF verifies LP has access to this specific deal
   - Returns capital events, compliance, performance
   - Documents show audit trail (when added, what supersedes)

## Deployment Guide

### Staging & Production Release
- Build the UI bundle with `npm run build` so the `dist/` folder contains the production assets that ship to the CDN or static host.
- Push the latest schema and seed data for the BFF: `cd canonical-deal-os && npx prisma db push --schema server/prisma/schema.prisma`.
- Start the BFF with the target environment variables (e.g., `NODE_ENV=production`, `KERNEL_API_URL` pointing to the staging/production kernel, `BFF_PUBLIC_URL` set to the external BFF URL).
- Supply the LP notification configuration so the portal can send invitations and publish webhooks:
  - `BFF_LP_INVITATION_EMAIL_ENDPOINT` (and optional `BFF_LP_INVITATION_EMAIL_API_KEY`, `BFF_LP_INVITATION_EMAIL_FROM`, `BFF_LP_INVITATION_BASE_URL`)
  - `BFF_LP_NOTIFICATION_WEBHOOK_URL` (and optional `BFF_LP_NOTIFICATION_WEBHOOK_SECRET`/`BFF_LP_NOTIFICATION_WEBHOOK_HEADER`)
- Ensure the public-facing LP portal URL (`BFF_PUBLIC_URL`) matches the host used in the invitation accept link so the email directs LPs to the right place.
- For staging, point `KERNEL_API_URL` to the staging kernel, run `npm run bff`, and smoke-test all LP endpoints before promoting the same configuration to production.

### Post-Deploy Verification
- Hit `<public-url>/health` (or `curl http://localhost:8787/health` for local/light testing) and confirm `status: ok`.
- Run the curl commands listed in the Testing section below against the staging or production BFF to exercise invitation creation, listing, and portal reads.
- Review the BFF logs (`bff-console.log` or stdout) for confirmation that the invitation email and webhook flows fire when `BFF_LP_INVITATION_EMAIL_ENDPOINT`/`BFF_LP_NOTIFICATION_WEBHOOK_URL` are set.
- Monitor the SQLite file (`server/.data/llm-airlock.db`) to verify `LPInvitation`/`LPActor` rows are created, and rotate the database file into production backups as configured by operations.

## Testing the Implementation

### 1. Health Check
```bash
curl http://localhost:8787/health
# Expected: { "status": "ok", "kernelTarget": "...", "kernelStatus": 200 }
```

### 2. Send LP Invitation
```bash
curl -X POST http://localhost:8787/api/lp/invitations \
  -H "Content-Type: application/json" \
  -H "X-User-Id: gp-user-123" \
  -d '{
    "lpEntityName": "Test LP",
    "lpEmail": "test@example.com",
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "commitment": 1000000,
    "ownershipPct": 5
  }'
```

### 3. List LP Invitations
```bash
curl http://localhost:8787/api/lp/deals/550e8400-e29b-41d4-a716-446655440000/invitations \
  -H "X-User-Id: gp-user-123"
```

### 4. LP Portal Landing (Read-Only)
```bash
curl http://localhost:8787/api/lp/portal \
  -H "X-User-Id: test@example.com"
```

### 5. Investment Detail (Read-Only)
```bash
curl "http://localhost:8787/api/lp/portal/deals/550e8400-e29b-41d4-a716-446655440000" \
  -H "X-User-Id: test@example.com"
```

## Notifications & Webhooks

- **Email invitations**: When `BFF_LP_INVITATION_EMAIL_ENDPOINT` is defined the BFF POSTs a payload that includes the LP email, invitation UUID, deal metadata, commitment, ownership, and a direct link (`BFF_LP_INVITATION_BASE_URL` + `/api/lp/invitations/{invitationId}/accept`). Optional headers (`BFF_LP_INVITATION_EMAIL_API_KEY`, `BFF_LP_INVITATION_EMAIL_FROM`) allow integration with SendGrid, Postmark, or any transactional API. Successful sends are logged and failures surface in the log output without failing the BFF request.
- **LP webhooks**: Capital events (`CapitalCalled`, `DistributionProcessed`, `ReturnProcessed`) and invitation lifecycle events (`LP_INVITATION_SENT`, `LP_INVITATION_ACCEPTED`) are emitted to `BFF_LP_NOTIFICATION_WEBHOOK_URL`. The BFF adds `X-LP-Webhook-Secret` (or your custom header via `BFF_LP_NOTIFICATION_WEBHOOK_HEADER`) with the secret value from `BFF_LP_NOTIFICATION_WEBHOOK_SECRET`, so recipients can authenticate the payload.
- **Payload shape**: Each webhook contains `eventType`, the LP detail (`dealId`, `lpEmail`, `actorId`, etc.), the raw event payload/authority context, and a `source: canonical-bff` timestamp. This lets downstream systems notify LPs in real time about invitations, capital calls, distributions, or returns without polling the Kernel.

## Database Migration

The Prisma schema was updated with LP tables:

```bash
cd canonical-deal-os
npx prisma db push --schema server/prisma/schema.prisma
```

This creates:
- `LPInvitation` table with pending/accepted/rejected/revoked statuses
- `LPActor` table with active LP records for each deal

## Next Steps (Future Enhancements)

1. **Bulk Invitations**: Import LP lists from CSV for multi-LP deals (Phase 2)
2. **Multi-Language Support**: Localize the portal for international LPs
3. **Document Versioning**: Track amendment history and expose deltas
4. **LP Reporting**: Custom report templates, scheduled delivery, and exports
5. **Two-Factor Auth**: Enhanced security for LP portal access
6. **Activity Logging**: Track LP portal usage for audit and compliance

_Email invitations and LP webhooks are live. Phase 2 (bulk import, custom reporting, MFA, etc.) remains on hold until the product team explicitly greenlights it._ 

## Architecture Principles Followed

1. **Kernel Authority**: All decisions verified against Kernel
2. **Read-Only UI**: LP portal never modifies deal state
3. **Data Privacy**: LPs only see their own investments
4. **Timestamps**: All exports include generation timestamp
5. **User-Safe Errors**: No tech jargon in error messages
6. **Caching**: 5-second TTL to balance freshness vs. performance
7. **Modularity**: LP routes isolated in dedicated module
8. **Type Safety**: Zod schemas validate all inputs/outputs

## References

- [LP Onboarding Routes](server/routes/lp-onboarding.js)
- [Zod Contracts](src/lib/contracts.js) - LP-specific schemas
- [Prisma Schema](server/prisma/schema.prisma) - LPInvitation, LPActor models
- [BFF Index](server/index.js) - LP route registration
- [Copilot Instructions](.github/copilot-instructions.md) - Full architecture guide

---

**Implementation Date**: January 14, 2026  
**Status**: ✅ Production Ready  
**Test Coverage**: All endpoints tested, BFF health check passing
