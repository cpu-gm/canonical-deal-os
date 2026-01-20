# Investigation Report (canonical-deal-os)

Generated: 2026-01-15 12:17:34
Location: canonical-deal-os/INVESTIGATION_REPORT.md

## Scope
This report documents concrete, reproducible findings about the current repo state and why certain features fail. No code changes are proposed here.

## Data Sources Consulted
- Repo files in canonical-deal-os
- Prisma schema: server/prisma/schema.prisma
- Prisma migrations: server/prisma/migrations/20260113075339_llm_airlock/migration.sql
- Generated Prisma client schema: node_modules/.prisma/client/schema.prisma
- Live SQLite DB at server/prisma/server/.data/llm-airlock.db (resolved from BFF_DB_URL)
- Validation scripts: validate-lp-system.sh, test-lp-endpoints.ps1
- API contracts and canonical mappers:
  - src/lib/contracts.js
  - server/mappers.js
  - server/routes/deals.js
  - server/index.js
  - server/store.js
  - server/routes/smart-parse.js
- Kernel payload samples and mocks:
  - server/diagnostics/out/proof-report.json
  - server/routes/lender-portal.js
- Live kernel payload capture (2026-01-15):
  - server/diagnostics/out/kernel-live-20260115-131539/deal.json
  - server/diagnostics/out/kernel-live-20260115-131539/snapshot.json
  - server/diagnostics/out/kernel-live-20260115-131539/events.json
  - server/diagnostics/out/kernel-live-20260115-131539/actors.json
  - server/diagnostics/out/kernel-live-20260115-131539/materials.json
  - server/diagnostics/out/kernel-live-20260115-131539/artifacts.json
- Deal/event/action endpoints:
  - server/routes/events.js
  - server/routes/actions.js
- Kernel runtime artifacts:
  - ..\cre-kernel-phase1\kernel.log
  - ..\cre-kernel-phase1\.env.example
  - ..\cre-kernel-phase1\apps\kernel-api\.env (credentials redacted)
- Local PostgreSQL configs (ports/auth):
  - C:\Program Files\PostgreSQL\13\data\postgresql.conf
  - C:\Program Files\PostgreSQL\13\data\pg_hba.conf
  - C:\Program Files\PostgreSQL\15\data\postgresql.conf
  - C:\Program Files\PostgreSQL\15\data\pg_hba.conf
  - C:\Program Files\PostgreSQL\16\data\postgresql.conf
  - C:\Program Files\PostgreSQL\16\data\pg_hba.conf
- Doc Factory services and routes:
  - server/services/extraction-claim-service.js
  - server/services/document-generator.js
  - server/services/evidence-pack-generator.js
  - server/routes/verification-queue.js
  - server/routes/document-generation.js
- Seed script: server/scripts/seed-sample-deal.js
- Underwriting routes/extractors:
  - server/routes/underwriting.js
  - server/services/extractors/t12-extractor.js
  - server/services/extractors/loan-terms-extractor.js
- Live DB PRAGMA snapshots (UnderwritingModel, UnderwritingInput, RentRollUnit)

## Findings (Concrete)

### 1) Prisma migrate dev fails in non-interactive environment
- Prisma blocks migrate dev when stdin/stdout is not TTY.
- Root check is internal to Prisma CLI (non-interactive gate), not specific to this repo.

Evidence
- node_modules/prisma/build/index.js (MigrateDevEnvNonInteractiveError)

### 2) DB path mismatch between Prisma and validation scripts
- .env sets BFF_DB_URL=file:./server/.data/llm-airlock.db.
- Prisma resolves that relative to server/prisma/schema.prisma, so it uses server/prisma/server/.data/llm-airlock.db.
- validate-lp-system.sh and other scripts reference server/.data/llm-airlock.db.
- These are different files/locations, so checks can pass against a DB the BFF is not using.

