-- CreateTable
CREATE TABLE "AiServiceSkillDiag" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "stageCode" TEXT NOT NULL,
    "testSecretConfigured" BOOLEAN,
    "deploymentId" TEXT,
    "diagVersion" INTEGER NOT NULL DEFAULT 1,
    "emittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiServiceSkillDiag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiServiceSkillDiag_correlationId_key" ON "AiServiceSkillDiag"("correlationId");

-- CreateIndex
CREATE INDEX "AiServiceSkillDiag_environment_emittedAt_idx" ON "AiServiceSkillDiag"("environment", "emittedAt");

