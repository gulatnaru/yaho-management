import { z } from "zod";
import { isDeepStrictEqual } from "node:util";

export const WARMUPS = 5;
export const REPETITIONS = 30;
export const SCENARIOS = ["NORMAL", "SUBSET", "FRAGMENTED", "RETURN-HOLD", "SAME-SUBMISSION RACE", "INSUFFICIENT", "HELD-FUNDS INSUFFICIENT", "DUPLICATE UNPAID", "DUPLICATE PAID"] as const;
export const INVARIANTS = ["LEDGER", "AVAILABLE_BACKING", "EXACT_LINKAGE", "SELECTION_ISOLATION", "FIXED_QUOTES", "NO_RECONFIRMATION", "HELD_FUNDS", "CHILD_STATE", "CONSENT_APPEND", "DEVICE_SCOPE", "NO_REFUND", "ROLLBACK_STATE", "FIFO", "RACE_SINGLE_WINNER"] as const;
export type Invariant = typeof INVARIANTS[number];
export const FAILURE_CODES = ["OPT_IN_REQUIRED", "LOCAL_ONLY", "UNSAFE_DATABASE", "DATABASE_UNAVAILABLE", "SERVER_IDENTITY", "MIGRATIONS", "COMPETING_WORKLOAD", "SOURCE_IDENTITY", "CALIBRATION", "ATTRIBUTION", "LATE_EVENT", "CLIENT_BUSY", "WRONG_OUTCOME", "ASSERTION_MISSING", "CLEANUP", "PRIVACY", "PROTOCOL", "STARTUP", "SETUP", "UNKNOWN_INFRASTRUCTURE", "INCOMPLETE", ...INVARIANTS] as const;
export type FailureCode = typeof FAILURE_CODES[number];
export class SafeFailure extends Error {
  constructor(readonly code: FailureCode, readonly diagnostic?: AttributionDiagnostic) { super(code); this.name = "OBS01_SAFE_FAILURE"; }
}
export function requireFact(value: unknown, code: FailureCode): asserts value { if (!value) throw new SafeFailure(code); }
export function failureCode(value: unknown): FailureCode { return value instanceof SafeFailure ? value.code : "UNKNOWN_INFRASTRUCTURE"; }
export const OUTCOMES = ["SUCCESS", "ApplicationNotPendingError", "InsufficientApplicationDepositError", "DuplicateReservationError", "ApplicationPaymentAlreadyExistsError", "UNKNOWN_INFRASTRUCTURE"] as const;
export type Outcome = typeof OUTCOMES[number];
const count = z.number().int().min(0).max(100_000_000);
export const attributionDiagnosticSchema = z.object({
  stage: z.enum(["BOOTSTRAP", "SESSION", "MODEL", "SELECT", "COMMIT", "ROLLBACK", "CONCURRENT", "ASYMMETRIC", "SAMPLE", "IDLE", "DISCONNECT"]),
  client: z.enum(["A", "B", "PAIR"]),
  condition: z.enum(["MISSING", "EXTRA", "LATE", "IDLE", "SESSION", "WORK", "COUNT", "UNSTABLE", "UNPROVEN", "MODEL_EXPIRED", "FENCE_ORDER", "FENCE_OUTCOME", "PROBE_MISSING", "PROBE_EXTRA", "PROBE_CLIENT"]),
  repetition: count.max(3), expected: count, observed: count, late: count,
}).strict();
export type AttributionDiagnostic = z.infer<typeof attributionDiagnosticSchema>;
export type AttributionContext = Pick<AttributionDiagnostic, "stage" | "client" | "repetition">;
export function attributionFailure(context: AttributionContext, condition: AttributionDiagnostic["condition"], expected: number, observed: number, late = 0): SafeFailure {
  return new SafeFailure("ATTRIBUTION", { ...context, condition, expected, observed, late });
}
const finite = z.number().finite().min(0).max(1_000_000_000);
export const cellSchema = z.object({
  scenario: z.enum(SCENARIOS), n: z.union([z.literal(2), z.literal(4), z.literal(8)]), selected: z.number().int().min(1).max(8),
  mode: z.enum(["NEW", "EXISTING"]), device: z.enum(["ONE", "NONE"]), consent: z.enum(["NONE", "PRIOR_OPTIONAL_AGREED"]),
  deposit: z.enum(["EXACT", "ALL_QUOTES", "FRAGMENTED", "MINUS_ONE"]), hold: z.enum(["NONE", "FUNDED", "PARTIAL_RETURN"]),
  expected: z.enum(OUTCOMES),
}).strict();
export type Cell = z.infer<typeof cellSchema>;
export const CELLS: Cell[] = SCENARIOS.flatMap((scenario) => ([2, 4, 8] as const).flatMap((n) =>
  (["NEW", "EXISTING"] as const).filter((mode) => !scenario.startsWith("DUPLICATE") || mode === "EXISTING").flatMap((mode) =>
    (scenario === "NORMAL" && n === 2 ? ["ONE", "NONE"] as const : ["ONE"] as const).map((device): Cell => ({
      scenario, n, mode, device, selected: ["SUBSET", "RETURN-HOLD", "HELD-FUNDS INSUFFICIENT"].includes(scenario) ? n - 1 : n,
      consent: mode === "EXISTING" ? "PRIOR_OPTIONAL_AGREED" : "NONE",
      deposit: scenario === "FRAGMENTED" ? "FRAGMENTED" : scenario.includes("INSUFFICIENT") ? "MINUS_ONE" : ["SUBSET", "RETURN-HOLD"].includes(scenario) ? "ALL_QUOTES" : "EXACT",
      hold: scenario === "RETURN-HOLD" ? "PARTIAL_RETURN" : scenario === "HELD-FUNDS INSUFFICIENT" ? "FUNDED" : "NONE",
      expected: scenario.includes("INSUFFICIENT") ? "InsufficientApplicationDepositError" : scenario === "DUPLICATE UNPAID" ? "DuplicateReservationError" : scenario === "DUPLICATE PAID" ? "ApplicationPaymentAlreadyExistsError" : "SUCCESS",
    })) )));
