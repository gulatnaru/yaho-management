/** In-memory Prisma-shaped test adapter. NEVER imports a generated/real Prisma client.
 * search_path is a simulation, not PostgreSQL ACL or pooler verification.
 */
export type MockSession = {
  hash: string; csrfHash: string; scope: "OPERATOR" | "RESERVATION";
  runId: string; classId?: string; applicationId?: string; applicationIds?: string[]; expiresAt: number; revoked: boolean;
};
export type MockGrant = { hash: string; runId: string; classId: string; expiresAt: number; consumed: boolean };
export type MockClass = {
  id: string; capacity: number; teacherIds: string[]; quotedAmount: number;
  startsAt: number; endsAt: number; status: "SCHEDULED" | "CANCELLED";
  cancelledAt?: number; cancellationReason?: "SYNTHETIC_OPERATOR_CANCELLATION";
};
export type MockApplication = {
  id: string; classId: string; childId: string; quotedAmount: number;
  status: "PENDING" | "CONFIRMED" | "CANCELLED"; reservationId?: string;
  cancelledAt?: number; cancellationReason?: "SYNTHETIC_OPERATOR_CANCELLATION";
};
export type MockReservation = {
  id: string; applicationId: string; classId: string; childId: string;
  status: "RESERVED" | "CANCELLED" | "NO_SHOW"; attendance?: "PRESENT" | "ABSENT";
  cancelledAt?: number; cancellationReason?: "SYNTHETIC_OPERATOR_CANCELLATION";
};
export type MockPayment = {
  id: string; reservationId: string; amount: number; refundedAmount: number;
  status: "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";
};
export type MockData = {
  children: Record<string, { id: string; active: boolean }>;
  classes: Record<string, MockClass>; applications: Record<string, MockApplication>;
  deposits: { id: string; applicationId: string; amount: number }[];
  reservations: Record<string, MockReservation>; payments: Record<string, MockPayment>;
  refunds: { id: string; paymentId: string; amount: number; reason: string; detail?: string }[];
};
export type MockRun = {
  id: string; mode: "MOCK_ONLY"; status: "ACTIVE" | "CLOSED" | "CLEANED"; expiresAt: number;
  sessions: Record<string, MockSession>; grants: Record<string, MockGrant>;
  cleanup?: { hash: string; csrfHash: string; expiresAt: number };
  receipts: Record<string, { payload: string; result: unknown }>;
  data: MockData;
};

export function emptyMockData(): MockData {
  return { children: {}, classes: {}, applications: {}, deposits: [], reservations: {}, payments: {}, refunds: [] };
}

export class MockManualTestTransaction {
  private active = true;
  private searchPath: string | undefined;
  constructor(private readonly state: MockRun) {
    this.setLocalSearchPath("manual_test");
    this.verifySearchPath();
  }
  get run(): MockRun { this.verifySearchPath(); return this.state; }
  setLocalSearchPath(path: string) {
    if (!this.active || path !== "manual_test") throw new Error("MOCK_SCHEMA_DENIED");
    this.searchPath = path;
  }
  verifySearchPath() {
    if (!this.active || this.searchPath !== "manual_test") throw new Error("MOCK_TRANSACTION_CLOSED");
    return "manual_test" as const;
  }
  finish() { this.active = false; this.searchPath = undefined; }
}

export class MockManualTestPrisma {
  readonly mode = "MOCK_ONLY" as const;
  private readonly runs = new Map<string, MockRun>();
  private tail: Promise<void> = Promise.resolve();

  // One mock process serializes all transactions; production database locking is not simulated faithfully.
  private async exclusive<T>(operation: () => Promise<T> | T): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async createRun(run: MockRun): Promise<void> {
    await this.exclusive(() => {
      if (this.runs.has(run.id)) throw new Error("MOCK_RUN_EXISTS");
      this.runs.set(run.id, structuredClone(run));
    });
  }

  async $transaction<T>(runId: string, operation: (tx: MockManualTestTransaction) => Promise<T> | T): Promise<T> {
    return this.exclusive(async () => {
      const existing = this.runs.get(runId);
      if (!existing) throw new Error("MOCK_RUN_UNAVAILABLE");
      const draft = structuredClone(existing);
      const tx = new MockManualTestTransaction(draft);
      try {
        const result = await operation(tx);
        tx.verifySearchPath();
        if (draft.id !== runId || draft.mode !== "MOCK_ONLY") throw new Error("MOCK_RUN_BINDING");
        const detachedResult = structuredClone(result);
        this.runs.set(runId, structuredClone(draft));
        return detachedResult;
      } finally { tx.finish(); }
    });
  }
}
