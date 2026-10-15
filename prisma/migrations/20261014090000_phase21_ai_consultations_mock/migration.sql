-- AlterTable
ALTER TABLE "PreviewE2eRunLease" ADD COLUMN     "aiFixtureManifest" JSONB;

-- CreateTable
CREATE TABLE "AiProgramPublication" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProgramPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiClassPublication" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "classScheduleId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiClassPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiConsultation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'SYNTHETIC',
    "requestKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "hmacVersion" TEXT NOT NULL,
    "subjectHashes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "dispatched" BOOLEAN NOT NULL DEFAULT false,
    "reservedCalls" INTEGER NOT NULL,
    "reservedCost" INTEGER NOT NULL,
    "usedCalls" INTEGER NOT NULL DEFAULT 0,
    "usedCost" INTEGER NOT NULL DEFAULT 0,
    "quotaBucketIds" TEXT[],
    "rawCiphertext" TEXT,
    "encryptionVersion" TEXT,
    "resultCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptDeadline" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiConsultation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiQuotaBucket" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "bucketKey" TEXT NOT NULL,
    "aliases" TEXT[],
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "reservedCalls" INTEGER NOT NULL DEFAULT 0,
    "reservedCost" INTEGER NOT NULL DEFAULT 0,
    "usedCalls" INTEGER NOT NULL DEFAULT 0,
    "usedCost" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiQuotaBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiDailyMetric" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "syntheticCost" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRetentionJob" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "lastSuccessAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiRetentionJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiProgramPublication_runId_programId_key" ON "AiProgramPublication"("runId", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "AiClassPublication_runId_classScheduleId_key" ON "AiClassPublication"("runId", "classScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "AiKnowledgeEntry_runId_topic_key" ON "AiKnowledgeEntry"("runId", "topic");

-- CreateIndex
CREATE INDEX "AiConsultation_runId_expiresAt_idx" ON "AiConsultation"("runId", "expiresAt");

-- CreateIndex
CREATE INDEX "AiConsultation_runId_status_attemptDeadline_idx" ON "AiConsultation"("runId", "status", "attemptDeadline");

-- CreateIndex
CREATE UNIQUE INDEX "AiConsultation_runId_requestKey_key" ON "AiConsultation"("runId", "requestKey");

-- CreateIndex
CREATE INDEX "AiQuotaBucket_runId_expiresAt_idx" ON "AiQuotaBucket"("runId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiQuotaBucket_runId_bucketKey_key" ON "AiQuotaBucket"("runId", "bucketKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiDailyMetric_day_category_key" ON "AiDailyMetric"("day", "category");

-- CreateIndex
CREATE UNIQUE INDEX "AiRetentionJob_runId_key" ON "AiRetentionJob"("runId");

-- AddForeignKey
ALTER TABLE "AiProgramPublication" ADD CONSTRAINT "AiProgramPublication_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiClassPublication" ADD CONSTRAINT "AiClassPublication_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Synthetic-only domain; no public Data API grants/policies.
ALTER TABLE "AiProgramPublication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiClassPublication" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiKnowledgeEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiConsultation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiQuotaBucket" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiDailyMetric" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiRetentionJob" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "AiConsultation" ADD CONSTRAINT "AiConsultation_origin_check" CHECK ("origin"='SYNTHETIC');
ALTER TABLE "AiConsultation" ADD CONSTRAINT "AiConsultation_state_check" CHECK ("status" IN ('PROCESSING','DONE','FAILED','UNCERTAIN'));
ALTER TABLE "AiConsultation" ADD CONSTRAINT "AiConsultation_retention_check" CHECK ("expiresAt"="createdAt" + interval '90 days');
ALTER TABLE "AiConsultation" ADD CONSTRAINT "AiConsultation_usage_check" CHECK ("reservedCalls">=0 AND "reservedCost">=0 AND "usedCalls">=0 AND "usedCost">=0 AND "usedCalls"<="reservedCalls" AND "usedCost"<="reservedCost" AND "attempt">=1);
ALTER TABLE "AiQuotaBucket" ADD CONSTRAINT "AiQuotaBucket_nonnegative_check" CHECK ("accepted">=0 AND "reservedCalls">=0 AND "reservedCost">=0 AND "usedCalls">=0 AND "usedCost">=0);
ALTER TABLE "AiDailyMetric" ADD CONSTRAINT "AiDailyMetric_anonymous_check" CHECK ("category" IN ('PROGRAMS','CLASSES','AVAILABILITY','GUIDANCE','HUMAN_HANDOFF') AND "count">=0 AND "modelCalls">=0 AND "syntheticCost"=0);
ALTER TABLE "AiKnowledgeEntry" ADD CONSTRAINT "AiKnowledgeEntry_topic_check" CHECK ("topic" IN ('POLICY','PREPARATION','RAIN') AND "version">=1);
ALTER TABLE "AiProgramPublication" ADD CONSTRAINT "AiProgramPublication_version_check" CHECK ("version">=1);
ALTER TABLE "AiClassPublication" ADD CONSTRAINT "AiClassPublication_version_check" CHECK ("version">=1);
ALTER TABLE "AiRetentionJob" ADD CONSTRAINT "AiRetentionJob_state_check" CHECK ("status" IN ('IDLE','RUNNING','SUCCEEDED','FAILED') AND "attempts">=0 AND "deletedCount">=0 AND ("errorCode" IS NULL OR "errorCode"='PURGE_FAILED'));
CREATE FUNCTION "phase21_preserve_consultation_identity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."runId" IS DISTINCT FROM OLD."runId" OR NEW."requestKey" IS DISTINCT FROM OLD."requestKey" OR NEW."payloadHash" IS DISTINCT FROM OLD."payloadHash" OR NEW."hmacVersion" IS DISTINCT FROM OLD."hmacVersion" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
 RAISE EXCEPTION 'AI_IMMUTABLE_IDENTITY';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION "phase21_preserve_consultation_identity"() FROM PUBLIC;
CREATE TRIGGER "AiConsultation_immutable_identity" BEFORE UPDATE ON "AiConsultation" FOR EACH ROW EXECUTE FUNCTION "phase21_preserve_consultation_identity"();
-- Supabase roles may not exist in an isolated plain PostgreSQL verifier.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
 REVOKE ALL ON "AiProgramPublication","AiClassPublication","AiKnowledgeEntry","AiConsultation","AiQuotaBucket","AiDailyMetric","AiRetentionJob" FROM anon;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
 REVOKE ALL ON "AiProgramPublication","AiClassPublication","AiKnowledgeEntry","AiConsultation","AiQuotaBucket","AiDailyMetric","AiRetentionJob" FROM authenticated;
 END IF;
END $$;