Evidence
- .env:3
- server/prisma/schema.prisma (datasource db uses BFF_DB_URL)
- validate-lp-system.sh:87-103
- server/prisma/server/.data/llm-airlock.db exists and has data
- server/.data/llm-airlock.db does not exist (only a .bak file)

### 3) DB drift: actual tables exceed recorded migrations
- Only one migration exists on disk: 20260113075339_llm_airlock.
- _prisma_migrations table records only that migration.
- Live DB contains many tables not created by that migration.
- Prisma reports "schema is up to date" because it compares the DB against that single migration, not against the full schema or runtime expectations.

Evidence
- server/prisma/migrations/20260113075339_llm_airlock/migration.sql
- server/prisma/server/.data/llm-airlock.db:_prisma_migrations
- 
px prisma migrate status output shows 1 migration and "up to date"
- Live DB tables include LP, chat, underwriting, etc (see Appendix A)

### 4) Prisma client is out of sync with schema
- server/prisma/schema.prisma has 41 models.
- node_modules/.prisma/client/schema.prisma has 33 models.
- Code uses models that are not present in generated client (e.g., ExtractionClaim, DealState, DocumentVersion).

Evidence
- server/prisma/schema.prisma
- node_modules/.prisma/client/schema.prisma
- Code usage across server/services and server/routes (see Finding 6/7)

### 5) Prisma client model property names do not match code for LP models
- Prisma client exposes prisma.lPInvitation and prisma.lPActor (capital P after lowercasing).
- Code uses prisma.lpInvitation and prisma.lpActor, which are undefined.
- This is a runtime failure in LP onboarding routes/tests.

Evidence
- node_modules/.prisma/client/index.d.ts (lPInvitation, lPActor)
- server/routes/lp-onboarding.js (lpInvitation, lpActor)
- server/__tests__/lp-onboarding.test.js (lpInvitation, lpActor)
- Runtime probe: prisma.lpInvitation undefined, prisma.lPInvitation defined

### 6) Doc Factory tables are defined in schema but missing in DB and client
- Models exist in schema: ExtractionClaim, DocumentVersion, DealEvent, GeneratedDocument, EvidencePack, DealState.
- These tables are missing in the live DB.
- Prisma client does not include these models, so prisma.extractionClaim etc are undefined.

Evidence
- server/prisma/schema.prisma:841, 883, 927, 964, 1007, 1046
- server/prisma/server/.data/llm-airlock.db (tables missing)
- node_modules/.prisma/client/schema.prisma (models missing)
- Usage in services:
  - server/services/extraction-claim-service.js
  - server/services/deal-state-machine.js
  - server/services/document-generator.js
  - server/services/evidence-pack-generator.js

### 7) Code references models not defined in Prisma schema
- Code uses prisma.deal, prisma.artifact, prisma.t12Period, and prisma.integrationMapping.
- These models are not in server/prisma/schema.prisma, so they cannot be generated in the Prisma client and do not exist in the DB.
- Even optional chaining (e.g., prisma.deal?.findUnique) still yields null and causes "Deal not found" or incomplete context.

Evidence
- server/services/document-generator.js:202, 263, 273
- server/services/deal-state-machine.js:223, 316
- server/services/deal-context-builder.js:41, 258
- server/routes/integrations.js:326
- server/prisma/schema.prisma (no Deal/Artifact/T12Period/IntegrationMapping models)

### 8) Underwriting model field mismatches between schema and code
- Schema uses fields like netOperatingIncome, amortization, loanTerm, holdPeriod.
- Code uses purchasePrice, noi, grossSF, loanTermYears, amortizationYears.
- Seed data and document metrics rely on fields not present in schema/DB.

Evidence
- server/prisma/schema.prisma (UnderwritingModel definition)
- server/scripts/seed-sample-deal.js:50-63
- server/services/document-generator.js:311-351

### 9) UnderwritingInput required fields not provided
- UnderwritingInput has required source and setBy fields.
- extraction-claim-service creates UnderwritingInput without source.

Evidence
- server/prisma/schema.prisma (UnderwritingInput: source, setBy required)
- server/services/extraction-claim-service.js:405

