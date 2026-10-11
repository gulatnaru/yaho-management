export type Phase20RaceTransactionOptions = { maxWait: number; timeout: number };

export type Phase20RaceSql = TemplateStringsArray | { strings: readonly string[] };

export type Phase20RaceTransaction = {
  $queryRaw<T>(query: Phase20RaceSql, ...values: unknown[]): Promise<T>;
};

export type Phase20RaceTransactionAdapter = {
  $transaction<T>(callback: (tx: Phase20RaceTransaction) => Promise<T>, options?: Phase20RaceTransactionOptions): Promise<T>;
};

export type Phase20RaceObserver = {
  $queryRaw<T>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

export type Phase20RaceBarrierCode =
  | "PHASE20_RACE_A_LOCK_UNAVAILABLE"
  | "PHASE20_RACE_B_PID_UNAVAILABLE"
  | "PHASE20_RACE_EXPECTED_WAIT_TIMEOUT"
  | "PHASE20_RACE_OBSERVER_FAILED";

export class Phase20RaceBarrierError extends Error {
  constructor(public readonly code: Phase20RaceBarrierCode) {
    super(code);
    this.name = "Phase20RaceBarrierError";
  }
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>((done) => { resolve = done; }), resolve };
}

function remaining(deadline: number) {
  return Math.max(0, deadline - Date.now());
}

function sleep(ms: number) {
  return new Promise<void>((done) => setTimeout(done, ms));
}

async function first<T>(promise: Promise<T>, deadline: number): Promise<T | undefined> {
  const wait = remaining(deadline);
  if (wait === 0) {
    void promise.catch(() => undefined);
    return undefined;
  }
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<undefined>((done) => { timeout = setTimeout(() => done(undefined), wait); }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function queryText(query: Phase20RaceSql) {
  return "strings" in query ? query.strings.join("?") : query.join("?");
}

function isExpectedLock(query: Phase20RaceSql, target: string) {
  const text = queryText(query);
  return text.includes(target) && (text.includes("FOR UPDATE") || text.includes("pg_advisory_xact_lock"));
}

type BarrierGate = {
  firstLock: Deferred<void>;
  pid: Deferred<number>;
  paused: boolean;
};

function createGate(): BarrierGate {
  return { firstLock: deferred<void>(), pid: deferred<number>(), paused: false };
}

export type Phase20RaceBarrierInput = {
  observer: Phase20RaceObserver;
  a: Phase20RaceTransactionAdapter;
  b: Phase20RaceTransactionAdapter;
  target: string;
  left: (client: Phase20RaceTransactionAdapter) => Promise<unknown>;
  right: (client: Phase20RaceTransactionAdapter) => Promise<unknown>;
  transactionOptions: Phase20RaceTransactionOptions;
  deadlineMs?: number;
  pollMs?: number;
};

export async function runPhase20PostgresRace({
  observer,
  a,
  b,
  target,
  left,
  right,
  transactionOptions,
  deadlineMs = 8_000,
  pollMs = 40,
}: Phase20RaceBarrierInput): Promise<PromiseSettledResult<unknown>[]> {
  const deadline = Date.now() + deadlineMs;
  const aGate = createGate();
  const bGate = createGate();
  const releaseA = deferred<void>();
  let bStarted = false;

  const adapter = (client: Phase20RaceTransactionAdapter, gate: BarrierGate, hold: boolean): Phase20RaceTransactionAdapter => ({
    $transaction: async <T>(callback: (tx: Phase20RaceTransaction) => Promise<T>, options = transactionOptions) => client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      const row = rows[0];
      if (!row) throw new Phase20RaceBarrierError(hold ? "PHASE20_RACE_A_LOCK_UNAVAILABLE" : "PHASE20_RACE_B_PID_UNAVAILABLE");
      gate.pid.resolve(row.pid);
      const proxy = new Proxy(tx, {
        get(source, property, receiver) {
          if (property !== "$queryRaw") return Reflect.get(source, property, receiver);
          return async <TResult>(query: Phase20RaceSql, ...values: unknown[]): Promise<TResult> => {
            const result = await source.$queryRaw<TResult>(query, ...values);
            if (hold && !gate.paused && isExpectedLock(query, target)) {
              gate.paused = true;
              gate.firstLock.resolve();
              await releaseA.promise;
            }
            return result;
          };
        },
      }) as Phase20RaceTransaction;
      return callback(proxy);
    }, options),
  });

  const aPromise = Promise.resolve().then(() => left(adapter(a, aGate, true)));
  const aSettled = aPromise.then(() => "settled" as const, () => "settled" as const);
  let bPromise: Promise<unknown> | undefined;
  let bSettled: Promise<"settled"> | undefined;
  let failure: Phase20RaceBarrierError | undefined;

  try {
    const aState = await first(Promise.race([aGate.firstLock.promise.then(() => "locked" as const), aSettled]), deadline);
    if (aState !== "locked") throw new Phase20RaceBarrierError("PHASE20_RACE_A_LOCK_UNAVAILABLE");

    bStarted = true;
    bPromise = Promise.resolve().then(() => right(adapter(b, bGate, false)));
    bSettled = bPromise.then(() => "settled" as const, () => "settled" as const);
    const bState = await first(Promise.race([
      bGate.pid.promise.then((pid) => ({ kind: "pid" as const, pid })),
      bSettled.then(() => ({ kind: "settled" as const })),
    ]), deadline);
    if (bState?.kind !== "pid") throw new Phase20RaceBarrierError("PHASE20_RACE_B_PID_UNAVAILABLE");
    const bPid = bState.pid;

    let observedWait = false;
    while (remaining(deadline) > 0) {
      let rows: { waiting: boolean }[] | undefined;
      try {
        rows = await first(observer.$queryRaw<{ waiting: boolean }[]>`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${bPid}`, deadline);
      } catch {
        throw new Phase20RaceBarrierError("PHASE20_RACE_OBSERVER_FAILED");
      }
      if (!rows) break;
      if (rows[0]?.waiting) {
        observedWait = true;
        break;
      }
      await sleep(Math.min(pollMs, remaining(deadline)));
    }
    if (!observedWait) throw new Phase20RaceBarrierError("PHASE20_RACE_EXPECTED_WAIT_TIMEOUT");
  } catch (error) {
    failure = error instanceof Phase20RaceBarrierError
      ? error
      : new Phase20RaceBarrierError("PHASE20_RACE_OBSERVER_FAILED");
  } finally {
    releaseA.resolve();
  }

  const settledResults = await Promise.allSettled(bStarted && bPromise ? [aPromise, bPromise] : [aPromise]);
  if (failure) throw failure;
  return settledResults;
}
