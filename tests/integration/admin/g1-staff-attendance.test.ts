/** Isolated local PostgreSQL only. Session transport is mocked; server action and DB are real. */
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../../e2e/support/db-safety";

const context = vi.hoisted(() => ({ db: null as unknown as PrismaClient, userId: "" }));
vi.mock("@/auth", () => ({ auth: async () => ({ user: { id: context.userId, authVersion: 1 } }) }));
vi.mock("@/lib/db/prisma", () => ({ get prisma() { return context.db; } }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));

if (process.env.VERCEL_ENV || process.env.PLAYWRIGHT_PREVIEW_E2E === "1") throw new Error("LOCAL_ONLY");
assertSafeE2eDatabaseUrls({ DATABASE_URL: process.env["DATA" + "BASE_URL"], DIRECT_URL: process.env.DIRECT_URL });
const db = new PrismaClient();
context.db = db;
const run = `g1-staff-${crypto.randomUUID()}`;
context.userId = `${run}-user`;
let programId = "";
let childId = "";
let classId = "";
let reservationId = "";

beforeAll(async () => {
  await db.user.create({ data: { id: context.userId, name: run, email: `${run}@example.test`, password: "synthetic-hash", role: "STAFF", isActive: true, authVersion: 1, mustChangePassword: false } });
  programId = (await db.program.create({ data: { name: run } })).id;
  childId = (await db.child.create({ data: { name: run } })).id;
  classId = (await db.classSchedule.create({ data: { programId, startsAt: new Date("2020-01-01T00:00:00Z"), endsAt: new Date("2020-01-01T01:00:00Z"), location: run } })).id;
  reservationId = (await db.reservation.create({ data: { childId, classScheduleId: classId } })).id;
}, 30000);

afterAll(async () => {
  await db.reservation.deleteMany({ where: { id: reservationId } });
  await db.classSchedule.deleteMany({ where: { id: classId } });
  await db.child.deleteMany({ where: { id: childId } });
  await db.program.deleteMany({ where: { id: programId } });
  await db.user.deleteMany({ where: { id: context.userId } });
  await db.$disconnect();
}, 30000);

it("denies STAFF server action against a real reservation without changing the row", async () => {
  const { recordAttendanceAction } = await import("@/app/(admin)/reservations/attendance-actions");
  const before = await db.reservation.findUniqueOrThrow({ where: { id: reservationId } });
  const form = new FormData();
  form.set("reservationId", reservationId);
  form.set("attendance", "PRESENT");
  await expect(recordAttendanceAction({}, form)).rejects.toThrow("NOT_FOUND");
  expect(await db.reservation.findUniqueOrThrow({ where: { id: reservationId } })).toEqual(before);
});
