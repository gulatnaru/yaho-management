import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { buildDedupeKey, LogNotificationProvider } from "@/lib/kakao/notify";
import { insertApplicationReceivedOutbox } from "@/lib/kakao/outbox-tx";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { submitApplicationGroupCore } from "@/server/reservation-applications/groups";
import { ApplicationAlreadySubmittedError, ApplicationPriceChangedError, ApplicationPriceReviewExpiredError } from "@/server/reservation-applications/price-review";
import { now, operation, scheduleId, submissionId, SubmissionTransactionFixture, syntheticPrice } from "./outbox-tx-fixture";

const proofMocks = vi.hoisted(() => ({ authenticate: vi.fn(), issue: vi.fn() }));
// Only credential-dependent proof authentication/issuance is replaced. The
// actual core, schema validation, price comparisons, expiry and error types run.
// No signing secret, Prisma client, provider transport or real DB is used.
vi.mock("@/server/reservation-applications/price-review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/reservation-applications/price-review")>();
  return { ...actual, authenticateApplicationPriceReview: proofMocks.authenticate, issueApplicationPriceReview: proofMocks.issue };
});
vi.mock("@/lib/db/prisma", () => { throw new Error("A DB singleton must never be imported by these unit tests"); });

const groupToken = "SYNTHETIC_GROUP_CAPABILITY_FIXTURE_0001";
const companionToken = "SYNTHETIC_COMPANION_CAPABILITY_FIXTURE_0001";
const privateProbes = [
  "SYNTHETIC_GUARDIAN", "010-0000-7654", "SYNTHETIC_PAYER", "SYNTHETIC_CHILD_ONE", "SYNTHETIC_CHILD_TWO",
  "2020-01-01", String(syntheticPrice), groupToken, companionToken, "synthetic-review-proof",
  "synthetic-completion-hash", "synthetic-device-hash", "https://synthetic.invalid/private", "999-000-7654321",
];

function input(companion = false): Parameters<typeof submitApplicationGroupCore>[1] {
  return {
    ...(companion ? { companionToken } : { token: groupToken }),
    data: {
      reviewedPriceProof: "synthetic-review-proof", consentVersion: APPLICATION_CONSENT_CONTENT.version,
      guardianName: privateProbes[0], guardianPhone: privateProbes[1], guardianRelationship: "MOTHER", declaredPayerName: privateProbes[2],
      children: ["SYNTHETIC_CHILD_ONE", "SYNTHETIC_CHILD_TWO"].map((childName): Parameters<typeof submitApplicationGroupCore>[1]["data"]["children"][number] => ({
        classScheduleId: scheduleId, childName, childBirthDate: "2020-01-01", childGender: "UNSPECIFIED",
        requestNote: "https://synthetic.invalid/private 999-000-7654321",
        programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true,
        photoShareConsent: false, photoMarketingConsent: false,
      })),
    },
    consentVersion: APPLICATION_CONSENT_CONTENT.version, now, configReady: true,
    completionTokenHash: "synthetic-completion-hash", completionExpiresAt: new Date(now.getTime() + 60_000),
    deviceTokenHash: "synthetic-device-hash", deviceExpiresAt: new Date(now.getTime() + 120_000),
  };
}

function existingOutbox() {
  return {
    id: "synthetic-existing-outbox", eventKind: "application.received", entityId: submissionId,
    dedupeKey: buildDedupeKey("application.received", submissionId, "created"), audience: "admin",
    occurredAt: new Date(now.getTime() - 1000), status: "sent", attemptCount: 3,
    lastErrorCode: null, providerId: null, providerRef: null, nextRetryAt: null,
    claimToken: null, leaseExpiresAt: null, createdAt: new Date(now.getTime() - 1000), updatedAt: now,
  };
}

function priorSubmission() {
  return { id: submissionId, completionTokenHash: "synthetic-prior-completion-hash", completionExpiresAt: new Date(now.getTime() + 60_000), personalDataPurgedAt: null };
}

beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "development");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Network forbidden in outbox transaction unit tests"); }));
  vi.spyOn(LogNotificationProvider.prototype, "send").mockImplementation(async () => { throw new Error("Provider send forbidden in outbox transaction unit tests"); });
  proofMocks.authenticate.mockReset().mockReturnValue({
    version: 1, scope: "synthetic-authenticated-scope", operation, issuedAt: now.getTime(),
    consentVersion: APPLICATION_CONSENT_CONTENT.version, prices: [{ classScheduleId: scheduleId, amount: syntheticPrice }],
  });
  proofMocks.issue.mockReset().mockReturnValue({ proof: "synthetic-replacement-proof", prices: [{ classScheduleId: scheduleId, amount: syntheticPrice }] });
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  expect(LogNotificationProvider.prototype.send).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("real submitApplicationGroupCore with synthetic transaction commit/rollback", () => {
  it.each([false, true])("commits submission, applications and one pending outbox together (companion=%s)", async (companion) => {
    const fixture = new SubmissionTransactionFixture();
    fixture.beforeCommit = (pending) => {
      expect(fixture.committed.submissions).toEqual([]);
      expect(fixture.committed.applications).toEqual([]);
      expect(fixture.committed.outbox).toEqual([]);
      expect(pending.submissions).toHaveLength(1);
      expect(pending.applications).toHaveLength(2);
      expect(pending.outbox).toHaveLength(1);
    };
    const result = await submitApplicationGroupCore(fixture.client(), input(companion));
    expect(result).toEqual({ submissionId, applicationIds: ["synthetic-applications-1", "synthetic-applications-2"] });
    expect(fixture.options).toEqual({ maxWait: 10_000, timeout: 20_000 });
    expect(fixture.committed.submissions).toHaveLength(1);
    expect(fixture.committed.applications).toHaveLength(2);
    expect(fixture.committed.devices).toHaveLength(1);
    expect(fixture.committed.deviceSubmissions).toHaveLength(1);
    expect(fixture.committed.companionMembers).toHaveLength(companion ? 1 : 0);
    expect(fixture.outboxChecks).toBe(1);
    expect(fixture.outboxInserts).toBe(1);
    expect(fixture.attempted.at(-1)?.table).toBe("outbox");
    expect(fixture.committed.outbox).toEqual([{
      id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
      eventKind: "application.received", entityId: submissionId,
      dedupeKey: buildDedupeKey("application.received", submissionId, "created"), audience: "admin", occurredAt: now,
      status: "pending", attemptCount: 0, lastErrorCode: null, providerId: null, providerRef: null,
      nextRetryAt: null, claimToken: null, leaseExpiresAt: null, createdAt: now, updatedAt: now,
    }]);
  });

  it("rolls back all application data when a later application write fails", async () => {
    const fixture = new SubmissionTransactionFixture();
    fixture.failApplicationAt = 2;
    await expect(submitApplicationGroupCore(fixture.client(), input())).rejects.toThrow("synthetic-application-write-failed");
    expect(fixture.attempted.map(({ table }) => table)).toEqual(["submissions", "devices", "deviceSubmissions", "applications"]);
    expect(Object.values(fixture.committed).flat()).toEqual([]);
    expect(fixture.outboxChecks).toBe(0);
    expect(fixture.outboxInserts).toBe(0);
  });

  it("propagates outbox INSERT failure and rolls back every preceding application write", async () => {
    const fixture = new SubmissionTransactionFixture();
    fixture.insertError = new Error("synthetic-outbox-insert-failed");
    await expect(submitApplicationGroupCore(fixture.client(), input(true))).rejects.toBe(fixture.insertError);
    expect(fixture.attempted.map(({ table }) => table)).toEqual(["submissions", "devices", "deviceSubmissions", "companionMembers", "applications", "applications"]);
    expect(fixture.outboxInserts).toBe(1);
    expect(Object.values(fixture.committed).flat()).toEqual([]);
  });

  it.each([false, true])("replay returns the same shape without writes or outbox access (existing outbox=%s)", async (hasOutbox) => {
    const fixture = new SubmissionTransactionFixture();
    fixture.committed.submissions.push(priorSubmission());
    if (hasOutbox) fixture.committed.outbox.push(existingOutbox());
    const before = structuredClone(fixture.committed);
    const result = await submitApplicationGroupCore(fixture.client(), { ...input(), previousCompletionTokenHash: "synthetic-prior-completion-hash" });
    expect(result).toEqual({ submissionId, applicationIds: [], replayed: true });
    expect(fixture.committed).toEqual(before);
    expect(fixture.attempted).toEqual([]);
    expect(fixture.outboxChecks).toBe(0);
    expect(fixture.outboxInserts).toBe(0);
  });

  it.each(["mismatch", "purged", "expired"])("rejects a prior %s submission without recreating it or touching its outbox", async (condition) => {
    const fixture = new SubmissionTransactionFixture();
    fixture.committed.submissions.push({
      ...priorSubmission(),
      ...(condition === "purged" ? { personalDataPurgedAt: now } : {}),
      ...(condition === "expired" ? { completionExpiresAt: now } : {}),
    });
    fixture.committed.outbox.push(existingOutbox());
    const before = structuredClone(fixture.committed);
    await expect(submitApplicationGroupCore(fixture.client(), {
      ...input(), previousCompletionTokenHash: condition === "mismatch" ? "synthetic-mismatch-hash" : "synthetic-prior-completion-hash",
    })).rejects.toBeInstanceOf(ApplicationAlreadySubmittedError);
    expect(fixture.committed).toEqual(before);
    expect(fixture.attempted).toEqual([]);
    expect(fixture.outboxChecks).toBe(0);
    expect(fixture.outboxInserts).toBe(0);
  });

  it("commits fresh application data but skips a pre-existing outbox dedupeKey without modifying that row", async () => {
    const fixture = new SubmissionTransactionFixture();
    const previous = existingOutbox();
    fixture.committed.outbox.push(previous);
    expect(await submitApplicationGroupCore(fixture.client(), input())).toEqual({ submissionId, applicationIds: ["synthetic-applications-1", "synthetic-applications-2"] });
    expect(fixture.committed.submissions).toHaveLength(1);
    expect(fixture.committed.applications).toHaveLength(2);
    expect(fixture.committed.outbox).toEqual([previous]);
    expect(fixture.outboxChecks).toBe(1);
    expect(fixture.outboxInserts).toBe(0);
  });

  it("persists no synthetic PII, price, capability, URL, account or financial payload in the outbox", async () => {
    const fixture = new SubmissionTransactionFixture();
    await submitApplicationGroupCore(fixture.client(), input());
    expect(fixture.committed.submissions[0].guardianName).toBe(privateProbes[0]);
    expect(fixture.committed.applications[0].quotedAmount).toBe(syntheticPrice);
    expect(fixture.committed.applications[0].requestNote).toContain(privateProbes.at(-1));
    const json = JSON.stringify(fixture.committed.outbox);
    for (const probe of privateProbes) expect(json).not.toContain(probe);
    for (const key of ["guardian", "phone", "amount", "quotedAmount", "payer", "requestNote", "http", "account"]) expect(json).not.toContain(key);
  });

  it.each(["expired", "changed"])("preserves the %s price guard before all writes", async (condition) => {
    const fixture = new SubmissionTransactionFixture();
    proofMocks.authenticate.mockReturnValue({
      operation, issuedAt: now.getTime() - (condition === "expired" ? 3 * 60 * 60 * 1000 : 0),
      prices: [{ classScheduleId: scheduleId, amount: syntheticPrice + (condition === "changed" ? 1 : 0) }],
    });
    await expect(submitApplicationGroupCore(fixture.client(), input())).rejects.toBeInstanceOf(condition === "expired" ? ApplicationPriceReviewExpiredError : ApplicationPriceChangedError);
    expect(fixture.attempted).toEqual([]);
    expect(fixture.outboxChecks).toBe(0);
    expect(Object.values(fixture.committed).flat()).toEqual([]);
  });
});

