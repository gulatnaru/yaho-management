BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- CreateTable
CREATE TABLE "AiServiceConfig" (
    "environment" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT true,
    "provider" TEXT NOT NULL DEFAULT 'TEST_DOUBLE',
    "model" TEXT NOT NULL DEFAULT 'gpt-6-luna',
    "priceVersion" TEXT NOT NULL,
    "hmacVersions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputNanoUsdPerToken" INTEGER NOT NULL,
    "outputNanoUsdPerToken" INTEGER NOT NULL,
    "fxMilliKrwPerUsd" INTEGER NOT NULL,
    "fxCheckedAt" TIMESTAMP(3) NOT NULL,
    "fxSource" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceConfig_pkey" PRIMARY KEY ("environment")
);

-- CreateTable
CREATE TABLE "AiServiceProgramPublication" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceProgramPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceClassPublication" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "classScheduleId" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "sourceDigest" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceClassPublication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceKnowledgeEntry" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceKnowledgeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceRequest" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "requestHashes" TEXT[],
    "payloadHash" TEXT NOT NULL,
    "subjectHashes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "dispatched" BOOLEAN NOT NULL DEFAULT false,
    "dispatchedAt" TIMESTAMP(3),
    "dispatchGeneration" INTEGER,
    "reservedKrw" INTEGER NOT NULL,
    "usedKrw" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "priceSnapshot" JSONB NOT NULL,
    "rawCiphertext" TEXT,
    "encryptionVersion" TEXT,
    "billingUsage" JSONB,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attemptDeadline" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "AiServiceRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceBudgetMonth" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "capKrw" INTEGER NOT NULL,
    "reservedKrw" INTEGER NOT NULL DEFAULT 0,
    "usedKrw" INTEGER NOT NULL DEFAULT 0,
    "correctionKrw" INTEGER NOT NULL DEFAULT 0,
    "billedKrw" INTEGER NOT NULL DEFAULT 0,
    "unknownCount" INTEGER NOT NULL DEFAULT 0,
    "dispatchGeneration" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reconciliationReference" TEXT,
    "reconciledById" TEXT,
    "reconciledAt" TIMESTAMP(3),

    CONSTRAINT "AiServiceBudgetMonth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceQuotaBucket" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "aliases" TEXT[],
    "accepted" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceQuotaBucket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceDailyMetric" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "modelCalls" INTEGER NOT NULL DEFAULT 0,
    "usedKrw" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AiServiceDailyMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceRetentionJob" (
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IDLE',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceRetentionJob_pkey" PRIMARY KEY ("environment")
);

