# LP Onboarding Workflow Diagram

## 1. LP Invitation Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                     GP Dashboard                                 │
│              (Kernel-Faithful Authority)                         │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ POST /api/lp/invitations
               │ { lpEmail, commitment, ownership_pct, dealId }
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Canonical BFF                               │
│              (Mediator & Data Steward)                           │
│                                                                  │
│  1. Verify dealId exists in Kernel                              │
│  2. Create LPInvitation (SQLite)                                │
│     - status: PENDING                                           │
│     - expiresAt: now + 30 days                                  │
│  3. Return invitation ID (for tracking)                         │
│  4. Send invitation email with accept link via notification API  │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ Email: "You've been invited to invest..."
               │ Link: /api/lp/invitations/{id}/accept
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                     LP Email                                     │
│               (Limited Partner)                                  │
│         [Accept Investment Invitation]                          │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ POST /api/lp/invitations/{id}/accept
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Canonical BFF                               │
│                                                                  │
│  1. Verify invitation exists & not expired                      │
│  2. Create Kernel Actor (role: "LP")                            │
│  3. Store LPActor (SQLite)                                      │
│     - email → kernel actorId                                    │
│     - commitment, ownership_pct                                 │
│  4. Update LPInvitation status → ACCEPTED                       │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ Response: 200 OK
               │ { invitationId, status: ACCEPTED }
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                    LP Portal Login                               │
│              (Read-Only Access Granted)                         │
└──────────────────────────────────────────────────────────────────┘
```

## 2. LP Portal Access Flow

```
┌──────────────────────────────────────────────────────────────────┐
│                      LP Browser                                  │
│              (X-User-Id: lp@company.com)                        │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ GET /api/lp/portal
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Canonical BFF                               │
│                                                                  │
│  1. Lookup LPActor by email + dealId                            │
│  2. Get all accepted invitations for LP                         │
│  3. Query Kernel for each deal:                                 │
│     - GET /deals/{dealId}                                       │
│     - GET /deals/{dealId}/snapshot                              │
│     - GET /deals/{dealId}/events                                │
│  4. Aggregate capital events (calls, distributions)             │
│  5. Return portfolio summary + investment list                  │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ Response: 200 OK
               │ {
               │   summary: {
               │     active_investments: 3,
               │     capital_committed: $15M,
               │     capital_deployed: $12M,
               │     distributions_ytd: $2.5M
               │   },
               │   investments: [
               │     {
               │       id, name, asset_type, status,
               │       last_update, key_notes
               │     },
               │     ...
               │   ]
               │ }
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                   LP Portal Landing Screen                       │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ Your Investments — Overview            │                     │
│  │                                        │                     │
│  │ Active Investments: 3                  │                     │
│  │ Capital Committed: $15,000,000         │                     │
│  │ Capital Deployed: $12,000,000          │                     │
│  │ Distributions YTD: $2,500,000          │                     │
│  └────────────────────────────────────────┘                     │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ Recent Investments                     │                     │
│  │                                        │                     │
│  │ 1. Downtown Office Tower               │                     │
│  │    Multifamily | Operating             │                     │
│  │    Last update: 2 days ago             │                     │
│  │    Key notes: None                     │                     │
│  │                                        │                     │
│  │ 2. Suburban Retail Complex             │                     │
│  │    Retail | Amended                    │                     │
│  │    Last update: 5 days ago             │                     │
│  │    Key notes: Temporary covenant       │                     │
│  │    relief approved Q1. No impact.      │                     │
│  │                                        │                     │
│  │ 3. Industrial Logistics Hub            │                     │
│  │    Industrial | Operating              │                     │
│  │    Last update: 1 day ago              │                     │
│  │    Key notes: None                     │                     │
│  └────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

## 3. Investment Detail View

```
┌──────────────────────────────────────────────────────────────────┐
│                      LP Browser                                  │
│      (Click on "Downtown Office Tower")                         │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ GET /api/lp/portal/deals/{dealId}
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Canonical BFF                               │
│                                                                  │
│  1. Verify LP has accepted invitation for dealId                │
│  2. Query Kernel:                                               │
│     - GET /deals/{dealId}                                       │
│     - GET /deals/{dealId}/snapshot                              │
│     - GET /deals/{dealId}/events                                │
│     - GET /deals/{dealId}/materials                             │
│  3. Transform capital events by type                            │
│  4. Build compliance status (covenants)                         │
│  5. Calculate performance metrics                               │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ Response: 200 OK + Cache (5 sec per user per deal)
               ▼
┌──────────────────────────────────────────────────────────────────┐
│           LP Investment Detail (Read-Only)                       │
│                                                                  │
│  Downtown Office Tower                                          │
│  Multifamily | Operating                                        │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ A. What You Own                        │                     │
│  │ ─────────────────────────────────────  │                     │
│  │ Entity: Fund III LP                    │                     │
│  │ Commitment: $5,000,000                 │                     │
│  │ Ownership: 15.3%                       │                     │
│  │ Effective Date: Jan 15, 2024           │                     │
│  └────────────────────────────────────────┘                     │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ B. Capital Events (Since Last Report)  │                     │
│  │ ─────────────────────────────────────  │                     │
│  │ • Capital Call #1: $3M (Jan 2024)      │                     │
│  │ • Capital Call #2: $2M (Apr 2024)      │                     │
│  │ • Distribution #1: $500k (Nov 2024)    │                     │
│  │ • Distribution #2: $250k (Dec 2024)    │                     │
│  └────────────────────────────────────────┘                     │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ C. Compliance & Risk                   │                     │
│  │ ─────────────────────────────────────  │                     │
│  │ Status: COMPLIANT ✓                    │                     │
│  │ Amended Covenants: 0                   │                     │
│  │ Notes: All covenants current            │                     │
│  └────────────────────────────────────────┘                     │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ D. Performance                         │                     │
│  │ ─────────────────────────────────────  │                     │
│  │ Cash In: $5,000,000 (capital deployed) │                     │
│  │ Cash Out: $750,000 (distributions)     │                     │
│  │ Net Invested: $4,250,000                │                     │
│  │ Period: Year-to-Date                   │                     │
│  └────────────────────────────────────────┘                     │
│                                                                  │
│  ┌────────────────────────────────────────┐                     │
│  │ E. Documents (Read-Only)               │                     │
│  │ ─────────────────────────────────────  │                     │
│  │ • Offering Memorandum (Feb 2024)       │                     │
│  │ • Amendment #1 (Jun 2024)              │                     │
│  │ • Q4 Investor Report (Dec 2024)        │                     │
│  │ • Capital Statement (Jan 15, 2025)     │                     │
│  └────────────────────────────────────────┘                     │
└──────────────────────────────────────────────────────────────────┘
```

