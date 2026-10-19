import { describe, expect, it, vi } from "vitest";
import { readState } from "@/server/ai-service/admin";
import { fakeDb, now, seedConfig } from "./fake-db";

const admin = { userId: "synthetic-admin", role: "ADMIN", active: true };

describe("ADMIN retained request summary", () => {
    it("counts all retained requests across months and statuses independently of the latest 50 records", async () => {
        const f = fakeDb();
        const seed = (status: string, dispatched: boolean, extra: Record<string, unknown> = {}) => f.seed("aiServiceRequest", {
            id: `synthetic-${f.state.aiServiceRequest.length}`, environment: "PREVIEW", month: "2026-10",
            status, dispatched, attempt: 1, createdAt: now, expiresAt: new Date(+now + 1), ...extra,
        });
        for (let i = 0; i < 55; i++)
            seed("SETTLED", true, { month: "2026-09" });
        seed("PROCESSING", true);
        seed("PROCESSING", false, { attempt: 7, attemptDeadline: new Date(+now - 1) });
        seed("FAILED", false, { attempt: 9 });
        seed("FAILED", false);
        for (let i = 0; i < 3; i++)
            seed("UNKNOWN", true);
        seed("RECONCILED", true);
        seed("UNKNOWN", true, { expiresAt: now });
        seed("FAILED", false, { expiresAt: new Date(+now - 1) });
        seed("UNKNOWN", true, { environment: "PRODUCTION" });
        seedConfig(f);
        f.seed("aiServiceBudgetMonth", { id: "synthetic-budget", environment: "PREVIEW", month: "2026-10", unknownCount: 99 });
        const before = structuredClone(f.state);

        const state = await readState(f.db, "PREVIEW", admin, now);

        expect(state.summary).toEqual({ totalRequests: 63, dispatchAttempts: 60, failedRequests: 2, unknownRequests: 3, asOf: now });
        expect(state.consultations).toHaveLength(50);
        expect(state.consultations.every(row => row.status === "SETTLED")).toBe(true);
        expect(state.expiredCount).toBe(2);
        expect(state.config?.version).toBe(1);
        expect(state.budgets[0].unknownCount).toBe(99);
        expect(f.state).toEqual(before);
        expect(f.operations.filter(op => op === "aiServiceRequest.groupBy")).toHaveLength(1);
        expect(f.operations.filter(op => op === "aiServiceRequest.count")).toHaveLength(1);
    });

    it("returns zero counts when the environment has no unexpired requests", async () => {
        const f = fakeDb();
        f.seed("aiServiceRequest", { environment: "PREVIEW", status: "UNKNOWN", dispatched: true, expiresAt: now });
        f.seed("aiServiceRequest", { environment: "PRODUCTION", status: "SETTLED", dispatched: true, expiresAt: new Date(+now + 1) });

        const state = await readState(f.db, "PREVIEW", admin, now);

        expect(state.summary).toEqual({ totalRequests: 0, dispatchAttempts: 0, failedRequests: 0, unknownRequests: 0, asOf: now });
        expect(state.consultations).toEqual([]);
        expect(state.expiredCount).toBe(1);
    });

    it("uses one grouped query and the same expiry instant within the existing locked transaction", async () => {
        const f = fakeDb();
        const spies = await f.db.$transaction(async tx => ({
            groupBy: vi.spyOn(tx.aiServiceRequest, "groupBy"),
            findMany: vi.spyOn(tx.aiServiceRequest, "findMany"),
            count: vi.spyOn(tx.aiServiceRequest, "count"),
            execute: vi.spyOn(tx, "$executeRaw"),
        }));
        const transact = vi.spyOn(f.db, "$transaction");

        const state = await readState(f.db, "PRODUCTION", admin, now);

        expect(spies.groupBy).toHaveBeenCalledTimes(1);
        expect(spies.groupBy).toHaveBeenCalledWith({
            by: ["status", "dispatched"], where: { environment: "PRODUCTION", expiresAt: { gt: now } }, _count: { _all: true },
        });
        expect(spies.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { environment: "PRODUCTION", expiresAt: { gt: now } }, take: 50 }));
        expect(spies.count).toHaveBeenCalledTimes(1);
        expect(spies.count).toHaveBeenCalledWith({ where: { environment: "PRODUCTION", expiresAt: { lte: now } } });
        expect(state.summary.asOf).toBe(now);
        expect(transact).toHaveBeenCalledTimes(1);
        expect(transact).toHaveBeenCalledWith(expect.any(Function), { maxWait: 50, timeout: 250 });
        expect(spies.execute.mock.calls).toEqual([
            [["SET LOCAL statement_timeout = '180ms'"]],
            [["SET LOCAL lock_timeout = '50ms'"]],
            [["SELECT pg_advisory_xact_lock(hashtextextended(", ", 21062))"], "ai-service:PRODUCTION"],
        ]);
        expect(f.operations.slice(0, 4)).toEqual(["lock", "lock", "lock", "aiServiceRequest.groupBy"]);
    });

    it.each([
        { ...admin, role: "MANAGER" },
        { ...admin, role: "TEACHER" },
        { ...admin, active: false },
        { ...admin, userId: "" },
    ])("denies unauthorized actors before any database access: %j", async actor => {
        const f = fakeDb();
        const transact = vi.spyOn(f.db, "$transaction");

        await expect(readState(f.db, "PREVIEW", actor, now)).rejects.toThrow("AI_SERVICE_DENIED");

        expect(transact).not.toHaveBeenCalled();
        expect(f.operations).toEqual([]);
    });

    it("fails closed when aggregation fails", async () => {
        const f = fakeDb();
        f.failNext("aiServiceRequest.groupBy");

        await expect(readState(f.db, "PREVIEW", admin, now)).rejects.toThrow("AI_SERVICE_DENIED");

        expect(f.operations).toEqual(["lock", "lock", "lock", "aiServiceRequest.groupBy"]);
    });
});