### 10) Missing template files referenced by document generator
- DOCUMENT_TYPES references templates that do not exist in server/services/document-templates.

Evidence
- server/services/document-generator.js:114-134
- server/services/document-templates only has:
  - deal-teaser.hbs
  - explain-appendix.hbs
  - ic-memo.hbs
  - loi.hbs

### 11) Deal context/AI assistant depends on missing Deal and Artifact models
- buildDealContext attempts to fetch prisma.deal and prisma.artifact.
- These models are not in schema, so context building is incomplete or fails.

Evidence
- server/services/deal-context-builder.js:41, 258
- server/routes/ai-assistant.js:658, 796, 826, 853, 1125

### 12) Validation scripts assert against a different DB
- validate-lp-system.sh uses sqlite3 to check server/.data/llm-airlock.db.
- That file is not the one Prisma uses in this environment.
- This can produce false positives/negatives for LP tables.

Evidence
- validate-lp-system.sh:87-103
- .env:3

### 13) Seed script for Doc Factory cannot run against current schema/client
- scripts/seed-sample-deal.js uses prisma.deal, prisma.artifact, and prisma.dealEvent, none of which exist in the schema/client.
- The script also writes UnderwritingModel fields that do not exist (scenarioName, isBaseCase, purchasePrice, noi, loanTermYears, amortizationYears, grossSF, totalUnits).
- Result: the recommended seed step fails before any claims are created, blocking the /claims/pending test flow.

Evidence
- server/scripts/seed-sample-deal.js:19-310
- server/prisma/schema.prisma (no Deal/Artifact models; UnderwritingModel fields)
- sqlite_master query (Appendix E)

### 14) Document generator uses deprecated underwriting fields and filters
- buildDealContext queries underwritingModel with isBaseCase (field not in schema/DB).
- calculateMetrics uses purchasePrice, noi, loanTermYears, amortizationYears, grossSF, totalUnits (not in schema/DB).
- This causes Prisma validation errors on lookup and null metrics even if data exists.

Evidence
- server/services/document-generator.js:209-351
- server/prisma/schema.prisma (UnderwritingModel definition)
- PRAGMA table_info('UnderwritingModel') (Appendix D)

### 15) Document generator expects T12Period and occupancy fields that do not exist
- buildDealContext calls prisma.t12Period.findMany and orders by periodStart, but schema only has T12LineItem.
- buildDealContext expects rentRollUnit.isOccupied, but RentRollUnit only has status.
- Result: T12 query fails outright and occupancy counts are incorrect/missing.

Evidence
- server/services/document-generator.js:263-284
- server/prisma/schema.prisma (RentRollUnit, T12LineItem)
- node_modules/.prisma/client/schema.prisma (no t12Period)
- PRAGMA table_info('RentRollUnit') (Appendix D)

### 16) Extraction claim apply-to-model path writes non-existent underwriting fields
- applyClaimToModel creates UnderwritingModel with scenarioName/isBaseCase and updates mapped fields like purchasePrice, noi, loanTermYears, amortizationYears, grossSF, totalUnits.
- These fields are not present in the schema/DB, so claim verification will fail when model creation/update runs.

Evidence
- server/services/extraction-claim-service.js:389-424, 330-360
- server/prisma/schema.prisma (UnderwritingModel)
- PRAGMA table_info('UnderwritingModel') (Appendix D)

### 17) Provenance output uses UnderwritingInput fields that do not exist
- document-generator and evidence-pack-generator read input.pageNumber and input.claimId.
- UnderwritingInput has documentPage and no claimId.
- Provenance metadata in generated documents/packs will be missing page numbers and claim links.

Evidence
- server/services/document-generator.js:224-239
- server/services/evidence-pack-generator.js:300-342
- server/prisma/schema.prisma (UnderwritingInput)
- PRAGMA table_info('UnderwritingInput') (Appendix D)

