import "server-only";
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { emptyMockData, type MockRun } from "@/lib/db/manual-test-prisma";

export type ManualSqlClient = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
type Row = Record<string, unknown>;
// Identifiers are private constants, never request input. All values are parameters.
const tables = ["User", "Teacher", "Program", "ClassSchedule", "ClassTeacher", "Child", "ReservationApplicationGroup", "ReservationApplicationGroupClass", "ReservationApplicationLink", "ReservationApplicationSubmission", "ReservationApplication", "ApplicationDeposit", "Reservation", "Payment", "PaymentItem", "Refund", "ManualTestSession", "ManualTestAccessGrant", "ManualTestOperationReceipt"] as const;
type Table = typeof tables[number];
const identifier = (value: string) => Prisma.raw(`"${value}"`);
const tableSql = (table: Table | "ManualTestRun" | "ManualTestChallenge") => Prisma.sql`"manual_test".${identifier(table)}`;
const text = (row: Row, key: string) => z.string().parse(row[key]);
const number = (row: Row, key: string) => z.number().int().parse(row[key]);
const time = (value: unknown) => z.date().parse(value).getTime();
const fixtureId = (runId: string, id: string) => `${runId}:${id}`;
function fixtureName(runId: string, value: unknown) {
  const id = z.string().parse(value);
  if (!id.startsWith(`${runId}:`)) throw new Error("MANUAL_DATABASE_BINDING");
  return id.slice(runId.length + 1);
}
const actorId = (runId: string) => fixtureId(runId, "operator");
const groupId = (runId: string, classId: string) => fixtureId(runId, `group:${classId}`);
const linkId = (runId: string, classId: string) => fixtureId(runId, `link:${classId}`);
const submissionId = (runId: string, hash: string) => fixtureId(runId, `submission:${hash}`);
const itemId = (paymentId: string) => `${paymentId}:item`;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const enumTypes: Record<string, string> = {
  "ManualTestRun.status": "ManualTestRunStatus", "ManualTestSession.scope": "ManualTestSessionScope",
  "ClassSchedule.status": "ClassStatus", "ClassSchedule.cancelReason": "ClassCancelReason",
  "ReservationApplication.status": "ReservationApplicationStatus", "ReservationApplication.childGender": "Gender",
  "Reservation.status": "ReservationStatus", "Reservation.cancelReason": "ReservationCancelReason", "Reservation.attendance": "AttendanceStatus",
  "Payment.status": "PaymentStatus", "Payment.method": "PaymentMethod", "Refund.reason": "RefundReason",
};
function sqlValue(table: string, column: string, value: unknown) {
  const enumType = enumTypes[`${table}.${column}`];
  if (enumType) return Prisma.sql`${value as string | null}::"manual_test".${identifier(enumType)}`;
  if (column === "resultIds") return Prisma.sql`${JSON.stringify(value)}::jsonb`;
  return Prisma.sql`${value as Prisma.InputJsonValue | Date | null}`;
}

async function upsert(client: ManualSqlClient, table: Table, runId: string, row: Row) {
  // Table tagging only — never log here. The caller (lib/db) whitelists and
  // logs the table as a fixed token; persistence.ts must not import logManualDbError
  // so the lib/db → server/manual-test dependency direction is preserved.
  try {
    const data = { ...row, runId };
    const columns = Object.keys(data);
    // Conflict scope includes runId: a caller can never update another run's row.
    const updates = columns.filter((key) => !["id", "runId", "createdAt", "submittedAt", "issuedAt", "reservedAt", "paidAt", "confirmedAt", "depositedAt", "refundedAt"].includes(key));
    await client.$executeRaw(Prisma.sql`INSERT INTO ${tableSql(table)} (${Prisma.join(columns.map(identifier))}) VALUES (${Prisma.join(columns.map((column) => sqlValue(table, column, data[column as keyof typeof data])))}) ON CONFLICT ("runId", "id") DO UPDATE SET ${Prisma.join(updates.map((key) => key === "resolvedAt" ? Prisma.sql`"resolvedAt" = COALESCE(${tableSql(table)}."resolvedAt", EXCLUDED."resolvedAt")` : Prisma.sql`${identifier(key)} = EXCLUDED.${identifier(key)}`))}`);
  } catch (error) {
    if (typeof error === "object" && error !== null) {
      (error as { manualTable?: Table }).manualTable = table;
    }
    throw error;
  }
}