export const counterSchema = z.object({ expected: count, executed: count, pass: count, fail: count }).strict();
export type Counter = z.infer<typeof counterSchema>;
export const emptyCounter = (): Counter => ({ expected: 0, executed: 0, pass: 0, fail: 0 });
export const codeCountersSchema = z.object(Object.fromEntries(INVARIANTS.map((code) => [code, counterSchema])) as Record<Invariant, typeof counterSchema>).strict();
export type CodeCounters = Record<Invariant, Counter>;
export const emptyCodes = (): CodeCounters => Object.fromEntries(INVARIANTS.map((code) => [code, emptyCounter()])) as CodeCounters;
export function addCodes(target: CodeCounters, source: CodeCounters): void {
  for (const code of INVARIANTS) for (const key of ["expected", "executed", "pass", "fail"] as const) target[code][key] += source[code][key];
}
export function totalCodes(codes: CodeCounters): Counter { const total = emptyCounter(); for (const code of INVARIANTS) for (const key of ["expected", "executed", "pass", "fail"] as const) total[key] += codes[code][key]; return total; }
export const distributionSchema = z.object({ min: finite, p50: finite, p95: finite, max: finite }).strict();
export type Distribution = z.infer<typeof distributionSchema>;
export function distribution(values: readonly number[]): Distribution | null {
  if (values.length !== REPETITIONS || values.some((v) => !Number.isFinite(v) || v < 0)) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return { min: sorted[0]!, p50: sorted[Math.ceil(sorted.length * .5) - 1]!, p95: sorted[Math.ceil(sorted.length * .95) - 1]!, max: sorted.at(-1)! };
}
const statusSchema = z.enum(["COMPLETE", "NOT RUN", "INCOMPLETE", "INVALID"]);
export const rowSchema = z.object({
  cell: cellSchema, metric: z.enum(["CALL", "WINNER", "LOSER", "PAIR"]), outcome: z.enum(OUTCOMES), status: statusSchema,
  warmups: count.max(5), attempted: count.max(30), settled: count.max(30), valid: count.max(30), fulfilled: count.max(30), rejected: count.max(30),
  wall: distributionSchema.nullable(), queries: distributionSchema.nullable(), effects: z.enum(["COMMIT", "ROLLBACK", "SINGLE_COMMIT"]),
  invariantScope: z.enum(["SAMPLE", "PAIR", "SHARED_PAIR"]), warmupInvariants: codeCountersSchema, measuredInvariants: codeCountersSchema,
  cleanup: z.enum(["PASS", "FAIL", "UNKNOWN"]), failures: z.array(z.object({ code: z.enum(FAILURE_CODES), count }).strict()).max(64),
}).strict();
export type AggregateRow = z.infer<typeof rowSchema>;
export function newRow(cell: Cell, metric: AggregateRow["metric"] = "CALL"): AggregateRow {
  return { cell, metric, outcome: metric === "LOSER" ? "ApplicationNotPendingError" : cell.expected, status: "NOT RUN", warmups: 0, attempted: 0, settled: 0, valid: 0, fulfilled: 0, rejected: 0, wall: null, queries: null, effects: cell.scenario === "SAME-SUBMISSION RACE" ? "SINGLE_COMMIT" : cell.expected === "SUCCESS" ? "COMMIT" : "ROLLBACK", invariantScope: metric === "PAIR" ? "PAIR" : metric === "WINNER" || metric === "LOSER" ? "SHARED_PAIR" : "SAMPLE", warmupInvariants: emptyCodes(), measuredInvariants: emptyCodes(), cleanup: "UNKNOWN", failures: [] };
}
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const version = z.string().regex(/^\d+(?:\.\d+){0,3}(?:-\d+)?$/);
const na = z.literal("N/A");
export const environmentSchema = z.object({
  auditedSourceSha: sha, prHeadSha: sha.or(na), checkedOutSha: sha, checkoutMode: z.enum(["HEAD", "MERGE_REF"]), dirty: z.boolean(), harnessDigest: digest,
  route: z.enum(["LOCAL", "A2"]), ciRunId: z.string().regex(/^\d+$/).or(na), ciAttempt: z.string().regex(/^\d+$/).or(na), integrationSha: sha.or(na),
  runnerClass: z.enum(["LOCAL", "GITHUB_STANDARD"]), os: z.enum(["linux", "darwin", "win32"]), osRelease: z.string().regex(/^[0-9][0-9A-Za-z.\-+]{0,99}$/),
  image: z.string().regex(/^ubuntu\d{2,4}$/).or(na), imageVersion: z.string().regex(/^\d+(?:\.\d+){0,4}$/).or(na),
  cpuModel: z.enum(["INTEL_XEON", "INTEL_CORE", "AMD_EPYC", "AMD_RYZEN", "APPLE", "OTHER"]), cpuModelNumber: z.string().regex(/^(?:[0-9][0-9A-Z]{2,7}|N\/A)$/), cpuCount: count.min(1), memoryGiB: finite,
  node: version, prismaCli: version, prismaClient: version, postgres: version.or(na), migrationRevision: digest, migrationVerified: z.boolean(),
  databaseVerified: z.boolean(), independentSessions: z.boolean(), quota: z.enum(["UNVERIFIED", "VERIFIED_EXTERNALLY"]),
  poolCount: z.literal(3), connectionLimit: z.literal(1), poolTimeoutSeconds: z.literal(10), maxWaitMs: z.literal(10000), transactionTimeoutMs: z.literal(20000),
  setupClients: z.literal(1), measuredClients: z.literal(2), warmups: z.literal(5), repetitions: z.literal(30), plannedCells: z.literal(50), profileRevision: z.literal(1),
}).strict();
export type Environment = z.infer<typeof environmentSchema>;
export const calibrationSchema = z.object({ client: z.enum(["A", "B"]), kind: z.enum(["SELECT", "COMMIT", "ROLLBACK", "INDEPENDENT"]), explicit: count.min(1), repetitions: z.literal(3), eventMin: count, eventMax: count, verified: z.boolean(), attribution: z.boolean(), lateEvents: count }).strict();
export type Calibration = z.infer<typeof calibrationSchema>;
export const reportSchema = z.object({
  protocol: z.literal("OBS01_V1"), status: statusSchema, primaryCountsKnown: z.boolean(), started: z.string().datetime(), finished: z.string().datetime(), environment: environmentSchema.nullable(),
  bootstrapObserved: z.object({ A: count, B: count }).strict().nullable(),
  calibration: z.array(calibrationSchema).max(8), rows: z.array(rowSchema).max(62), selfChecks: count, selfCheckInvariants: codeCountersSchema,
  cleanup: z.enum(["PASS", "FAIL", "UNKNOWN"]), failure: z.enum(FAILURE_CODES).nullable(), attributionDiagnostic: attributionDiagnosticSchema.nullable(),
}).strict().superRefine((report, ctx) => {
  const invalid = () => ctx.addIssue({ code: "custom", message: "PROTOCOL" });
  if (report.attributionDiagnostic !== null && report.failure !== "ATTRIBUTION") invalid();
  if (report.rows.length !== 62 || report.rows.some((row) => row.status !== "COMPLETE" && (row.wall !== null || row.queries !== null))) ctx.addIssue({ code: "custom", message: "PROTOCOL" });
  const planned = initialRows();
  if (report.status === "NOT RUN" && (!report.primaryCountsKnown || report.rows.some((row) => row.attempted > 0 || row.warmups > 0 || row.status !== "NOT RUN"))) invalid();
  if (report.rows.some((row, index) => { const p = planned[index]; return !p || !isDeepStrictEqual(row.cell, p.cell) || row.metric !== p.metric || row.outcome !== p.outcome || row.effects !== p.effects || row.invariantScope !== p.invariantScope; })) invalid();
  for (const row of report.rows) {
    if (row.valid > row.settled || row.settled > row.attempted || row.fulfilled + row.rejected !== row.settled * (row.metric === "PAIR" ? 2 : 1)) invalid();
    if (row.metric === "PAIR" && row.queries !== null) invalid();
    if (row.queries && Object.values(row.queries).some((v) => !Number.isInteger(v))) invalid();
    for (const d of [row.wall, row.queries]) if (d && !(d.min <= d.p50 && d.p50 <= d.p95 && d.p95 <= d.max)) invalid();
    if (row.status === "COMPLETE") {
      if (row.warmups !== 5 || row.attempted !== 30 || row.settled !== 30 || row.valid !== 30 || row.cleanup !== "PASS" || row.failures.length || !row.wall || (row.metric !== "PAIR" && !row.queries)) invalid();
      const shouldFulfill = row.metric === "PAIR" || row.outcome === "SUCCESS";
      const shouldReject = row.metric === "PAIR" || row.outcome !== "SUCCESS";
      if (row.fulfilled !== (shouldFulfill ? 30 : 0) || row.rejected !== (shouldReject ? 30 : 0)) invalid();
      for (const phase of ["warmupInvariants", "measuredInvariants"] as const) {
        const totals = totalCodes(row[phase]);
        if (row.invariantScope === "SHARED_PAIR" ? totals.expected !== 0 : totals.expected === 0) invalid();
        const applicable: Invariant[] = ["LEDGER", "AVAILABLE_BACKING", "SELECTION_ISOLATION", "FIXED_QUOTES", "HELD_FUNDS", "CHILD_STATE", "CONSENT_APPEND", "DEVICE_SCOPE", "NO_REFUND", ...(row.cell.expected === "SUCCESS" ? ["EXACT_LINKAGE", "NO_RECONFIRMATION", "FIFO"] as const : ["ROLLBACK_STATE"] as const), ...(row.metric === "PAIR" ? ["RACE_SINGLE_WINNER"] as const : [])];
        for (const code of INVARIANTS) { const c = row[phase][code]; const expected = row.invariantScope !== "SHARED_PAIR" && applicable.includes(code) ? phase === "warmupInvariants" ? 5 : 30 : 0; if (c.expected !== expected || c.expected !== c.executed || c.executed !== c.pass || c.fail !== 0) invalid(); }
      }
    }
  }
  if (report.status === "COMPLETE" && (!report.primaryCountsKnown || !report.environment?.databaseVerified || !report.environment.migrationVerified || !report.environment.independentSessions || report.cleanup !== "PASS" || report.failure || report.calibration.length !== 8 || report.rows.some((row) => row.status !== "COMPLETE" || row.warmups !== 5 || row.valid !== 30 || row.cleanup !== "PASS" || !row.wall || (row.metric !== "PAIR" && !row.queries)))) ctx.addIssue({ code: "custom", message: "PROTOCOL" });
  if (report.status === "COMPLETE") {
    if (report.attributionDiagnostic !== null) invalid();
    if (report.selfChecks === 0 || INVARIANTS.some((code) => { const c = report.selfCheckInvariants[code]; return c.expected === 0 || c.expected !== c.executed || c.pass !== c.executed || c.fail !== 0; })) invalid();
    for (const client of ["A", "B"] as const) for (const kind of ["SELECT", "COMMIT", "ROLLBACK", "INDEPENDENT"] as const) {
      const entries = report.calibration.filter((c) => c.client === client && c.kind === kind), c = entries[0];
      if (entries.length !== 1 || !c || !c.verified || !c.attribution || c.lateEvents !== 0 || c.eventMin !== c.eventMax || c.explicit !== (kind === "SELECT" ? 1 : 2) || c.eventMin !== (kind === "SELECT" ? 1 : 4)) invalid();
    }
  }
});
export type Report = z.infer<typeof reportSchema>;
export function recordReportFailure(report: Report, error: unknown): void {
  const code = failureCode(error);
  if (code === "INCOMPLETE") { report.failure = code; report.status = "INCOMPLETE"; report.attributionDiagnostic = null; }
  else { report.failure ??= code; if (report.failure !== "INCOMPLETE") report.status = "INVALID"; }
  if (report.failure === "ATTRIBUTION" && error instanceof SafeFailure && error.code === "ATTRIBUTION" && error.diagnostic) report.attributionDiagnostic ??= error.diagnostic;
}
export function initialRows(): AggregateRow[] { return CELLS.flatMap((cell) => cell.scenario === "SAME-SUBMISSION RACE" ? [newRow(cell, "WINNER"), newRow(cell, "LOSER"), newRow(cell, "PAIR")] : [newRow(cell)]); }
export function safeReport(value: unknown): Report { const result = reportSchema.safeParse(value); if (!result.success) throw new SafeFailure("PROTOCOL"); return result.data; }
export function emptyReport(code: FailureCode): Report { return { protocol: "OBS01_V1", status: "NOT RUN", primaryCountsKnown: true, started: new Date().toISOString(), finished: new Date().toISOString(), environment: null, bootstrapObserved: null, calibration: [], rows: initialRows(), selfChecks: 0, selfCheckInvariants: emptyCodes(), cleanup: "UNKNOWN", failure: code, attributionDiagnostic: null }; }
export const PROTOCOL_PREFIX = "OBS01_AGGREGATE ";
export function serializeReport(value: unknown): string { return PROTOCOL_PREFIX + JSON.stringify(safeReport(value)); }
export function markdown(value: unknown): string {
  const report = safeReport(value);
  const lines = ["# OBS-01", `status: ${report.status}`, `primary_counts_known: ${report.primaryCountsKnown}`, `utc_started: ${report.started}`, `utc_finished: ${report.finished}`, `failure: ${report.failure ?? "N/A"}`, `cleanup: ${report.cleanup}`, `self_checks: ${report.selfChecks}`];
  if (report.environment) for (const [key, val] of Object.entries(report.environment)) lines.push(`${key}: ${val}`);
  if (report.bootstrapObserved) for (const client of ["A", "B"] as const) lines.push(`bootstrap_observed_${client}: ${report.bootstrapObserved[client]}`);
  if (report.attributionDiagnostic) for (const [key, value] of Object.entries(report.attributionDiagnostic)) lines.push(`attribution_${key}: ${value}`);
  lines.push("pool topology: dedicated loopback direct PostgreSQL; isolation unchanged default; event counters and clocks; no overhead correction", "query event coverage: observed events only; extra transaction events unclassified; unexposed engine commands excluded", "contention: simultaneous start; lock overlap and lock wait duration unmeasured", "physical table/index growth, cache warming and autovacuum may affect observations", "", "| Client | Calibration | Explicit | Repetitions | Events min/max | Verified | Attribution | Late events |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const c of report.calibration) lines.push(`| ${c.client} | ${c.kind} | ${c.explicit} | ${c.repetitions} | ${c.eventMin}/${c.eventMax} | ${c.verified} | ${c.attribution} | ${c.lateEvents} |`);
  lines.push("", "| Scenario | N | Selected | Mode | Device/consent/deposit/hold | Outcome/metric | Status | Warmups | Attempted/settled/valid | Wall p50/p95/max ms | Query min/p50/p95/max | Fulfilled/rejected | Effects | Invariant scope | Expected/executed/pass/fail | Cleanup |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of report.rows) {
    const c = row.cell, inv = totalCodes(row.measuredInvariants);
    const wall = row.wall ? [row.wall.p50, row.wall.p95, row.wall.max].map((v) => v.toFixed(3)).join("/") : "N/A";
    const queries = row.queries ? [row.queries.min, row.queries.p50, row.queries.p95, row.queries.max].join("/") : "N/A";
    lines.push(`| ${c.scenario} | ${c.n} | ${c.selected} | ${c.mode} | ${c.device}/${c.consent}/${c.deposit}/${c.hold} | ${row.outcome}/${row.metric} | ${row.status} | ${row.warmups}/5 | ${row.attempted}/${row.settled}/${row.valid}/30 | ${wall} | ${queries} | ${row.fulfilled}/${row.rejected} | ${row.effects} | ${row.invariantScope} | ${inv.expected}/${inv.executed}/${inv.pass}/${inv.fail} | ${row.cleanup} |`);
    for (const phase of ["warmupInvariants", "measuredInvariants"] as const) for (const code of INVARIANTS) { const v = row[phase][code]; if (v.expected || v.executed) lines.push(`${c.scenario}/${c.n}/${c.mode}/${c.device}/${row.metric}/${phase}/${code}: ${v.expected}/${v.executed}/${v.pass}/${v.fail}`); }
    for (const f of row.failures) lines.push(`${c.scenario}/${c.n}/${c.mode}/${c.device}/${row.metric}/${f.code}: ${f.count}`);
  }
  for (const code of INVARIANTS) { const v = report.selfCheckInvariants[code]; lines.push(`SELF_CHECK/${code}: ${v.expected}/${v.executed}/${v.pass}/${v.fail}`); }
  return lines.join("\n") + "\n";
}
