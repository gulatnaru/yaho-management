import { describe, expect, it } from "vitest";
import { hydrateManualRun, type ManualSqlClient } from "@/server/manual-test/persistence";

type Row = Record<string, unknown>;

// Fake ManualSqlClient routing canned rows by the table name in the SQL text.
function fakeClient(tables: Record<string, Row[]>): ManualSqlClient {
  const queryRaw = async (query: unknown): Promise<Row[]> => {
    const sql = typeof query === "object" && query !== null ? String((query as { sql?: unknown }).sql ?? "") : "";
    const table = /"manual_test"\."([A-Za-z]+)"/.exec(sql)?.[1];
    if (!table) throw new Error(`unexpected query: ${sql.slice(0, 80)}`);
    return tables[table] ?? [];
  };
  return {
    $queryRaw: queryRaw as unknown as ManualSqlClient["$queryRaw"],
    $executeRaw: (async () => 0) as unknown as ManualSqlClient["$executeRaw"],
  };
}

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const APP_ID = "22222222-2222-4222-8222-222222222222";
const APP2_ID = "33333333-3333-4333-8333-333333333333";
const SUBMISSION = `${RUN_ID}:submission:sessionhash`;

function rootRow(): Row {
  return { id: RUN_ID, status: "ACTIVE", expiresAt: new Date("2030-01-01T00:00:00Z") };
}
function applicationRow(id: string): Row {
  return {
    id, classScheduleId: "class-1", submissionId: SUBMISSION,
    requestedChildId: `${RUN_ID}:child-1`, quotedAmount: 10000, status: "SUBMITTED",
  };
}
function depositRow(id: string): Row {
  return { id, submissionId: SUBMISSION, amount: 10000 };
}

describe("hydrateManualRun deposits", () => {
  it("recovers the deposit applicationId when the submission carries one application", async () => {
    const run = await hydrateManualRun(
      fakeClient({
        ReservationApplication: [applicationRow(APP_ID)],
        ApplicationDeposit: [depositRow("d1"), depositRow("d2")],
      }),
      rootRow(),
    );
    expect(run.data.deposits).toHaveLength(2);
    for (const deposit of run.data.deposits) expect(deposit.applicationId).toBe(APP_ID);
  });

  it("fails closed instead of crediting the wrong application on multi-application submissions", async () => {
    const run = await hydrateManualRun(
      fakeClient({
        ReservationApplication: [applicationRow(APP_ID), applicationRow(APP2_ID)],
        ApplicationDeposit: [depositRow("d1")],
      }),
      rootRow(),
    );
    expect(run.data.deposits).toHaveLength(1);
    // Not attributable: keeps the submission id so deposited() finds nothing
    // rather than crediting an arbitrary application.
    expect(run.data.deposits[0]?.applicationId).toBe(SUBMISSION);
    expect(run.data.deposits[0]?.applicationId).not.toBe(APP_ID);
    expect(run.data.deposits[0]?.applicationId).not.toBe(APP2_ID);
  });
});
