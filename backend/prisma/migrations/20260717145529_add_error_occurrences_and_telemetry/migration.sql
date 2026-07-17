-- CreateTable
CREATE TABLE "ErrorOccurrence" (
    "id" TEXT NOT NULL,
    "errorGroupFingerprint" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "breadcrumbs" JSONB,
    "telemetry" JSONB,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "releaseVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSummary" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "totalRequests" INTEGER NOT NULL DEFAULT 0,
    "errorRequests" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MetricSummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorOccurrence_errorGroupFingerprint_idx" ON "ErrorOccurrence"("errorGroupFingerprint");

-- CreateIndex
CREATE INDEX "ErrorOccurrence_environment_idx" ON "ErrorOccurrence"("environment");

-- CreateIndex
CREATE INDEX "ErrorOccurrence_releaseVersion_idx" ON "ErrorOccurrence"("releaseVersion");

-- CreateIndex
CREATE INDEX "ErrorOccurrence_createdAt_idx" ON "ErrorOccurrence"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSummary_projectId_timestamp_key" ON "MetricSummary"("projectId", "timestamp");

-- AddForeignKey
ALTER TABLE "ErrorOccurrence" ADD CONSTRAINT "ErrorOccurrence_errorGroupFingerprint_fkey" FOREIGN KEY ("errorGroupFingerprint") REFERENCES "ErrorGroup"("fingerprint") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSummary" ADD CONSTRAINT "MetricSummary_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