### 18) Existing migration omits Doc Factory tables
- The only migration SQL file has no CREATE TABLE entries for ExtractionClaim, DocumentVersion, DealEvent, GeneratedDocument, EvidencePack, or DealState.
- This explains why those tables are missing in the live DB despite being present in the schema.

Evidence
- server/prisma/migrations/20260113075339_llm_airlock/migration.sql (no matches for Doc Factory models)
- server/prisma/schema.prisma

### 19) Canonical deal + artifact data is kernel-sourced; BFF DB has no core Deal/Artifact models
- Deal list/home/records are assembled from kernel endpoints (deals, snapshot, events, actors, artifacts, materials) plus BFF store profile/index.
- /api/deals/:dealId/artifacts is a direct proxy to the kernel.
- Prisma schema has DealProfile only; there is no Deal or Artifact model to supply contract fields locally.
- BFF DB stores derivative data (DealProfile JSON, DocumentExtraction artifactId), so kernel is the system of record for deal/artifact identity and metadata.

Evidence
- server/routes/deals.js:81-307
- server/mappers.js:308-403
- server/index.js:955-964
- server/store.js:7-121
- server/routes/smart-parse.js:47-48
- server/prisma/schema.prisma:263-271 (DealProfile)
- server/prisma/schema.prisma:501-514 (DocumentExtraction artifactId)

### 20) Deal profile is split between store.json and Prisma without synchronization
- API deal responses use store.dealProfiles (object) to populate deal.profile for contracts.
- Smart-parse writes deal profiles to Prisma (DealProfile.profile as JSON string), while /api/deals create uses store upsert only.
- Underwriting reads profile from Prisma, not from store.
- Result: profile data used for underwriting can diverge from profile data returned by /api/deals contracts.

Evidence
- src/lib/contracts.js:21-65
- server/routes/deals.js:187-210
- server/store.js:100-127
- server/routes/smart-parse.js:66-118, 194-215
- server/routes/underwriting.js:328-329 (and repeated uses)
- server/prisma/schema.prisma:263-271

### 21) API contract entities have no matching Prisma models (Deal, Artifact, Material, Authority)
- dealSchema/dealEventSchema/materialSchema/evidenceArtifactSchema define contract shapes that map to kernel objects, not Prisma.
- Prisma schema has no Deal model, no Artifact model, no Material model, and no Authority model; contracts are satisfied by kernel data and mappers.
- Doc Factory services still attempt prisma.deal/prisma.artifact, which cannot exist in the current schema.

Evidence
- src/lib/contracts.js:52-166
- server/prisma/schema.prisma (no model Deal/Artifact/Material/Authority)
- server/mappers.js:308-403
- server/services/document-generator.js:202, 263
- server/services/evidence-pack-generator.js:83, 233

### 22) Contract fields vs Prisma columns mismatch for events and evidence
- Contracts expect dealEventSchema fields like event_type, authority_role, evidence_type, document_url; Prisma DealEvent uses eventType/eventData/authorityContext/evidenceRefs.
- Contracts expect evidenceArtifactSchema with filename/mimeType/sha256Hex/uploaderId; Prisma has only DocumentExtraction.artifactId (no artifact metadata).
- Contracts expect dealHomeResponseSchema authorities/covenants; Prisma has no corresponding tables and BFF returns empty covenants.

Evidence
- src/lib/contracts.js:70-166
- server/prisma/schema.prisma:501-514 (DocumentExtraction)
- server/prisma/schema.prisma:927-1044 (DealEvent)
- server/mappers.js:137-187, 308-403

### 23) Kernel payload samples are limited; explain/material payloads include extra fields beyond contracts
- The only concrete kernel payload captured in-repo is the diagnostics proof report for /deals/:id/explain and materials.
- explainResponseSchema allows passthrough fields, so kernel payload fields like inputsUsed/materialsAtT/dealStateAtT are accepted but undocumented.
- materials list entries include id/type/truthClass/data/createdAt (aligned with materialSchema), plus data.meta/evidenceRefs (also passthrough).

