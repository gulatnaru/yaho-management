import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { Phase20RaceBarrierError, runPhase20PostgresRace, type Phase20RaceObserver, type Phase20RaceSql, type Phase20RaceTransaction, type Phase20RaceTransactionAdapter } from "@/tests/e2e/support/phase20-race-barrier";

type FakeOptions = {
  pid: number;
  failPid?: boolean;
  onQuery?: (text: string) => void;
};

function fakeClient({ pid, failPid = false, onQuery }: FakeOptions): Phase20RaceTransactionAdapter {
  return {
    async $transaction<T>(callback: (tx: Phase20RaceTransaction) => Promise<T>): Promise<T> {
      const tx: Phase20RaceTransaction = {
        async $queryRaw<TResult>(query: Phase20RaceSql): Promise<TResult> {
          const text = "strings" in query ? query.strings.join("?") : query.join("?");
          if (text.includes("pg_backend_pid")) {
            if (failPid) throw new Error("synthetic pid failure");
            return [{ pid }] as TResult;
          }
          onQuery?.(text);
          return [] as TResult;
        },
      };
      return callback(tx);
    },
  };
}

async function expectedLock(client: Phase20RaceTransactionAdapter) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT * FROM ReservationApplicationSubmission FOR UPDATE`;
  });
}

async function unrelatedQuery(client: Phase20RaceTransactionAdapter) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT * FROM unrelated_table`;
  });
}

async function prismaSqlLock(client: Phase20RaceTransactionAdapter) {
  return client.$transaction(async (tx) => {
    await tx.$queryRaw(Prisma.sql`SELECT * FROM ReservationApplicationSubmission FOR UPDATE`);
  });
}

function input(overrides: Partial<Parameters<typeof runPhase20PostgresRace>[0]> = {}) {
  let bReachedLock = false;
  const a = fakeClient({ pid: 11 });
  const b = fakeClient({ pid: 22, onQuery: (text) => { if (text.includes("ReservationApplicationSubmission")) bReachedLock = true; } });
  const observer: Phase20RaceObserver = {
    async $queryRaw<TResult>(): Promise<TResult> {
      return [{ waiting: bReachedLock }] as TResult;
    },
  };
  return {
    observer,
    a,
    b,
    target: "ReservationApplicationSubmission",
    left: expectedLock,
    right: expectedLock,
    transactionOptions: { maxWait: 10_000, timeout: 20_000 },
    deadlineMs: 100,
    pollMs: 1,
    ...overrides,
  };
}

describe("Phase 20 PostgreSQL race barrier", () => {
  it("releases A only after observing B waiting and returns both settled results", async () => {
    const result = await runPhase20PostgresRace(input());
    expect(result.map((entry) => entry.status)).toEqual(["fulfilled", "fulfilled"]);
  });

  it("fails with a fixed code when A rejects before its expected lock", async () => {
    const race = runPhase20PostgresRace(input({ left: async () => Promise.reject(new Error("internal failure")) }));
    await expect(race).rejects.toMatchObject({ code: "PHASE20_RACE_A_LOCK_UNAVAILABLE" } satisfies Partial<Phase20RaceBarrierError>);
  });

  it("fails with a fixed code when A completes without the selected lock query", async () => {
    await expect(runPhase20PostgresRace(input({ left: unrelatedQuery }))).rejects.toMatchObject({ code: "PHASE20_RACE_A_LOCK_UNAVAILABLE" } satisfies Partial<Phase20RaceBarrierError>);
  });

  it("fails with a fixed code when B cannot publish its transaction PID", async () => {
    let aFinished = false;
    const brokenB = fakeClient({ pid: 22, failPid: true });
    const left = async (client: Phase20RaceTransactionAdapter) => { await expectedLock(client); aFinished = true; };
    await expect(runPhase20PostgresRace(input({ b: brokenB, left }))).rejects.toMatchObject({ code: "PHASE20_RACE_B_PID_UNAVAILABLE" } satisfies Partial<Phase20RaceBarrierError>);
    expect(aFinished).toBe(true);
  });

  it("times out with a fixed code when the observer never sees B waiting", async () => {
    const observer: Phase20RaceObserver = { async $queryRaw<TResult>(): Promise<TResult> { return [{ waiting: false }] as TResult; } };
    await expect(runPhase20PostgresRace(input({ observer, deadlineMs: 20, pollMs: 1 }))).rejects.toMatchObject({ code: "PHASE20_RACE_EXPECTED_WAIT_TIMEOUT" } satisfies Partial<Phase20RaceBarrierError>);
  });

  it("releases A and settles both transactions when the observer fails", async () => {
    let aFinished = false;
    let bFinished = false;
    const observer: Phase20RaceObserver = { async $queryRaw(): Promise<never> { throw new Error("observer unavailable"); } };
    const left = async (client: Phase20RaceTransactionAdapter) => { await expectedLock(client); aFinished = true; };
    const right = async (client: Phase20RaceTransactionAdapter) => { await expectedLock(client); bFinished = true; };
    await expect(runPhase20PostgresRace(input({ observer, left, right }))).rejects.toMatchObject({ code: "PHASE20_RACE_OBSERVER_FAILED" } satisfies Partial<Phase20RaceBarrierError>);
    expect(aFinished).toBe(true);
    expect(bFinished).toBe(true);
  });

  it("keeps release state local across consecutive races", async () => {
    const run = vi.fn(async (client: Phase20RaceTransactionAdapter) => expectedLock(client));
    await expect(runPhase20PostgresRace(input({ left: run, right: run }))).resolves.toHaveLength(2);
    await expect(runPhase20PostgresRace(input({ left: run, right: run }))).resolves.toHaveLength(2);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("recognizes a Prisma.Sql retention lock without reading its values", async () => {
    await expect(runPhase20PostgresRace(input({ left: prismaSqlLock, right: prismaSqlLock }))).resolves.toHaveLength(2);
  });
});