describe("transaction helper and strict synthetic uniqueness", () => {
  it("parameterizes the SELECT and INSERT, including an SQL-like synthetic identity, and explicitly supplies updatedAt", async () => {
    const fixture = new SubmissionTransactionFixture();
    const identity = "synthetic-id'); DROP TABLE synthetic_only; --";
    await fixture.transaction(async (tx) => {
      const query = vi.spyOn(tx, "$queryRaw");
      const execute = vi.spyOn(tx, "$executeRaw");
      expect(await insertApplicationReceivedOutbox(tx, { submissionId: identity, now })).toEqual({ inserted: true });
      const selectSql = query.mock.calls[0][0] as Prisma.Sql;
      const insertSql = execute.mock.calls[0][0];
      expect(selectSql.values).toEqual([buildDedupeKey("application.received", identity, "created")]);
      expect(insertSql.sql).not.toContain(identity);
      expect(insertSql.values).toContain(identity);
      expect(insertSql.sql).toContain('::"NotificationOutboxStatus"');
      expect(insertSql.sql).toContain('"updatedAt"');
      expect(insertSql.values.at(-1)).toBe(now);
    });
  });

  it("returns inserted:false before INSERT when the dedupeKey already exists", async () => {
    const fixture = new SubmissionTransactionFixture();
    fixture.committed.outbox.push(existingOutbox());
    const before = structuredClone(fixture.committed);
    expect(await fixture.transaction((tx) => insertApplicationReceivedOutbox(tx, { submissionId, now }))).toEqual({ inserted: false });
    expect(fixture.outboxInserts).toBe(0);
    expect(fixture.committed).toEqual(before);
  });

  it("propagates a SELECT failure without attempting INSERT", async () => {
    const fixture = new SubmissionTransactionFixture();
    fixture.queryError = new Error("synthetic-select-failed");
    await expect(fixture.transaction((tx) => insertApplicationReceivedOutbox(tx, { submissionId, now }))).rejects.toBe(fixture.queryError);
    expect(fixture.outboxInserts).toBe(0);
    expect(fixture.committed.outbox).toEqual([]);
  });

  it("enforces submission primary-key uniqueness in the mock and discards its earlier write", async () => {
    const fixture = new SubmissionTransactionFixture();
    await expect(fixture.transaction(async (tx) => {
      await tx.reservationApplicationSubmission.create({ data: { id: submissionId } });
      await tx.reservationApplicationSubmission.create({ data: { id: submissionId } });
    })).rejects.toThrow("synthetic-primary-key-submissions");
    expect(fixture.attempted).toHaveLength(1);
    expect(fixture.committed.submissions).toEqual([]);
  });

  it("enforces outbox unique dedupeKey in the mock and propagates an INSERT-time collision", async () => {
    const fixture = new SubmissionTransactionFixture();
    await expect(fixture.transaction(async (tx) => {
      const execute = vi.spyOn(tx, "$executeRaw");
      await insertApplicationReceivedOutbox(tx, { submissionId, now });
      // Simulate another insertion winning after the SELECT, without weakening
      // the helper to swallow unique errors inside an aborted transaction.
      await tx.$executeRaw(execute.mock.calls[0][0]);
    })).rejects.toThrow("synthetic-outbox-unique-dedupeKey");
    expect(fixture.committed.outbox).toEqual([]);
  });
});
