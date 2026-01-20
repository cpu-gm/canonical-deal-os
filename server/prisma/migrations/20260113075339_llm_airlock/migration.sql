-- CreateTable
CREATE TABLE "LLMParseSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "dealId" TEXT,
    "inputText" TEXT NOT NULL,
    "inputSource" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "promptVersion" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "temperature" REAL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "latencyMs" INTEGER,
    "status" TEXT NOT NULL,
    "errorMessage" TEXT,
    "rawProviderResponse" TEXT,
    "parsedResult" TEXT,
    "evaluatorReport" TEXT,
    "forceAccepted" BOOLEAN NOT NULL DEFAULT false,
    "forceAcceptedRationale" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1
);

-- CreateTable
CREATE TABLE "LLMFieldProvenance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "fieldPath" TEXT NOT NULL,
    "value" TEXT,
    "source" TEXT NOT NULL,
    "confidence" REAL,
    "rationale" TEXT,
    "evidenceNeeded" TEXT,
    "artifactId" TEXT,
    "asOf" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LLMFieldProvenance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LLMParseSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DealCorrection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "fieldPath" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "correctionType" TEXT NOT NULL,
    "correctedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WorkflowTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dealId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "relatedFieldPath" TEXT,
    "relatedArtifactId" TEXT,
    "severity" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "LLMFieldProvenance_sessionId_idx" ON "LLMFieldProvenance"("sessionId");

-- CreateIndex
CREATE INDEX "LLMFieldProvenance_fieldPath_idx" ON "LLMFieldProvenance"("fieldPath");

-- CreateIndex
CREATE INDEX "DealCorrection_dealId_idx" ON "DealCorrection"("dealId");

-- CreateIndex
CREATE INDEX "DealCorrection_sessionId_idx" ON "DealCorrection"("sessionId");

-- CreateIndex
CREATE INDEX "WorkflowTask_dealId_idx" ON "WorkflowTask"("dealId");

-- CreateIndex
CREATE INDEX "WorkflowTask_status_idx" ON "WorkflowTask"("status");

-- CreateIndex
CREATE INDEX "WorkflowTask_type_idx" ON "WorkflowTask"("type");
