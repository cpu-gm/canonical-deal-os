# LP Onboarding API Reference

## Overview

The LP Onboarding API provides complete functionality for managing Limited Partner invitations, portal access, and reporting across the Canonical deal management system.

**Base URL**: `http://localhost:8787` (development) | `https://dealos.io` (production)

**Authentication**: `X-User-Id` header (email or user ID)

---

## Authentication

All LP endpoints require the `X-User-Id` header:

```bash
curl -H "X-User-Id: user@example.com" https://dealos.io/api/lp/portal
```

For GP operations (creating invitations), use a GP user ID:

```bash
curl -H "X-User-Id: gp@example.com" https://dealos.io/api/lp/invitations
```

---

## Endpoints

### 1. Send LP Invitation

**Endpoint**: `POST /api/lp/invitations`

**Description**: Create a new LP invitation for a deal

**Headers**:
```
Content-Type: application/json
X-User-Id: gp@example.com
```

**Request Body**:
```json
{
  "lpEntityName": "Acme Capital Partners",
  "lpEmail": "invest@acme.example.com",
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "commitment": 5000000,
  "ownershipPct": 10
}
```

**Response** (201 Created):
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "lpEntityName": "Acme Capital Partners",
  "lpEmail": "invest@acme.example.com",
  "status": "PENDING",
  "commitment": 5000000,
  "ownershipPct": 10,
  "createdAt": "2026-01-14T12:00:00Z",
  "acceptedAt": null,
  "expiresAt": "2026-02-13T12:00:00Z"
}
```

**Error Responses**:
- `400 Bad Request`: Invalid input data
- `404 Not Found`: Deal not found
- `502 Bad Gateway`: Kernel unavailable

---

### 2. Accept LP Invitation

**Endpoint**: `POST /api/lp/invitations/{invitationId}/accept`

**Description**: Accept an LP invitation and create Kernel actor

**Parameters**:
- `invitationId` (path): UUID of the invitation

**Headers**:
```
Content-Type: application/json
```

**Request Body**:
```json
{}
```

**Response** (200 OK):
```json
{
  "id": "123e4567-e89b-12d3-a456-426614174000",
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "lpEntityName": "Acme Capital Partners",
  "lpEmail": "invest@acme.example.com",
  "status": "ACCEPTED",
  "commitment": 5000000,
  "ownershipPct": 10,
  "createdAt": "2026-01-14T12:00:00Z",
  "acceptedAt": "2026-01-14T13:00:00Z",
  "expiresAt": "2026-02-13T12:00:00Z"
}
```

**Error Responses**:
- `404 Not Found`: Invitation not found
- `409 Conflict`: Invitation already processed
- `410 Gone`: Invitation expired
- `502 Bad Gateway`: Kernel unavailable

---

### 3. List LP Invitations

**Endpoint**: `GET /api/lp/deals/{dealId}/invitations`

**Description**: List all LP invitations for a deal (GP only)

**Parameters**:
- `dealId` (path): UUID of the deal

**Headers**:
```
X-User-Id: gp@example.com
```

**Response** (200 OK):
```json
{
  "items": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "dealId": "550e8400-e29b-41d4-a716-446655440000",
      "lpEntityName": "Acme Capital Partners",
      "lpEmail": "invest@acme.example.com",
      "status": "PENDING",
      "commitment": 5000000,
      "ownershipPct": 10,
      "createdAt": "2026-01-14T12:00:00Z",
      "acceptedAt": null,
      "expiresAt": "2026-02-13T12:00:00Z"
    }
  ]
}
```

---

### 4. LP Portal Landing

**Endpoint**: `GET /api/lp/portal`

**Description**: Get LP portfolio summary and investment list

**Headers**:
```
X-User-Id: invest@acme.example.com
```

**Query Parameters**: (none)

**Response** (200 OK):
```json
{
  "summary": {
    "active_investments": 3,
    "capital_committed": 15000000,
    "capital_deployed": 8500000,
    "distributions_ytd": 650000
  },
  "investments": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "name": "Downtown Mixed-Use Development",
      "asset_type": "Mixed-Use",
      "status": "OPERATING",
      "last_update": "2026-01-10T00:00:00Z",
      "key_notes": "Q4 2025 distributions processed"
    }
  ]
}
```

---

### 5. LP Investment Detail

**Endpoint**: `GET /api/lp/portal/deals/{dealId}`

**Description**: Get detailed investment information including capital events and compliance

**Parameters**:
- `dealId` (path): UUID of the deal

**Headers**:
```
X-User-Id: invest@acme.example.com
```

**Response** (200 OK):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Downtown Mixed-Use Development",
  "asset_type": "Mixed-Use",
  "status": "OPERATING",
  "last_update": "2026-01-10T00:00:00Z",
  "ownership": {
    "entity": "Acme Capital Partners",
    "commitment": 5000000,
    "ownership_pct": 10,
    "effective_date": "2025-06-01T00:00:00Z",
    "end_date": null
  },
  "capital_events": [
    {
      "id": "evt-001",
      "type": "CALL",
      "amount": 2500000,
      "date": "2025-06-15T00:00:00Z",
      "description": "Initial capital call",
      "timestamp": "2025-06-15T00:00:00Z"
    },
    {
      "id": "evt-002",
      "type": "DISTRIBUTION",
      "amount": 325000,
      "date": "2025-12-31T00:00:00Z",
      "description": "Q4 2025 distribution",
      "timestamp": "2025-12-31T00:00:00Z"
    }
  ],
  "compliance": {
    "status": "COMPLIANT",
    "amended_covenants": 0,
    "details": "All covenants in compliance"
  },
  "performance": {
    "cash_in": 2500000,
    "cash_out": 325000,
    "net_invested": 2175000,
    "distributions_to_date": 325000,
    "period": "YTD"
  },
  "documents": [
    {
      "id": "doc-001",
      "name": "Offering Memorandum",
      "type": "OfferingDoc",
      "added_date": "2025-05-01T00:00:00Z",
      "supersedes": null
    }
  ]
}
```