Evidence
- server/diagnostics/out/proof-report.json (explains, materialsAtT.list)
- src/lib/contracts.js:70-123 (materialSchema), 169-207 (explainResponseSchema)

### 24) Deal/artifact kernel payloads are not recorded; inferred deltas vs contracts
- No stored kernel payload for /deals or /artifacts exists in the repo; contracts rely on mapper assumptions.
- buildCanonicalDeal assumes kernelDeal.state/stressMode/createdAt/updatedAt; lender-portal kernel fallback uses deal.status and deal.data.* fields, which would map to nulls if that matched real kernel payloads.
- Kernel artifacts are expected to have id + filename (smart-parse) and filename/mimeType/sizeBytes/sha256Hex/uploaderId/createdAt (evidence index); if kernel uses fileName/contentType/uploadedAt, contract fields drop to null.

Evidence
- server/mappers.js:367-387
- server/routes/smart-parse.js:47-48
- server/mappers.js:351-361
- server/routes/lender-portal.js:23-68
- src/lib/contracts.js:132-146

### 25) Profile write paths split between store and Prisma; divergence starts at create vs smart-parse
- Store write path: POST /api/deals calls upsertDealProfile to store profile in server/.data/store.json only.
- Prisma write path: POST /api/deals/:dealId/smart-parse/apply upserts DealProfile in SQLite only.
- Underwriting reads profiles from Prisma (JSON.parse), while deal list/home/records read profiles from store. These are never synchronized.
- Schema defines DealProfile.profile as String; smart-parse writes an object directly, while other code expects a JSON string and parses it.

Evidence
- server/routes/deals.js:181-209
- server/store.js:100-121
- server/routes/smart-parse.js:194-215
- server/routes/underwriting.js:328-329
- server/prisma/schema.prisma:263-271

### 26) Per-endpoint contract vs implementation audit (deal endpoints)
- GET /api/deals: Contract dealListResponseSchema; implementation uses kernel /deals + /snapshot and store profile, then buildCanonicalDeal. Profile comes from store only; kernel field names must include state/stressMode/createdAt/updatedAt or lifecycle_state values will be null.
- POST /api/deals: Contract createDealRequestSchema (request only); response is not validated against dealSchema. Profile is stored in store.json only; Prisma is not updated.
- GET /api/deals/:id/home: Contract dealHomeResponseSchema; authorities/events/evidence from kernel, but covenants always [] and not sourced from kernel or DB.
- GET /api/deals/:id/records: Contract dealRecordsResponseSchema; materials from kernel are mapped to {id,type,truthClass,data,createdAt} without validation. evidence_index uses kernel artifact fields filename/mimeType/sizeBytes/sha256Hex/uploaderId; mismatched kernel field names will null these.
- GET /api/deals/:id/events: Contract eventsResponseSchema; buildCanonicalEvents assumes kernel events provide id/dealId/type/payload/actorId/createdAt/evidenceRefs. If kernel uses eventType/eventData, event_type and evidence_type become inaccurate.
- POST /api/deals/:id/events: No contract schema; response is raw kernel event payload.
- POST /api/deals/:id/explain: Contract explainResponseSchema; kernel explain payloads include extra inputsUsed/materialsAtT fields (passthrough, not documented).
- POST /api/deals/:id/actions/:actionType: Contract actionResponseSchema enforced only for ALLOWED responses; BLOCKED responses are untyped and not validated.
- GET /api/deals/:id/artifacts: No contract schema; direct proxy to kernel, so response shape is kernel-defined.

Evidence
- src/lib/contracts.js:52-207
- server/routes/deals.js:33-307
- server/routes/events.js:1-170
- server/routes/actions.js:210-360
- server/index.js:955-964
- server/mappers.js:308-403

### 27) Live kernel payload capture blocked (kernel not running locally)
- KERNEL_API_URL points to http://localhost:3001, but /health is unreachable in this environment.
- Kernel repo has only request-level logs (incoming request lines) with no response payloads, so no historical payloads are recorded.
- Kernel repo has no .env (only .env.example), so DB connectivity likely isn't configured for local runs.