-- CreateTable
CREATE TABLE "AiServiceKeyPin" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiServiceKeyPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiServiceReconciliation" (
    "id" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "coveredThroughGeneration" INTEGER NOT NULL,
    "billedKrw" INTEGER NOT NULL,
    "heldActualKrw" INTEGER NOT NULL,
    "resolvesHeld" BOOLEAN NOT NULL,
    "payloadDigest" TEXT NOT NULL,
    "budgetVersionBefore" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiServiceReconciliation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceProgramPublication_environment_programId_key" ON "AiServiceProgramPublication"("environment", "programId");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceClassPublication_environment_classScheduleId_key" ON "AiServiceClassPublication"("environment", "classScheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceKnowledgeEntry_environment_topic_key" ON "AiServiceKnowledgeEntry"("environment", "topic");

-- CreateIndex
CREATE INDEX "AiServiceRequest_requestHashes_idx" ON "AiServiceRequest" USING GIN ("requestHashes");

-- CreateIndex
CREATE INDEX "AiServiceRequest_environment_status_attemptDeadline_idx" ON "AiServiceRequest"("environment", "status", "attemptDeadline");

-- CreateIndex
CREATE INDEX "AiServiceRequest_environment_expiresAt_idx" ON "AiServiceRequest"("environment", "expiresAt");

-- CreateIndex
CREATE INDEX "AiServiceRequest_environment_month_idx" ON "AiServiceRequest"("environment", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceRequest_environment_requestKey_key" ON "AiServiceRequest"("environment", "requestKey");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceBudgetMonth_environment_month_key" ON "AiServiceBudgetMonth"("environment", "month");

-- CreateIndex
CREATE INDEX "AiServiceQuotaBucket_environment_window_kind_idx" ON "AiServiceQuotaBucket"("environment", "window", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceDailyMetric_environment_day_category_key" ON "AiServiceDailyMetric"("environment", "day", "category");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceKeyPin_environment_version_key" ON "AiServiceKeyPin"("environment", "version");

-- CreateIndex
CREATE INDEX "AiServiceReconciliation_environment_month_idx" ON "AiServiceReconciliation"("environment", "month");

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceReconciliation_environment_reference_key" ON "AiServiceReconciliation"("environment", "reference");

-- AddForeignKey
ALTER TABLE "AiServiceProgramPublication" ADD CONSTRAINT "AiServiceProgramPublication_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiServiceClassPublication" ADD CONSTRAINT "AiServiceClassPublication_classScheduleId_fkey" FOREIGN KEY ("classScheduleId") REFERENCES "ClassSchedule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiServiceRequest" ADD CONSTRAINT "AiServiceRequest_environment_month_fkey" FOREIGN KEY ("environment", "month") REFERENCES "AiServiceBudgetMonth"("environment", "month") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiServiceReconciliation" ADD CONSTRAINT "AiServiceReconciliation_environment_month_fkey" FOREIGN KEY ("environment", "month") REFERENCES "AiServiceBudgetMonth"("environment", "month") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Constraints are additive and service-local. The deployment lock remains in code.
ALTER TABLE "AiServiceConfig" ADD CONSTRAINT "ai_service_config_environment"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION')),
 ADD CONSTRAINT "ai_service_config_values"
 CHECK ("provider" IN ('OPENAI','TEST_DOUBLE') AND "version">=1
 AND "inputNanoUsdPerToken">0 AND "outputNanoUsdPerToken">0 AND "fxMilliKrwPerUsd">0);
ALTER TABLE "AiServiceBudgetMonth" ADD CONSTRAINT "ai_service_budget_cap"
 CHECK (("environment"='PREVIEW' AND "capKrw"=1000) OR ("environment"='PRODUCTION' AND "capKrw"=7000)),
 ADD CONSTRAINT "ai_service_budget_nonnegative"
 CHECK ("reservedKrw">=0 AND "usedKrw">=0 AND "correctionKrw">=0 AND "billedKrw">=0 AND "unknownCount">=0 AND "version">=1),
 ADD CONSTRAINT "ai_service_budget_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "AiServiceRequest" ADD CONSTRAINT "ai_service_request_status"
 CHECK ("status" IN ('PROCESSING','SETTLED','FAILED','UNKNOWN','RECONCILED')),
 ADD CONSTRAINT "ai_service_request_values"
 CHECK ("reservedKrw">0 AND "usedKrw">=0 AND "attempt">=1 AND ("inputTokens" IS NULL OR "inputTokens">=0)
 AND ("outputTokens" IS NULL OR "outputTokens">=0) AND cardinality("requestHashes") BETWEEN 1 AND 8
 AND cardinality("subjectHashes") BETWEEN 1 AND 8),
 ADD CONSTRAINT "ai_service_request_cipher_pair"
 CHECK (("rawCiphertext" IS NULL)=("encryptionVersion" IS NULL)),
 ADD CONSTRAINT "ai_service_request_ttl"
 CHECK ("expiresAt"="createdAt"+interval '90 days' AND "attemptDeadline">="createdAt"),
 ADD CONSTRAINT "ai_service_request_environment" CHECK ("environment" IN ('PREVIEW','PRODUCTION'));
ALTER TABLE "AiServiceQuotaBucket" ADD CONSTRAINT "ai_service_quota_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "accepted">=0
 AND "kind" IN ('GLOBAL_MINUTE','SUBJECT_HOUR') AND cardinality("aliases") BETWEEN 1 AND 8);
ALTER TABLE "AiServiceProgramPublication" ADD CONSTRAINT "ai_service_program_publication_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "version">=1);
ALTER TABLE "AiServiceClassPublication" ADD CONSTRAINT "ai_service_class_publication_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "version">=1);
ALTER TABLE "AiServiceKnowledgeEntry" ADD CONSTRAINT "ai_service_knowledge_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "topic" IN ('POLICY','PREPARATION','RAIN')
 AND "version">=1 AND char_length(btrim("content")) BETWEEN 1 AND 1000);
ALTER TABLE "AiServiceDailyMetric" ADD CONSTRAINT "ai_service_daily_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "count">=0 AND "modelCalls">=0 AND "usedKrw">=0
 AND "category" IN ('PROGRAMS','CLASSES','AVAILABILITY','GUIDANCE','HUMAN_HANDOFF'));
ALTER TABLE "AiServiceRetentionJob" ADD CONSTRAINT "ai_service_retention_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "attempts" BETWEEN 0 AND 3 AND "deletedCount">=0
 AND "status" IN ('IDLE','FAILED') AND ("errorCode" IS NULL OR "errorCode"='RETENTION_FAILED'));

CREATE FUNCTION "ai_service_request_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."createdAt"<>OLD."createdAt" OR NEW."expiresAt"<>OLD."expiresAt"
 OR NEW."environment"<>OLD."environment" OR NEW."month"<>OLD."month"
 OR NEW."provider"<>OLD."provider" OR NEW."model"<>OLD."model"
 OR NEW."priceSnapshot" IS DISTINCT FROM OLD."priceSnapshot" THEN
  RAISE EXCEPTION 'AI_SERVICE_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ai_service_request_immutable_trigger" BEFORE UPDATE ON "AiServiceRequest"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_request_immutable"();