**Error Responses**:
- `403 Forbidden`: LP does not have access to this deal
- `404 Not Found`: Deal not found
- `502 Bad Gateway`: Kernel unavailable

---

### 6. LP Portal Export

**Endpoint**: `GET /api/lp/portal/deals/{dealId}/report`

**Description**: Download timestamped capital statement and event summary

**Parameters**:
- `dealId` (path): UUID of the deal

**Headers**:
```
X-User-Id: invest@acme.example.com
```

**Response** (200 OK - JSON file):
```json
{
  "generatedAt": "2026-01-14T12:00:00Z",
  "dealName": "Downtown Mixed-Use Development",
  "lpEntity": "Acme Capital Partners",
  "ownership": {
    "commitment": 5000000,
    "ownershipPct": 10
  },
  "capitalStatement": {
    "commitment": 5000000,
    "called": 2500000,
    "distributed": 325000
  },
  "disclaimers": [
    "Generated on [TIMESTAMP]. Reflects verified data as of [TIMESTAMP].",
    "This statement contains confidential information.",
    "LP Portal data is read-only and reflects current verified state."
  ]
}
```

---

### 7. List LP Actors

**Endpoint**: `GET /api/lp/actors/{dealId}`

**Description**: List active LP actors for a deal (GP only)

**Parameters**:
- `dealId` (path): UUID of the deal

**Headers**:
```
X-User-Id: gp@example.com
```

**Response** (200 OK):
```json
{
  "items": [
    {
      "id": "actor-001",
      "dealId": "550e8400-e29b-41d4-a716-446655440000",
      "entityName": "Acme Capital Partners",
      "email": "invest@acme.example.com",
      "actorId": "kernel-actor-123",
      "commitment": 5000000,
      "ownershipPct": 10,
      "status": "ACTIVE",
      "createdAt": "2026-01-14T12:00:00Z"
    }
  ]
}
```

---

### 8. Bulk LP Import

**Endpoint**: `POST /api/lp/bulk-import`

**Description**: Bulk import multiple LP invitations for a deal

**Headers**:
```
Content-Type: application/json
X-User-Id: gp@example.com
```

**Request Body**:
```json
{
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "investors": [
    {
      "lpEntityName": "Fund A",
      "lpEmail": "funda@example.com",
      "commitment": 2000000,
      "ownershipPct": 4
    },
    {
      "lpEntityName": "Fund B",
      "lpEmail": "fundb@example.com",
      "commitment": 3000000,
      "ownershipPct": 6
    }
  ]
}
```

**Response** (207 Multi-Status):
```json
{
  "total": 2,
  "succeeded": 2,
  "failed": 0,
  "errors": [],
  "invitations": [
    {
      "id": "inv-001",
      "lpEmail": "funda@example.com",
      "status": "created"
    },
    {
      "id": "inv-002",
      "lpEmail": "fundb@example.com",
      "status": "created"
    }
  ]
}
```

**Error Responses**:
- `400 Bad Request`: Invalid bulk import data
- `404 Not Found`: Deal not found
- `502 Bad Gateway`: Kernel unavailable

---

### 9. Generate Custom Report

**Endpoint**: `POST /api/lp/reports/generate`

**Description**: Generate custom LP report with filters

**Headers**:
```
Content-Type: application/json
X-User-Id: gp@example.com
```

**Request Body**:
```json
{
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "reportType": "capital_statement",
  "filters": {
    "startDate": "2026-01-01T00:00:00Z",
    "endDate": "2026-12-31T23:59:59Z",
    "lpEmails": ["invest@acme.example.com"]
  }
}
```

**Report Types**:
- `capital_statement`: Capital calls, distributions, net cash flow
- `distribution_summary`: Distribution events with timing and amounts
- `irr_performance`: Internal rate of return analysis (beta)

