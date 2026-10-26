import { Prisma } from "@prisma/client";
import type { submitApplicationGroupCore } from "@/server/reservation-applications/groups";

type Row = Record<string, unknown> & { id: string };
type Table = "submissions" | "applications" | "devices" | "deviceSubmissions" | "companionMembers" | "outbox";
type State = Record<Table, Row[]>;
type Write = { table: Table; row: Row };
const emptyState = (): State => ({ submissions: [], applications: [], devices: [], deviceSubmissions: [], companionMembers: [], outbox: [] });

export const operation = "00000000-0000-4000-8000-000000000002";
export const submissionId = `phase8_${operation}`;
export const now = new Date("2030-01-02T03:04:05.678Z");
export const syntheticPrice = 7654321;
export const scheduleId = "synthetic-class";

function sqlParts(query: Prisma.Sql | TemplateStringsArray, values: unknown[]) {
  if (Array.isArray(query)) return { text: query.join("?"), values };
  const sql = query as Prisma.Sql;
  return { text: sql.sql, values: sql.values as unknown[] };
}

/**
 * Only the fresh group/companion path without previous-device grants is modeled.
 * The actual core, locks, Zod validation and writes execute. No Prisma client is
 * constructed; unsupported operations/SQL fail rather than silently succeeding.
 * This is rollback simulation, not evidence of real PostgreSQL atomicity.
 */
export class SubmissionTransactionFixture {
  committed = emptyState();
  attempted: Write[] = [];
  outboxChecks = 0;
  outboxInserts = 0;
  options: unknown;
  failApplicationAt?: number;
  insertError?: Error;
  queryError?: Error;
  beforeCommit?: (pending: State) => void;

  async transaction<T>(callback: (tx: ReturnType<SubmissionTransactionFixture["makeTx"]>) => Promise<T>, options?: unknown): Promise<T> {
    const pending = structuredClone(this.committed);
    this.attempted = [];
    this.options = options;
    // A throw discards pending, including every earlier model/raw write.
    const result = await callback(this.makeTx(pending));
    this.beforeCommit?.(pending);
    this.committed = pending;
    return result;
  }

  private makeTx(pending: State) {
    const schedule = { id: scheduleId, status: "SCHEDULED", startsAt: new Date(now.getTime() + 86_400_000), applicationPrice: syntheticPrice };
    const group = { id: "synthetic-group", isActive: true, syntheticRunId: null, classes: [{ classSchedule: schedule }] };
    const write = (table: Table, data: Record<string, unknown>): Row => {
      const row = structuredClone({ ...data, id: typeof data.id === "string" ? data.id : `synthetic-${table}-${pending[table].length + 1}` });
      if (pending[table].some((old) => old.id === row.id)) throw new Error(`synthetic-primary-key-${table}`);
      pending[table].push(row);
      this.attempted.push({ table, row: structuredClone(row) });
      return row;
    };
    return {
      $queryRaw: async <T = unknown>(query: Prisma.Sql | TemplateStringsArray, ...values: unknown[]): Promise<T> => {
        const sql = sqlParts(query, values);
        const text = sql.text.replace(/\s+/g, " ").trim();
        let rows: Array<{ id: string }>;
        if (text === 'SELECT "id" FROM "NotificationOutbox" WHERE "dedupeKey" = ?') {
          this.outboxChecks++;
          if (this.queryError) throw this.queryError;
          rows = pending.outbox.filter((row) => row.dedupeKey === sql.values[0]).map(({ id }) => ({ id }));
        } else if (text === 'SELECT "id" FROM "ReservationApplicationGroup" WHERE "id" = ? FOR UPDATE') {
          if (sql.values[0] !== group.id) throw new Error("Unexpected group lock");
          rows = [{ id: group.id }];
        } else if (text === 'SELECT "id" FROM "ReservationApplicationLink" WHERE "id" = ? FOR UPDATE') {
          if (sql.values[0] !== "synthetic-link") throw new Error("Unexpected link lock");
          rows = [{ id: "synthetic-link" }];
        } else if (text === 'SELECT "id" FROM "CompanionInvite" WHERE "id" = ? FOR UPDATE') {
          if (sql.values[0] !== "synthetic-invite") throw new Error("Unexpected invite lock");
          rows = [{ id: "synthetic-invite" }];
        } else if (text === 'SELECT "id" FROM "ClassSchedule" WHERE "id" IN (?) ORDER BY "id" FOR UPDATE') {
          const ids = (sql.values[0] as Prisma.Sql).values;
          if (ids.length !== 1 || ids[0] !== scheduleId) throw new Error("Unexpected schedule lock");
          rows = [{ id: scheduleId }];
        } else {
          throw new Error("Unexpected raw query in submission fixture");
        }
        return rows as unknown as T;
      },
      $executeRaw: async (query: Prisma.Sql): Promise<number> => {
        const match = /INSERT INTO "NotificationOutbox"\s*\(([\s\S]*?)\)\s*VALUES/.exec(query.sql);
        if (!match) throw new Error("Unexpected raw write in submission fixture");
        this.outboxInserts++;
        if (this.insertError) throw this.insertError;
        const columns = [...match[1].matchAll(/"(\w+)"/g)].map((item) => item[1]);
        if (columns.length !== query.values.length) throw new Error("Outbox columns/parameters mismatch");
        const data = Object.fromEntries(columns.map((column, index) => [column, query.values[index]]));
        if (pending.outbox.some((row) => row.dedupeKey === data.dedupeKey)) throw new Error("synthetic-outbox-unique-dedupeKey");
        write("outbox", data);
        return 1;
      },
      reservationApplicationLink: {
        findUnique: async () => ({ id: "synthetic-link", isActive: true, group }),
      },
      companionInvite: {
        findFirst: async () => ({ id: "synthetic-invite", companionGroupId: "synthetic-companion-group", group }),
      },
      reservationApplicationGroupClass: {
        findMany: async () => [{ classScheduleId: scheduleId }],
      },
      classSchedule: {
        findMany: async () => [schedule],
      },
      reservationApplicationSubmission: {
        findUnique: async ({ where }: { where: { id: string } }) => pending.submissions.find((row) => row.id === where.id) ?? null,
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: write("submissions", data).id }),
      },
      applicationDevice: {
        create: async ({ data }: { data: Record<string, unknown> }) => ({ id: write("devices", data).id }),
      },
      deviceSubmission: {
        create: async ({ data }: { data: Record<string, unknown> }) => write("deviceSubmissions", data),
      },
      companionGroupMember: {
        create: async ({ data }: { data: Record<string, unknown> }) => write("companionMembers", data),
      },
      reservationApplication: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          if (pending.applications.length + 1 === this.failApplicationAt) throw new Error("synthetic-application-write-failed");
          return { id: write("applications", data).id };
        },
      },
    };
  }

  client(): Parameters<typeof submitApplicationGroupCore>[0] {
    // The generated Prisma surface is much larger than this intentionally strict
    // fake. This single boundary cast leaves unsupported operations unavailable.
    return { $transaction: this.transaction.bind(this) } as unknown as Parameters<typeof submitApplicationGroupCore>[0];
  }
}