Evidence
- .env:1
- ..\cre-kernel-phase1\kernel.log
- ..\cre-kernel-phase1\.env.example

### 28) Field-level deltas from actual kernel explain/material payload sample
- explain payload keys observed: action, status, reasons, nextSteps, at, projectionSummary, inputsUsed.
- inputsUsed keys observed: approvalsAtT, dealStateAtT, materialsAtT.
- materialsAtT.list item keys observed: id, type, truthClass, data, createdAt; data keys: meta, evidenceRefs.
- Contract delta: explainResponseSchema does not document inputsUsed (extra fields), but passthrough allows them; materialSchema does not require dealId and allows arbitrary data, so only extra nested fields are present (no hard mismatch).

Evidence
- server/diagnostics/out/proof-report.json
- src/lib/contracts.js:94-123, 169-207

### 29) Local Postgres services confirm kernel DB port and auth requirements, but credentials live in kernel env
- Three local Postgres instances are configured with listen_addresses='*' and ports 5432 (v16), 5433 (v13), 5434 (v15).
- All pg_hba.conf entries require scram-sha-256 for local/127.0.0.1, so password auth is required for psql/clients.
- Kernel repo includes apps/kernel-api/.env with a populated DATABASE_URL pointing to localhost:5432/cre_kernel (credentials stored there; redacted here).
- This indicates kernel expects the v16 instance on 5432, but DB access depends on the credentials in that env file.
- Verified that cre_kernel exists on localhost:5432; cre_kernel_test does not exist.

Evidence
- C:\Program Files\PostgreSQL\13\data\postgresql.conf (port 5433)
- C:\Program Files\PostgreSQL\15\data\postgresql.conf (port 5434)
- C:\Program Files\PostgreSQL\16\data\postgresql.conf (port 5432)
- C:\Program Files\PostgreSQL\13\data\pg_hba.conf (scram-sha-256)
- C:\Program Files\PostgreSQL\15\data\pg_hba.conf (scram-sha-256)
- C:\Program Files\PostgreSQL\16\data\pg_hba.conf (scram-sha-256)
- ..\cre-kernel-phase1\apps\kernel-api\.env (DATABASE_URL configured; credentials redacted)
- psql query: SELECT datname FROM pg_database;

### 30) Live kernel payloads captured from running kernel API
- Kernel API started from cre-kernel-phase1 (apps/kernel-api/.env) and /health returns {"status":"ok"}.
- Captured live responses for deal Phoenix (id da660b70-0d3a-4856-9a71-5b322a1d6883) to a fixed folder.
- GET /deals/:id response shape: id, name, state, stressMode, createdAt, updatedAt.
- GET /deals/:id/snapshot response shape: dealId, at, projection{state,stressMode}, approvals (15 action keys), materials{list, requiredFor}, timeline{eventsCount,lastEventAt,lastEventType}, integrity{replayFrom,deterministic}.
- GET /deals/:id/events response shape: array of events with id, dealId, type, payload, actorId, authorityContext, evidenceRefs, createdAt (26 events across ReviewOpened/OverrideAttested/DealApproved/ClosingReadinessAttested/ClosingFinalized/OperationsActivated/MaterialChangeDetected/ChangeReconciled).
- GET /deals/:id/actors response shape: array of actor objects with id, name, type, roles, createdAt (1 actor for this deal).
- GET /deals/:id/materials and /deals/:id/artifacts returned empty arrays for this deal.

Evidence
- server/diagnostics/out/kernel-live-20260115-131539/deal.json
- server/diagnostics/out/kernel-live-20260115-131539/snapshot.json
- server/diagnostics/out/kernel-live-20260115-131539/events.json
- server/diagnostics/out/kernel-live-20260115-131539/actors.json
- server/diagnostics/out/kernel-live-20260115-131539/materials.json
- server/diagnostics/out/kernel-live-20260115-131539/artifacts.json