**Response** (200 OK - JSON file):
```json
{
  "reportType": "capital_statement",
  "dealName": "Downtown Mixed-Use Development",
  "dealId": "550e8400-e29b-41d4-a716-446655440000",
  "generatedAt": "2026-01-14T12:00:00Z",
  "period": {
    "startDate": "2026-01-01T00:00:00Z",
    "endDate": "2026-12-31T23:59:59Z"
  },
  "lpCount": 1,
  "statements": [
    {
      "lpEmail": "invest@acme.example.com",
      "lpEntity": "Acme Capital Partners",
      "commitment": 5000000,
      "ownershipPct": 10,
      "capitalCalled": 2500000,
      "distributions": 325000,
      "netCashFlow": -2175000,
      "period": {
        "startDate": "2026-01-01T00:00:00Z",
        "endDate": "2026-12-31T23:59:59Z"
      }
    }
  ],
  "totals": {
    "totalCommitment": 5000000,
    "totalCapitalCalled": 2500000,
    "totalDistributions": 325000
  },
  "disclaimer": "This report is confidential and contains proprietary information."
}
```

---

## HTTP Status Codes

| Code | Meaning | Scenario |
|------|---------|----------|
| 200 | OK | Successful GET request |
| 201 | Created | Invitation successfully created |
| 207 | Multi-Status | Bulk import with partial success |
| 400 | Bad Request | Invalid input data |
| 403 | Forbidden | LP lacks access to resource |
| 404 | Not Found | Resource not found |
| 409 | Conflict | Duplicate or state conflict |
| 410 | Gone | Invitation expired |
| 502 | Bad Gateway | Kernel unavailable |

---

## Webhooks

When configured, these events trigger webhook calls:

### LP_INVITATION_SENT
Fired when GP sends an LP invitation

```json
{
  "eventType": "LP_INVITATION_SENT",
  "detail": {
    "invitationId": "123e4567-e89b-12d3-a456-426614174000",
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "lpEmail": "invest@acme.example.com",
    "lpEntityName": "Acme Capital Partners",
    "commitment": 5000000,
    "ownershipPct": 10,
    "expiresAt": "2026-02-13T12:00:00Z"
  },
  "timestamp": "2026-01-14T12:00:00Z",
  "source": "canonical-bff"
}
```

### LP_INVITATION_ACCEPTED
Fired when LP accepts an invitation

```json
{
  "eventType": "LP_INVITATION_ACCEPTED",
  "detail": {
    "invitationId": "123e4567-e89b-12d3-a456-426614174000",
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "lpEmail": "invest@acme.example.com",
    "actorId": "kernel-actor-123"
  },
  "timestamp": "2026-01-14T13:00:00Z",
  "source": "canonical-bff"
}
```

### LP_CAPITAL_EVENT
Fired when capital call or distribution occurs

```json
{
  "eventType": "LP_CAPITAL_EVENT",
  "detail": {
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "eventType": "CapitalCalled",
    "payload": { "amount": 2500000 },
    "kernelEventId": "evt-001"
  },
  "timestamp": "2025-06-15T00:00:00Z",
  "source": "canonical-bff"
}
```

### LP_BULK_IMPORT_COMPLETED
Fired when bulk import completes

```json
{
  "eventType": "LP_BULK_IMPORT_COMPLETED",
  "detail": {
    "dealId": "550e8400-e29b-41d4-a716-446655440000",
    "total": 2,
    "succeeded": 2,
    "failed": 0
  },
  "timestamp": "2026-01-14T12:00:00Z",
  "source": "canonical-bff"
}
```

---

## Rate Limiting

No rate limiting currently enforced. Contact support if needed for high-volume integrations.

---

## Pagination

List endpoints return all results. For large datasets, use filters (see custom reports).

---

## Error Handling

All error responses follow this format:

```json
{
  "message": "Human-readable error message",
  "details": {
    "field1": ["error description"],
    "field2": ["error description"]
  }
}
```

Example:

```json
{
  "message": "Invalid request",
  "details": {
    "lpEmail": ["must be a valid email address"],
    "commitment": ["must be a positive number"]
  }
}
```

---

## Caching

**Portal Landing** (`GET /api/lp/portal`): Cached for 5 seconds per user

**Investment Detail** (`GET /api/lp/portal/deals/{dealId}`): Cached for 5 seconds per deal per user

**Export/Report**: No caching (always fresh)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0.0 | 2026-01-14 | Initial release with 9 core endpoints |
| 1.1.0 (planned) | Q1 2026 | Email notifications, webhook events |
| 1.2.0 (planned) | Q2 2026 | Advanced reporting, IRR calculations |

---

## Support

For API issues or questions:
- **Documentation**: [Internal Wiki]
- **Slack**: #canonical-lp-onboarding
- **Email**: support@dealos.io
- **Issues**: [GitHub Issues]