## 4. Export / Report Generation

```
┌──────────────────────────────────────────────────────────────────┐
│                      LP Browser                                  │
│         (Click "Download Capital Statement")                    │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ GET /api/lp/portal/deals/{dealId}/report
               ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Canonical BFF                               │
│                                                                  │
│  1. Verify LP access                                            │
│  2. Query Kernel for events + materials                         │
│  3. Generate timestamped statement                              │
│  4. Add disclaimer language                                     │
│  5. Return as JSON file (downloadable)                          │
└──────────────┬──────────────────────────────────────────────────┘
               │
               │ Response: 200 OK
               │ Content-Type: application/json
               │ Content-Disposition: attachment; filename=...
               ▼
┌──────────────────────────────────────────────────────────────────┐
│              capital-statement-{dealId}.json                     │
│                                                                  │
│  {                                                               │
│    "generatedAt": "2025-01-14T14:32:00Z",                       │
│    "dealName": "Downtown Office Tower",                         │
│    "lpEntity": "Fund III LP",                                   │
│    "ownership": {                                               │
│      "commitment": 5000000,                                     │
│      "ownershipPct": 15.3                                       │
│    },                                                           │
│    "capitalStatement": {                                        │
│      "commitment": 5000000,                                     │
│      "called": 5000000,                                         │
│      "distributed": 750000                                      │
│    },                                                           │
│    "disclaimers": [                                             │
│      "Generated on 2025-01-14. Reflects verified data as of...",│
│      "This statement contains confidential information.",       │
│      "LP Portal data is read-only and reflects current..."      │
│    ]                                                            │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
```

## 5. Data Consistency with Kernel

```
         ┌─────────────────────────────────────┐
         │      Kernel API (Authority)         │
         │   (Single Source of Truth)          │
         │                                     │
         │  - /deals/{dealId}                 │
         │  - /deals/{dealId}/events          │
         │  - /deals/{dealId}/snapshot        │
         │  - /deals/{dealId}/materials       │
         │  - /deals/{dealId}/actors          │
         └────────────┬────────────────────────┘
                      │
                      │ All LP data
                      │ timestamp-verified
                      │
        ┌─────────────▼────────────────────┐
        │      Canonical BFF               │
        │   (Mediator & Translator)        │
        │                                  │
        │  - Query Kernel on every LP     │
        │    request (no local caching    │
        │    of gating decisions)         │
        │                                  │
        │  - SQLite stores only:          │
        │    • LPInvitation status        │
        │    • LPActor credentials        │
        │    • Portal access timestamps   │
        └─────────────┬────────────────────┘
                      │
                      │ Transformed for LP view
                      │ (plain English, no jargon)
                      │
        ┌─────────────▼────────────────────┐
        │     LP Portal (Read-Only)        │
        │                                  │
        │  "LPs see what GPs see,         │
        │   minus the machinery"          │
        └────────────────────────────────┘

## 4. LP Event Webhook Flow

```
┌──────────────────────────────┐
│ Kernel emits capital events  │
│ (CapitalCalled, Distribution │
│ Processed, ReturnProcessed)  │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Canonical BFF (events.js)     │
│ - invalidates caches          │
│ - emits LP_INVITATION_* /     │
│   capital event webhooks      │
│ - POSTs to BFF_LP_NOTIFICATION_WEBHOOK_URL │
└──────────────┬───────────────┘
               │
               ▼
┌──────────────────────────────┐
│ Downstream LP notifier        │
│ (email, SMS, ERP, etc.)       │
└──────────────────────────────┘
```

- Each webhook payload carries `eventType`, `detail`, `dealId`, `actorId`, and `source: canonical-bff` so receivers can trigger LP alerts without polling the Kernel.
- Configure `BFF_LP_NOTIFICATION_WEBHOOK_URL` (plus optional secret/header) to subscribe to real-time capital calls/distributions/returns plus `LP_INVITATION_SENT` / `LP_INVITATION_ACCEPTED` events.

Key Principle: Every LP data point is verified
against Kernel, never cached locally.
```

## 6. Caching Strategy

```
LP Portal Landing
├─ Key: lp-portal:landing:{email}
├─ TTL: 5 seconds
└─ Invalidated: On deal event, capital call, distribution

Investment Detail
├─ Key: lp-portal:detail:{dealId}:{email}
├─ TTL: 5 seconds
└─ Invalidated: On deal event, capital call, distribution

Capital Statement Export
├─ Not cached (fresh data for legal/audit)
└─ Always queries Kernel
```

---

**LP Onboarding Flow Complete** ✅