CREATE FUNCTION "ai_service_budget_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."environment"<>OLD."environment" OR NEW."month"<>OLD."month" OR NEW."capKrw"<>OLD."capKrw"
 OR NEW."dispatchGeneration"<OLD."dispatchGeneration" OR NEW."usedKrw"<OLD."usedKrw" OR NEW."correctionKrw"<OLD."correctionKrw" OR NEW."billedKrw"<OLD."billedKrw" THEN
  RAISE EXCEPTION 'AI_SERVICE_BUDGET_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ai_service_budget_immutable_trigger" BEFORE UPDATE ON "AiServiceBudgetMonth"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_budget_immutable"();

-- No public client role receives direct table access.
ALTER TABLE "AiServiceConfig" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceConfig" FROM anon, authenticated;
ALTER TABLE "AiServiceProgramPublication" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceProgramPublication" FROM anon, authenticated;
ALTER TABLE "AiServiceClassPublication" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceClassPublication" FROM anon, authenticated;
ALTER TABLE "AiServiceKnowledgeEntry" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceKnowledgeEntry" FROM anon, authenticated;
ALTER TABLE "AiServiceRequest" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceRequest" FROM anon, authenticated;
ALTER TABLE "AiServiceBudgetMonth" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceBudgetMonth" FROM anon, authenticated;
ALTER TABLE "AiServiceQuotaBucket" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceQuotaBucket" FROM anon, authenticated;
ALTER TABLE "AiServiceDailyMetric" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceDailyMetric" FROM anon, authenticated;
ALTER TABLE "AiServiceRetentionJob" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceRetentionJob" FROM anon, authenticated;
-- PostgreSQL CHECK(NULL) is not false: require all privacy/idempotency arrays.
ALTER TABLE "AiServiceConfig" ALTER COLUMN "hmacVersions" SET NOT NULL;
ALTER TABLE "AiServiceRequest" ALTER COLUMN "requestHashes" SET NOT NULL, ALTER COLUMN "subjectHashes" SET NOT NULL;
ALTER TABLE "AiServiceQuotaBucket" ALTER COLUMN "aliases" SET NOT NULL;
CREATE FUNCTION "ai_service_hmac_continuity"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT OLD."hmacVersions" <@ NEW."hmacVersions" THEN
  RAISE EXCEPTION 'AI_SERVICE_HMAC_CONTINUITY';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ai_service_hmac_continuity_trigger" BEFORE UPDATE ON "AiServiceConfig"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_hmac_continuity"();


ALTER TABLE "AiServiceKeyPin" ADD CONSTRAINT "ai_service_key_pin_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "version" ~ '^v[1-9][0-9]{0,3}$'
 AND "fingerprint" ~ '^[a-f0-9]{64}$');
ALTER TABLE "AiServiceReconciliation" ADD CONSTRAINT "ai_service_evidence_values"
 CHECK ("environment" IN ('PREVIEW','PRODUCTION') AND "month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
 AND "reference" ~ '^invoice-[A-Za-z0-9_-]{8,100}$' AND "coveredThroughGeneration">=0
 AND "billedKrw">=0 AND "heldActualKrw">=0 AND "heldActualKrw"<="billedKrw"
 AND "budgetVersionBefore">=1 AND "payloadDigest" ~ '^[a-f0-9]{64}$');
ALTER TABLE "AiServiceBudgetMonth" ADD CONSTRAINT "ai_service_dispatch_counter" CHECK ("dispatchGeneration">=0);
ALTER TABLE "AiServiceRequest" ADD CONSTRAINT "ai_service_dispatch_binding" CHECK (
 ("dispatched" AND "dispatchedAt" IS NOT NULL AND "dispatchGeneration" IS NOT NULL AND "dispatchGeneration">0)
 OR (NOT "dispatched" AND "dispatchedAt" IS NULL AND "dispatchGeneration" IS NULL));
CREATE FUNCTION "ai_service_financial_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'AI_SERVICE_FINANCIAL_APPEND_ONLY';
END $$;
CREATE TRIGGER "ai_service_key_pin_append_only" BEFORE UPDATE OR DELETE ON "AiServiceKeyPin"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_financial_append_only"();
CREATE TRIGGER "ai_service_evidence_append_only" BEFORE UPDATE OR DELETE ON "AiServiceReconciliation"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_financial_append_only"();
CREATE TRIGGER "ai_service_budget_no_delete" BEFORE DELETE ON "AiServiceBudgetMonth"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_financial_append_only"();
CREATE FUNCTION "ai_service_dispatch_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."dispatched" AND (NOT NEW."dispatched"
 OR NEW."dispatchGeneration" IS DISTINCT FROM OLD."dispatchGeneration"
 OR NEW."dispatchedAt" IS DISTINCT FROM OLD."dispatchedAt" OR NEW."attempt"<>OLD."attempt") THEN
  RAISE EXCEPTION 'AI_SERVICE_DISPATCH_IMMUTABLE';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER "ai_service_dispatch_immutable_trigger" BEFORE UPDATE ON "AiServiceRequest"
 FOR EACH ROW EXECUTE FUNCTION "ai_service_dispatch_immutable"();
ALTER TABLE "AiServiceKeyPin" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceKeyPin" FROM anon, authenticated;
ALTER TABLE "AiServiceReconciliation" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "AiServiceReconciliation" FROM anon, authenticated;

COMMIT;