export async function setManualSearchPath(client: ManualSqlClient) {
  await client.$executeRaw(Prisma.sql`SET LOCAL search_path = "manual_test"`);
  const rows = await client.$queryRaw<{ schema: string | null; path: string }[]>(Prisma.sql`SELECT pg_catalog.current_schema() AS "schema", pg_catalog.current_setting('search_path') AS "path"`);
  if (rows[0]?.schema !== "manual_test" || rows[0]?.path !== '"manual_test"' && rows[0]?.path !== "manual_test") throw new Error("MANUAL_DATABASE_SCHEMA_DENIED");
}

export async function lockManualRun(client: ManualSqlClient, runId: string) {
  const rows = await client.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM "manual_test"."ManualTestRun" WHERE "id" = ${runId} FOR UPDATE`);
  if (!rows[0]) throw new Error("MOCK_RUN_UNAVAILABLE");
  return rows[0];
}

export async function hydrateManualRun(client: ManualSqlClient, root: Row): Promise<MockRun> {
  const runId = text(root, "id");
  // The run lock serializes this aggregate; item locks also follow the refund
  // service contract before any ledger reads or refund insertion.
  await client.$queryRaw(Prisma.sql`SELECT "id" FROM "manual_test"."PaymentItem" WHERE "runId" = ${runId} FOR UPDATE`);
  const run: MockRun = { id: runId, mode: "DATABASE", status: z.enum(["ACTIVE", "CLOSED", "CLEANED"]).parse(root.status), expiresAt: time(root.expiresAt), sessions: {}, grants: {}, receipts: {}, data: emptyMockData() };
  if (run.status === "CLEANED") return run;
  const rows = {} as Record<Table, Row[]>;
  for (const table of tables) rows[table] = z.array(z.record(z.unknown())).parse(await client.$queryRaw(Prisma.sql`SELECT * FROM ${tableSql(table)} WHERE "runId" = ${runId}`));
  for (const row of rows.Child) {
    const id = fixtureName(runId, row.id);
    run.data.children[id] = { id, active: z.boolean().parse(row.isActive) };
  }
  for (const row of rows.ClassSchedule) {
    const id = text(row, "id");
    run.data.classes[id] = { id, capacity: number(row, "capacity"), quotedAmount: number(row, "applicationPrice"), teacherIds: rows.ClassTeacher.filter((r) => r.classScheduleId === id).map((r) => fixtureName(runId, r.teacherId)).sort(), startsAt: time(row.startsAt), endsAt: time(row.endsAt), status: z.enum(["SCHEDULED", "CANCELLED"]).parse(row.status), ...(row.cancelledAt ? { cancelledAt: time(row.cancelledAt), cancellationReason: "SYNTHETIC_OPERATOR_CANCELLATION" as const } : {}) };
  }
  for (const row of rows.ReservationApplication) {
    const id = text(row, "id");
    const status = z.enum(["SUBMITTED", "CONFIRMED", "CANCELLED"]).parse(row.status);
    run.data.applications[id] = { id, classId: text(row, "classScheduleId"), childId: fixtureName(runId, row.requestedChildId), quotedAmount: number(row, "quotedAmount"), status: status === "SUBMITTED" ? "PENDING" : status, ...(row.reservationId ? { reservationId: text(row, "reservationId") } : {}), ...(status === "CANCELLED" ? { cancelledAt: time(row.resolvedAt), cancellationReason: "SYNTHETIC_OPERATOR_CANCELLATION" as const } : {}) };
  }
  for (const row of rows.ApplicationDeposit) run.data.deposits.push({ id: text(row, "id"), applicationId: text(row, "submissionId"), amount: number(row, "amount") });
  for (const row of rows.Reservation) {
    const id = text(row, "id");
    const application = rows.ReservationApplication.find((r) => r.reservationId === id);
    if (!application) throw new Error("MANUAL_DATABASE_BINDING");
    run.data.reservations[id] = { id, applicationId: text(application, "id"), classId: text(row, "classScheduleId"), childId: fixtureName(runId, row.childId), status: z.enum(["RESERVED", "CANCELLED", "NO_SHOW"]).parse(row.status), ...(row.attendance ? { attendance: z.enum(["PRESENT", "ABSENT"]).parse(row.attendance) } : {}), ...(row.cancelledAt ? { cancelledAt: time(row.cancelledAt), cancellationReason: "SYNTHETIC_OPERATOR_CANCELLATION" as const } : {}) };
  }
  for (const row of rows.Payment) {
    const id = text(row, "id");
    const item = rows.PaymentItem.find((r) => r.paymentId === id);
    if (!item) throw new Error("MANUAL_DATABASE_BINDING");
    const status = z.enum(["PAID", "PARTIAL_REFUNDED", "REFUNDED"]).parse(row.status);
    run.data.payments[id] = { id, reservationId: text(item, "reservationId"), amount: number(row, "totalAmount"), refundedAmount: number(item, "refundedAmount"), status: status === "PARTIAL_REFUNDED" ? "PARTIALLY_REFUNDED" : status };
  }
  for (const row of rows.Refund) {
    const item = rows.PaymentItem.find((r) => r.id === row.paymentItemId);
    if (!item) throw new Error("MANUAL_DATABASE_BINDING");
    run.data.refunds.push({ id: text(row, "id"), paymentId: text(item, "paymentId"), amount: number(row, "amount"), reason: row.reason === "PERSONAL" ? "CUSTOMER_REQUEST" : text(row, "reason"), ...(row.reasonDetail ? { detail: text(row, "reasonDetail") } : {}) });
  }
  const classForLink = (id: unknown) => {
    const link = rows.ReservationApplicationLink.find((r) => r.id === id);
    const binding = link && rows.ReservationApplicationGroupClass.find((r) => r.groupId === link.groupId);
    if (!binding) throw new Error("MANUAL_DATABASE_BINDING");
    return text(binding, "classScheduleId");
  };
  for (const row of rows.ManualTestSession) {
    const hash = text(row, "tokenHash");
    const ids = rows.ReservationApplication.filter((r) => row.submissionId && r.submissionId === row.submissionId).map((r) => text(r, "id"));
    run.sessions[hash] = { hash, runId, scope: z.enum(["OPERATOR", "RESERVATION"]).parse(row.scope), expiresAt: time(row.expiresAt), revoked: !!row.revokedAt, ...(row.linkId ? { classId: classForLink(row.linkId) } : {}), ...(ids.length ? { applicationIds: ids, applicationId: ids[0] } : {}) };
  }
  for (const row of rows.ManualTestAccessGrant) {
    const hash = text(row, "tokenHash");
    run.grants[hash] = { hash, runId, classId: classForLink(row.linkId), expiresAt: time(row.expiresAt), consumed: !!row.consumedAt };
  }
  for (const row of rows.ManualTestOperationReceipt) run.receipts[`${text(row, "operation")}:${text(row, "requestKey")}`] = { payload: text(row, "payloadDigest"), result: row.resultIds };
  return run;
}

// Existing tables include unused dependencies. Remove only this run in FK-safe order;
// preserve ManualTestRun as a retryable tombstone — there is no cleanup credential anymore.
const cleanupTables = ["ManualTestOperationReceipt", "ManualTestAccessGrant", "ManualTestSession", "DeviceChild", "DeviceSubmission", "ApplicationDevice", "ChildConsent", "FundAllocation", "ApplicationReturn", "ReturnObligation", "ApplicationDeposit", "ReservationApplicationPaymentMapping", "ReservationApplication", "Refund", "PaymentItem", "Payment", "Reservation", "ReservationApplicationSubmission", "ReservationApplicationLink", "ReservationApplicationGroupClass", "ReservationApplicationGroup", "ReservationApplicationSettings", "ClassTeacher", "ClassSchedule", "Program", "Teacher", "Child", "User"] as const;

export async function persistManualRun(client: ManualSqlClient, run: MockRun, previous?: MockRun) {
  const now = new Date();
  const runId = run.id;
  const actor = actorId(runId);
  // Digests are persisted, never plaintext request payloads. Accept already hydrated digests.
  for (const receipt of Object.values(run.receipts)) if (!/^[a-f0-9]{64}$/.test(receipt.payload)) receipt.payload = digest(receipt.payload);
  if (run.status === "CLEANED") {
    for (const table of cleanupTables) await client.$executeRaw(Prisma.sql`DELETE FROM "manual_test".${identifier(table)} WHERE "runId" = ${runId}`);
  } else {
    const put = (table: Table, row: Row) => upsert(client, table, runId, { createdAt: now, ...row });
    if (!previous) {
      await put("User", { id: actor, name: "TEST operator", updatedAt: now });
      for (const id of ["teacher-1", "teacher-2"]) await put("Teacher", { id: fixtureId(runId, id), name: `TEST ${id}`, updatedAt: now });
      await put("Program", { id: fixtureId(runId, "program"), name: "TEST program", updatedAt: now });
    }
    for (const child of Object.values(run.data.children)) if (!previous || JSON.stringify(previous.data.children[child.id]) !== JSON.stringify(child)) await put("Child", { id: fixtureId(runId, child.id), name: `TEST ${child.id}`, isActive: child.active, updatedAt: now });
    for (const row of Object.values(run.data.classes)) if (!previous || JSON.stringify(previous.data.classes[row.id]) !== JSON.stringify(row)) {
      await put("ClassSchedule", { id: row.id, programId: fixtureId(runId, "program"), location: "TEST", capacity: row.capacity, applicationPrice: row.quotedAmount, startsAt: new Date(row.startsAt), endsAt: new Date(row.endsAt), status: row.status, cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null, cancelReason: row.cancelledAt ? "OPERATION" : null, cancelDetail: row.cancellationReason ?? null, cancelledById: row.cancelledAt ? actor : null, updatedAt: now });
      for (const teacher of row.teacherIds) await put("ClassTeacher", { id: fixtureId(runId, `${row.id}:${teacher}`), classScheduleId: row.id, teacherId: fixtureId(runId, teacher) });
      await put("ReservationApplicationGroup", { id: groupId(runId, row.id), createdById: actor, updatedAt: now });
      await put("ReservationApplicationGroupClass", { id: fixtureId(runId, `group-class:${row.id}`), groupId: groupId(runId, row.id), classScheduleId: row.id });
      await put("ReservationApplicationLink", { id: linkId(runId, row.id), groupId: groupId(runId, row.id), tokenHash: digest(linkId(runId, row.id)), issuedById: actor, updatedAt: now });
    }
    const submissions = new Map<string, string>();
    for (const session of Object.values(run.sessions)) {
      const ids = session.applicationIds ?? (session.applicationId ? [session.applicationId] : []);
      if (ids.length) {
        const id = submissionId(runId, session.hash);
        for (const applicationId of ids) submissions.set(applicationId, id);
        if (!previous?.sessions[session.hash]?.applicationId) await put("ReservationApplicationSubmission", { id, groupId: groupId(runId, session.classId!), guardianName: "TEST guardian", updatedAt: now });
      }
    }
    // ReservationApplication has a reservation FK; create reservations first.
    for (const row of Object.values(run.data.reservations)) if (!previous || JSON.stringify(previous.data.reservations[row.id]) !== JSON.stringify(row)) await put("Reservation", { id: row.id, childId: fixtureId(runId, row.childId), classScheduleId: row.classId, status: row.status, attendance: row.attendance ?? null, cancelledAt: row.cancelledAt ? new Date(row.cancelledAt) : null, cancelReason: row.cancelledAt ? "OPERATION" : null, cancelDetail: row.cancellationReason ?? null, cancelledById: row.cancelledAt ? actor : null, updatedAt: now });
    for (const row of Object.values(run.data.applications)) if (!previous || JSON.stringify(previous.data.applications[row.id]) !== JSON.stringify(row)) {
      const submission = submissions.get(row.id);
      if (!submission) throw new Error("MANUAL_DATABASE_BINDING");
      await put("ReservationApplication", { id: row.id, classScheduleId: row.classId, submissionId: submission, requestedChildId: fixtureId(runId, row.childId), quotedAmount: row.quotedAmount, status: row.status === "PENDING" ? "SUBMITTED" : row.status, childName: `TEST ${row.childId}`, childBirthDate: new Date("2020-01-01"), childGender: "UNSPECIFIED", programTermsAcknowledged: true, privacyConsentAgreed: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true, photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: "SYNTHETIC_TEST", resolvedAt: row.status === "PENDING" ? null : new Date(row.cancelledAt ?? now.getTime()), resolvedById: row.status === "PENDING" ? null : actor, resolutionNote: row.cancellationReason ?? null, childId: row.status === "CONFIRMED" ? fixtureId(runId, row.childId) : null, reservationId: row.reservationId ?? null, updatedAt: now });
    }
    for (const row of run.data.deposits) if (!previous?.data.deposits.some((r) => r.id === row.id)) await put("ApplicationDeposit", { id: row.id, submissionId: submissions.get(row.applicationId) ?? row.applicationId, amount: row.amount, confirmedById: actor, confirmedAt: now, depositedAt: now });
    for (const row of run.data.refunds) if (!previous?.data.refunds.some((r) => r.id === row.id)) await put("Refund", { id: row.id, paymentItemId: itemId(row.paymentId), amount: row.amount, reason: row.reason === "CUSTOMER_REQUEST" ? "PERSONAL" : row.reason, reasonDetail: row.detail ?? null, processedById: actor });
    for (const row of Object.values(run.data.payments)) if (!previous || JSON.stringify(previous.data.payments[row.id]) !== JSON.stringify(row)) {
      if (!previous?.data.payments[row.id]) await put("Payment", { id: row.id, method: "TRANSFER", totalAmount: row.amount, status: "PAID", updatedAt: now });
      await put("PaymentItem", { id: itemId(row.id), paymentId: row.id, reservationId: row.reservationId, amount: row.amount, paidAmount: row.amount, refundedAmount: row.refundedAmount, updatedAt: now });
      await put("Payment", { id: row.id, method: "TRANSFER", totalAmount: row.amount, status: row.status === "PARTIALLY_REFUNDED" ? "PARTIAL_REFUNDED" : row.status, updatedAt: now });
    }

    for (const row of Object.values(run.sessions)) if (!previous || JSON.stringify(previous.sessions[row.hash]) !== JSON.stringify(row)) await put("ManualTestSession", { id: fixtureId(runId, row.hash), tokenHash: row.hash, scope: row.scope, actorUserId: row.scope === "OPERATOR" ? actor : null, linkId: row.classId ? linkId(runId, row.classId) : null, submissionId: row.applicationId ? submissionId(runId, row.hash) : null, expiresAt: new Date(row.expiresAt), revokedAt: row.revoked ? now : null });
    for (const row of Object.values(run.grants)) if (!previous || JSON.stringify(previous.grants[row.hash]) !== JSON.stringify(row)) await put("ManualTestAccessGrant", { id: fixtureId(runId, row.hash), tokenHash: row.hash, linkId: linkId(runId, row.classId), expiresAt: new Date(row.expiresAt), consumedAt: row.consumed ? new Date(Math.min(now.getTime(), row.expiresAt)) : null });
    for (const [key, row] of Object.entries(run.receipts)) if (!previous?.receipts[key]) {
      const [operation, requestKey] = key.split(":");
      await put("ManualTestOperationReceipt", { id: fixtureId(runId, key), operation, requestKey, payloadDigest: row.payload, resultIds: row.result });
    }
  }
  await client.$executeRaw(Prisma.sql`UPDATE "manual_test"."ManualTestRun" SET "status" = ${run.status}::"manual_test"."ManualTestRunStatus", "closedAt" = CASE WHEN ${run.status !== "ACTIVE"} THEN COALESCE("closedAt", ${now}) ELSE NULL END, "cleanedAt" = CASE WHEN ${run.status === "CLEANED"} THEN COALESCE("cleanedAt", ${now}) ELSE NULL END WHERE "id" = ${runId}`);
}