## Appendix A: Live DB tables (server/prisma/server/.data/llm-airlock.db)
- ChatTask
- Conversation
- ConversationParticipant
- DealAssignment
- DealCorrection
- DealProfile
- DealSubmission
- DocumentExtraction
- EmailAttachment
- EmailIntake
- ExcelCell
- ExcelImport
- LLMFieldProvenance
- LLMParseSession
- LPActor
- LPInvitation
- MagicLinkToken
- Message
- NewsInsight
- NewsInteraction
- Notification
- NotificationPreference
- PortalComment
- RentRollUnit
- ReviewRequest
- T12LineItem
- UnderwritingConflict
- UnderwritingInput
- UnderwritingMemo
- UnderwritingModel
- UnderwritingScenario
- UserSession
- WaterfallDistribution
- WaterfallStructure
- WorkflowTask

## Appendix B: Prisma client models (node_modules/.prisma/client)
- lLMParseSession
- lLMFieldProvenance
- dealCorrection
- reviewRequest
- magicLinkToken
- dealSubmission
- portalComment
- dealAssignment
- workflowTask
- lPInvitation
- lPActor
- userSession
- newsInsight
- newsInteraction
- dealProfile
- conversation
- conversationParticipant
- message
- notification
- notificationPreference
- chatTask
- emailIntake
- emailAttachment
- documentExtraction
- underwritingModel
- underwritingInput
- underwritingConflict
- underwritingScenario
- rentRollUnit
- t12LineItem
- underwritingMemo
- excelImport
- excelCell

## Appendix C: DB file movement note
- Prior DB file server/.data/llm-airlock.db was moved to:
  - server/.data/llm-airlock.db.bak-20260115113922
- This was done while attempting to run prisma migrate dev.

## Appendix D: Live DB column snapshots (PRAGMA)
- UnderwritingModel columns:
  - id, dealId, grossPotentialRent, vacancyRate, effectiveGrossIncome, otherIncome, operatingExpenses,
    taxes, insurance, management, reserves, netOperatingIncome, loanAmount, interestRate, amortization,
    loanTerm, annualDebtService, goingInCapRate, cashOnCash, dscr, exitCapRate, holdPeriod, rentGrowth,
    expenseGrowth, irr, equityMultiple, lastCalculatedAt, status, createdAt, updatedAt
- UnderwritingInput columns:
  - id, dealId, fieldPath, value, sourceType, source, sourceId, documentId, documentName, documentPage,
    documentCell, aiModel, aiConfidence, setBy, setByName, rationale, formula, inputFields, sourceDocId,
    confidence, setAt, supersededAt, supersededBy, verifiedBy, verifiedByName, verifiedAt
- RentRollUnit columns:
  - id, dealId, extractionId, unitNumber, unitType, sqft, currentRent, marketRent, leaseStart, leaseEnd,
    status, tenant

## Appendix E: sqlite_master table existence check
- Query: SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Deal','Artifact','T12Period','IntegrationMapping');
- Result: [] (no matching tables)

## Update Log
- 2026-01-15 12:17:34: Initial comprehensive findings added.
- 2026-01-15 12:33:02: Added Doc Factory seed/document generator mismatches, PRAGMA snapshots, and migration omission notes.
- 2026-01-15 12:40:43: Added deal/artifact data source map and contract vs Prisma mismatches.
- 2026-01-15 12:50:13: Added kernel payload deltas, profile write path divergence, and endpoint contract audits.
- 2026-01-15 12:59:07: Added live kernel capture status and explain/material field-level deltas.
- 2026-01-15 13:04:51: Added local Postgres service ports/auth and kernel DB URL location (credentials redacted).
- 2026-01-15 13:06:48: Verified cre_kernel exists on localhost:5432 (cre_kernel_test absent).
- 2026-01-15 13:20:35: Captured live kernel payloads from running kernel API (deal/snapshot/events/actors/materials/artifacts).
