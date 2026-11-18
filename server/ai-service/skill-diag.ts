import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { ServiceDenied } from "./contracts";

export enum SkillDiagCode {
    S1_ENV_NOT_PREVIEW = "S1_ENV_NOT_PREVIEW",
    S1_GATE_OFF = "S1_GATE_OFF",
    S2_ENV_INVALID = "S2_ENV_INVALID",
    S3_REG_PROD_MISSING = "S3_REG_PROD_MISSING",
    S3_REG_PROD_LENGTH = "S3_REG_PROD_LENGTH",
    S3_SUPPLIED_ABSENT = "S3_SUPPLIED_ABSENT",
    S3_SUPPLIED_EMPTY = "S3_SUPPLIED_EMPTY",
    S3_SUPPLIED_TOO_LONG = "S3_SUPPLIED_TOO_LONG",
    S3_REG_TEST_LENGTH = "S3_REG_TEST_LENGTH",
    S3_REG_TEST_EQUALS_PROD = "S3_REG_TEST_EQUALS_PROD",
    S3_MISMATCH = "S3_MISMATCH",
    S4_PROD_KIND = "S4_PROD_KIND",
    S4_CONTEXT_INVALID = "S4_CONTEXT_INVALID",
    S5_BODY_READ_FAILED = "S5_BODY_READ_FAILED",
    S5_BODY_TOO_LARGE = "S5_BODY_TOO_LARGE",
    S6_RUN_MISSING = "S6_RUN_MISSING",
    S6_RUN_FORMAT = "S6_RUN_FORMAT",
    S6_EXPIRY_MISSING = "S6_EXPIRY_MISSING",
    S6_EXPIRY_INVALID = "S6_EXPIRY_INVALID",
    S6_EXPIRY_PASSED = "S6_EXPIRY_PASSED",
    S6_CLOCK_INVALID = "S6_CLOCK_INVALID",
    S6_BODY_JSON_INVALID = "S6_BODY_JSON_INVALID",
    S6_BODY_SCHEMA_INVALID = "S6_BODY_SCHEMA_INVALID",
    S6_BOT_MISMATCH = "S6_BOT_MISMATCH",
    S6_USER_MISMATCH = "S6_USER_MISMATCH",
    S6_BLOCK_MISMATCH = "S6_BLOCK_MISMATCH",
    S6_UTTERANCE_UNKNOWN = "S6_UTTERANCE_UNKNOWN",
    S7_JSON_INVALID = "S7_JSON_INVALID",
    S7B_BOT_EMPTY = "S7B_BOT_EMPTY",
    S7B_USER_EMPTY = "S7B_USER_EMPTY",
    S7B_UTTERANCE_EMPTY = "S7B_UTTERANCE_EMPTY",
    S7B_CLOCK_INVALID = "S7B_CLOCK_INVALID",
    S8_BOT_ID_MISSING = "S8_BOT_ID_MISSING",
    S8B_KEYS_ENC_PARSE = "S8B_KEYS_ENC_PARSE",
    S8B_KEYS_HMAC_PARSE = "S8B_KEYS_HMAC_PARSE",
    S8B_KEYS_VALIDATE = "S8B_KEYS_VALIDATE",
    S8B_REG_PROD_MISSING = "S8B_REG_PROD_MISSING",
    S8B_REG_PROD_LENGTH = "S8B_REG_PROD_LENGTH",
    S8B_REG_TEST_LENGTH = "S8B_REG_TEST_LENGTH",
    S8B_REG_TEST_EQUALS_PROD = "S8B_REG_TEST_EQUALS_PROD",
    S8B_SCOPE_EXPIRED = "S8B_SCOPE_EXPIRED",
    S0_UNKNOWN = "S0_UNKNOWN",
}
export class SkillDiagDenied extends ServiceDenied {
    readonly diagCode: SkillDiagCode;
    readonly testSecretConfigured?: boolean;
    constructor(code: SkillDiagCode, testSecretConfigured?: boolean) {
        super();
        this.diagCode = code;
        if (code === SkillDiagCode.S3_MISMATCH && testSecretConfigured !== undefined)
            this.testSecretConfigured = testSecretConfigured;
    }
}
type DiagInput = { code: SkillDiagCode; correlationId: string; testSecretConfigured?: boolean };
export async function emitSkillDiag(input: DiagInput, deps?: { db?: Pick<PrismaClient, "aiServiceSkillDiag"> }): Promise<void> {
    if (process.env.VERCEL_ENV !== "preview") return;
    try {
        const timestamp = new Date();
        const deploymentId = process.env.VERCEL_DEPLOYMENT_ID ?? null;
        const flag = input.code === SkillDiagCode.S3_MISMATCH ? input.testSecretConfigured : undefined;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const insert = Promise.resolve((deps?.db ?? prisma).aiServiceSkillDiag.create({ data: {
                correlationId: input.correlationId, environment: "PREVIEW", stageCode: input.code,
                testSecretConfigured: flag ?? null, deploymentId, diagVersion: 1, emittedAt: timestamp,
            } }));
            // A timed-out insert can reject later; always attach a rejection handler.
            void insert.catch(() => {});
            await Promise.race([insert, new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("timeout")), 3000);
            })]);
        } catch {
            try {
                console.error(JSON.stringify({ diag: "yaho-skill-v1", v: 1, code: input.code,
                    corr: input.correlationId, dep: deploymentId, env: "preview", ts: timestamp.toISOString(),
                    ...(flag === undefined ? {} : { testSecretConfigured: flag }) }));
            } catch { /* Diagnostics must not affect the response. */ }
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    } catch { /* Diagnostics must not affect the response. */ }
}
