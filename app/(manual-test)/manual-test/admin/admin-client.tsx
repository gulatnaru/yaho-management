"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { bootstrapSchema, classSchema, depositSchema, refundSchema } from "@/server/manual-test/contracts";
import { bootstrapResult, cleanedResult, closedResult, csrfSchema, errorMessage, krw, kst, linkResult, ManualClientError, manualRequest, operatorSession, reservationUrl, RetryKeys, revenueSchema, uuid, type OperatorSession, type Revenue } from "../client";
import { Field, Notice, Panel } from "../ui";

type Application = OperatorSession["data"]["applications"][string];
type Payment = OperatorSession["data"]["payments"][string];
type Act = (task: () => Promise<void>) => Promise<boolean>;
const idResult = (field: string) => z.object({ [field]: uuid });
const integerInput = (value: FormDataEntryValue | null) => typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;

export default function ManualTestAdminClient() {
  const [session, setSession] = useState<OperatorSession | null>(null);
  const [resumeRunId, setResumeRunId] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<Revenue | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expired, setExpired] = useState(false);
  const [closed, setClosed] = useState<{ runId: string; csrf: string; cleaned: boolean } | null>(null);
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  const locked = useRef(false);
  const keys = useRef(new RetryKeys());
  const initialization = useRef<Promise<OperatorSession | null> | null>(null);

  const act: Act = useCallback(async (task) => {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(""); setMessage("");
    try { await task(); return true; }
    catch (caught) { setError(errorMessage(caught)); if (caught instanceof ManualClientError && caught.status === 401) { setExpired(true); setLink(null); } return false; }
    finally { locked.current = false; setBusy(false); }
  }, []);

  const refresh = useCallback(async (runId: string) => {
    // A session read rotates CSRF. Never run session reads concurrently.
    const next = await manualRequest("session", operatorSession, { query: { runId, scope: "OPERATOR" } });
    setResumeRunId(null);
    setSession(next); setExpired(next.expiresAt <= Date.now());
    setRevenue(null);
    setRevenue(await manualRequest("revenue", revenueSchema, { query: { runId } }));
  }, []);

  useEffect(() => {
    let active = true;
    if (!initialization.current) initialization.current = (async () => {
      const runId = new URL(window.location.href).searchParams.get("runId");
      if (!runId) return null;
      const parsed = uuid.parse(runId);
      setResumeRunId(parsed);
      return manualRequest("session", operatorSession, { query: { runId: parsed, scope: "OPERATOR" } });
    })();
    locked.current = true; setBusy(true);
    initialization.current.then(async (next) => {
      if (!active || !next) return;
      setSession(next); setResumeRunId(null); setExpired(next.expiresAt <= Date.now());
      const totals = await manualRequest("revenue", revenueSchema, { query: { runId: next.runId } });
      if (active) setRevenue(totals);
    }).catch((caught: unknown) => { if (active) setError(errorMessage(caught)); })
      .finally(() => { if (active) { locked.current = false; setBusy(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  async function bootstrap(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await act(async () => {
      const body = bootstrapSchema.parse({});
      const challenge = await manualRequest("csrf", csrfSchema);
      const created = await manualRequest("bootstrap", bootstrapResult, { body, csrf: challenge.csrf });
      setClosed(null); setLink(null);
      window.history.replaceState(null, "", `/manual-test/admin?runId=${created.runId}`);
      setResumeRunId(created.runId);
      await refresh(created.runId);
      setMessage("TEST run started. Create a synthetic class to begin.");
    });
  }

  async function createClass(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    await act(async () => {
      const body = classSchema.parse({ runId: session.runId, capacity: integerInput(fields.get("capacity")), teacherIds: fields.getAll("teacherIds"), quotedAmount: integerInput(fields.get("amount")), startsAt: new Date(String(fields.get("startsAt"))).getTime(), endsAt: new Date(String(fields.get("endsAt"))).getTime() });
      if (body.startsAt <= Date.now()) throw new ManualClientError("CLASS_TIME_INVALID", 400);
      const created = await manualRequest("classes", z.object({ classId: uuid, teacherWarning: z.boolean() }), { body, csrf: session.csrf });
      form.reset();
      await refresh(session.runId);
      setMessage(created.teacherWarning ? "TEST class created. Warning: fewer than two teachers assigned." : "TEST class created.");
    });
  }

  async function financial(operation: "deposit" | "payment" | "refunds", body: Record<string, unknown>, schema: z.ZodType<unknown>) {
    if (!session) return;
    const requestKey = keys.current.key(operation, body);
    await manualRequest(operation, schema, { body: { ...body, runId: session.runId, requestKey }, csrf: session.csrf });
    keys.current.done(operation, body);
    setMessage(`TEST ${operation} recorded successfully.`);
    try { await refresh(session.runId); }
    catch (caught) {
      setError(`TEST ${operation} succeeded, but the display refresh failed. Use Refresh TEST session & totals to reload records. ${errorMessage(caught)}`);
      if (caught instanceof ManualClientError && caught.status === 401) setExpired(true);
    }
  }

  async function cancel(kind: "CLASS" | "RESERVATION" | "APPLICATION", targetId: string) {
    if (!session) return;
    await manualRequest("cancel", z.object({ targetId: uuid, status: z.literal("CANCELLED") }), {
      body: { runId: session.runId, kind, targetId, reason: "SYNTHETIC_OPERATOR_CANCELLATION" }, csrf: session.csrf,
    });
    setLink(null);
    await refresh(session.runId);
    setMessage("TEST cancellation recorded. Deposits, payments and refunds are unchanged; any refund requires a separate explicit action.");
  }

  async function cleanup(current: { runId: string; csrf: string; cleaned: boolean }) {
    await manualRequest("cleanup", cleanedResult, { body: { runId: current.runId }, csrf: current.csrf });
    setClosed({ ...current, cleaned: true });
    setMessage("TEST ended and synthetic run data cleaned up.");
  }

  return <>
    <div><h1 className="text-2xl font-bold">TEST admin dashboard</h1><p className="mt-1 text-sm text-slate-600">Start → virtual class → reservation link → synthetic application → deposit → confirmation → payment / refund / cancellation → end test.</p></div>
    <Notice error={error} message={message} busy={busy} />
    {!session && <Panel title={closed ? "TEST run ended" : "Start a TEST run"}>
      {closed && <div className="space-y-3"><p className="font-semibold">{closed.cleaned ? "CLEANED · Synthetic data removed" : "CLOSED · Reservation sessions revoked; cleanup still required"}</p><p className="text-sm">Run: <span className="break-all font-mono">{closed.runId}</span></p>{!closed.cleaned && <Button disabled={busy} onClick={() => void act(() => cleanup(closed))}>Retry TEST cleanup</Button>}</div>}
      {resumeRunId && !closed && <div className="space-y-3"><p className="text-sm">A TEST run ID is already present. Resume its operator session after a connection failure. If it has expired or closed, start another test.</p><Button disabled={busy} onClick={() => void act(() => refresh(resumeRunId))}>Resume existing TEST run</Button><Button disabled={busy} className="ml-3" onClick={() => { setResumeRunId(null); window.history.replaceState(null, "", "/manual-test/admin"); }}>Use a new TEST run</Button></div>}
      {(!closed || closed.cleaned) && !resumeRunId && <form onSubmit={bootstrap} className="max-w-lg space-y-4"><p className="text-sm text-slate-600">Your current ADMIN session authorizes a new TEST run on the configured HTTPS test origin. The runtime must be explicitly enabled outside production. Runs expire after at most one hour; sessions after 15 minutes.</p><Button disabled={busy}>Start TEST as ADMIN</Button></form>}
    </Panel>}
    {session && <>
      <Panel title="Active TEST session">
        <p className="break-all font-mono text-sm">Run: {session.runId}</p><p className="text-sm">{session.mode === "DATABASE" ? "ISOLATED DATABASE" : "MOCK ONLY"} · Session expires {kst(session.expiresAt)}</p>
        {expired && <p role="alert" className="font-semibold text-red-800">TEST session expired or unavailable. Start a new run; old fixtures cannot be reused.</p>}
        <div className="flex flex-wrap gap-3"><Button disabled={busy || expired} onClick={() => void act(() => refresh(session.runId))}>Refresh TEST session &amp; totals</Button>
          <Button disabled={busy || expired} className="bg-red-800 hover:bg-red-700" onClick={() => void act(async () => {
            const result = await manualRequest("close", closedResult, { body: { runId: session.runId }, csrf: session.csrf });
            const current = { runId: result.runId, csrf: result.csrf, cleaned: false };
            setClosed(current); setSession(null); setRevenue(null); setLink(null);
            // Closing revokes reservation sessions; the refreshed operator session survives for cleanup.
            await cleanup(current);
          })}>End TEST &amp; clean data</Button>
          {expired && <Button disabled={busy} onClick={() => { setSession(null); setRevenue(null); setLink(null); window.history.replaceState(null, "", "/manual-test/admin"); }}>Start another TEST</Button>}
        </div>
      </Panel>
      <fieldset disabled={busy || expired} className="min-w-0 space-y-5 disabled:opacity-70">
        <Panel title="1. Create a virtual TEST class"><form onSubmit={createClass} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Capacity (1–99)"><Input name="capacity" type="number" min={1} max={99} step={1} defaultValue={8} required /></Field>
          <Field label="Quoted TEST amount (integer KRW)"><Input name="amount" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={1} required placeholder="Enter an explicit amount" /></Field>
          <div className="space-y-2"><p className="text-sm font-medium">Synthetic teachers</p>{["teacher-1", "teacher-2"].map((id) => <label className="flex items-center gap-2 text-sm" key={id}><Checkbox name="teacherIds" value={id} defaultChecked />{id}</label>)}</div>
          <Field label="Future start (your browser's local timezone)"><Input name="startsAt" type="datetime-local" required /></Field>
          <Field label="End (your browser's local timezone)"><Input name="endsAt" type="datetime-local" required /></Field>
          <div className="flex items-end"><Button>Create TEST class</Button></div>
          <p className="text-xs text-slate-600 sm:col-span-2 lg:col-span-3">Local date inputs are converted to timestamps. Class lists and link expiry below display Asia/Seoul (KST).</p>
        </form></Panel>
        <Panel title="2. TEST classes & reservation URLs">
          {Object.values(session.data.classes).length === 0 && <p className="text-sm text-slate-500">No TEST classes yet.</p>}
          <div className="grid gap-3 md:grid-cols-2">{Object.values(session.data.classes).map((row) => <article key={row.id} className="space-y-2 rounded border p-3 text-sm"><h2 className="break-all font-mono font-semibold">TEST class {row.id}</h2><p>{kst(row.startsAt)} → {kst(row.endsAt)}</p><p>{row.status} · Capacity {row.capacity} · {krw(row.quotedAmount)}</p><p>{row.teacherIds.join(", ")}{row.teacherIds.length < 2 && " · Warning: fewer than two teachers"}</p><Button type="button" disabled={row.status !== "SCHEDULED" || row.startsAt <= Date.now()} onClick={() => void act(async () => {
            const result = await manualRequest("links", linkResult, { body: { runId: session.runId, classId: row.id }, csrf: session.csrf });
            setLink({ url: reservationUrl(window.location.origin, result.runId, result.grant), expiresAt: result.expiresAt });
            setMessage("TEST reservation URL issued. Open once in a separate tab.");
          })}>Issue TEST reservation URL</Button><Button type="button" disabled={row.status !== "SCHEDULED" || row.endsAt < Date.now()} onClick={() => void act(() => cancel("CLASS", row.id))}>Cancel TEST class</Button><p className="text-xs text-slate-600">Class cancellation preserves reservation statuses and does not refund payments.</p></article>)}</div>
          {link && <div className="space-y-3 rounded border border-amber-300 bg-amber-50 p-3"><p className="text-sm font-semibold">TEST single-use link · Expires {kst(link.expiresAt)}</p><p className="text-xs">The fragment holds a one-time grant. Each customer session uses a new URL; opening another link replaces the reservation cookie in that browser. Do not share outside this test.</p><Field label="TEST reservation URL (select and copy if clipboard unavailable)"><Input value={link.url} readOnly onFocus={(event) => event.currentTarget.select()} /></Field><div className="flex flex-wrap gap-3"><Button type="button" onClick={() => { void navigator.clipboard?.writeText(link.url).then(() => setMessage("TEST link copied.")).catch(() => setMessage("Select the TEST URL field and copy it manually.")); if (!navigator.clipboard) setMessage("Select the TEST URL field and copy it manually."); }}>Copy TEST URL</Button><a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center rounded border border-slate-400 px-4 text-sm font-medium">Open TEST form</a></div></div>}
        </Panel>
        <Panel title="3. TEST applications, deposits & confirmations">
          {Object.values(session.data.applications).length === 0 && <p className="text-sm text-slate-500">No TEST applications. Open an issued reservation URL and submit a child fixture, then refresh.</p>}
          {Object.values(session.data.applications).map((row) => <ApplicationCard key={row.id} onCancel={() => act(() => cancel(row.reservationId ? "RESERVATION" : "APPLICATION", row.reservationId ?? row.id))} row={row} data={session.data} act={act} onDeposit={(amount) => financial("deposit", { applicationId: row.id, amount }, idResult("depositId"))} onConfirm={(confirmOverbooking) => act(async () => { await manualRequest("confirm", idResult("reservationId"), { body: { runId: session.runId, applicationId: row.id, confirmOverbooking }, csrf: session.csrf }); await refresh(session.runId); setMessage("TEST reservation confirmed."); })} onPayment={() => act(() => financial("payment", { reservationId: row.reservationId, amount: row.quotedAmount }, idResult("paymentId")))} />)}
        </Panel>
        <Panel title="4. TEST payments & refunds">
          {Object.values(session.data.payments).length === 0 && <p className="text-sm text-slate-500">No TEST payments recorded.</p>}
          {Object.values(session.data.payments).map((payment) => <PaymentCard key={payment.id} payment={payment} data={session.data} act={act} onRefund={(body) => financial("refunds", { paymentId: payment.id, ...body }, z.object({ refundId: uuid, refundedAmount: z.number().int(), status: z.enum(["PARTIALLY_REFUNDED", "REFUNDED"]) }))} />)}
          <h2 className="font-semibold">TEST refund ledger</h2>{session.data.refunds.length === 0 && <p className="text-sm text-slate-500">No TEST refunds.</p>}
          {session.data.refunds.map((row) => <p key={row.id} className="break-all border-t pt-2 text-sm">{krw(row.amount)} · {row.reason}{row.detail && ` · ${row.detail}`} · Payment {row.paymentId}</p>)}
        </Panel>
        <Panel title="5. TEST revenue (server ledger)">
          {revenue ? <dl className="grid gap-3 sm:grid-cols-3">{[["Gross payments", revenue.gross], ["Refunds", revenue.refunds], ["Net revenue", revenue.net]].map(([label, value]) => <div key={label} className="rounded bg-slate-50 p-4"><dt className="text-sm text-slate-600">{label}</dt><dd className="text-xl font-bold">{krw(Number(value))}</dd></div>)}</dl> : <p className="text-sm">TEST totals unavailable. Refresh to read the server ledger.</p>}
          <p className="text-xs text-slate-500">Synthetic deposits are shown per application; revenue comes only from the test payment/refund ledger.</p>
        </Panel>
      </fieldset>
    </>}
  </>;
}

function ApplicationCard({ row, data, act, onDeposit, onConfirm, onPayment, onCancel }: { onCancel: () => Promise<boolean>; row: Application; data: OperatorSession["data"]; act: Act; onDeposit: (amount: number) => Promise<void>; onConfirm: (overbooking: boolean) => Promise<boolean>; onPayment: () => Promise<boolean> }) {
  const [overbooking, setOverbooking] = useState(false);
  const classRow = data.classes[row.classId];
  const reservation = row.reservationId ? data.reservations[row.reservationId] : undefined;
  const canOperate = classRow?.status === "SCHEDULED" && classRow.endsAt >= Date.now();
  const deposits = data.deposits.filter((deposit) => deposit.applicationId === row.id);
  const paid = Object.values(data.payments).some((payment) => payment.reservationId === row.reservationId);
  return <article className="space-y-3 rounded border p-4">
    <h2 className="font-semibold">TEST {row.childId} · {row.status}{!data.children[row.childId]?.active && " · INACTIVE fixture"}</h2>
    <p className="break-all text-xs">Application {row.id} · Class {row.classId}</p><p className="text-sm">Class {classRow?.status}{reservation && ` · Reservation ${reservation.status}`}</p><p className="text-sm">Quoted: {krw(row.quotedAmount)} · Deposited: {krw(deposits.reduce((sum, deposit) => sum + deposit.amount, 0))}</p>
    {deposits.map((deposit) => <p className="break-all text-xs text-slate-600" key={deposit.id}>Deposit {deposit.id}: {krw(deposit.amount)}</p>)}
    {row.status === "PENDING" && canOperate ? <>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const amount = integerInput(new FormData(form).get("amount")); void act(async () => { const validated = depositSchema.shape.amount.parse(amount); await onDeposit(validated); form.reset(); }); }}><Field label={`TEST deposit KRW for ${row.childId}`}><Input name="amount" type="number" min={1} max={Number.MAX_SAFE_INTEGER} step={1} required /></Field><Button>Record TEST deposit</Button></form>
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={overbooking} onChange={(event) => setOverbooking(event.target.checked)} />Explicitly approve TEST overbooking for this application</label><Button type="button" onClick={() => void onConfirm(overbooking)}>Confirm TEST reservation</Button>
    </> : row.status === "CONFIRMED" ? <><p className="break-all text-sm">Reservation {row.reservationId}</p><Button type="button" disabled={paid} onClick={() => void onPayment()}>{paid ? "TEST payment recorded" : `Record TEST payment · ${krw(row.quotedAmount)}`}</Button></> : <p className="text-sm">TEST application {row.status}; further processing unavailable.</p>}
    {(row.status === "PENDING" || (canOperate && reservation?.status === "RESERVED")) && <Button type="button" onClick={() => void onCancel()}>Cancel TEST {row.reservationId ? "reservation" : "application"}</Button>}
  </article>;
}

function PaymentCard({ payment, data, act, onRefund }: { payment: Payment; data: OperatorSession["data"]; act: Act; onRefund: (body: { amount: number; reason: "CUSTOMER_REQUEST" | "CLASS_CANCELLED" | "OTHER"; detail?: "SYNTHETIC_NO_SHOW_APPROVAL" | "SYNTHETIC_OTHER_APPROVAL" }) => Promise<void> }) {
  const [reason, setReason] = useState("CUSTOMER_REQUEST");
  const reservation = data.reservations[payment.reservationId];
  const needsDetail = reason === "OTHER" || reservation?.status === "NO_SHOW" || reservation?.attendance === "ABSENT";
  const remaining = payment.amount - payment.refundedAmount;
  return <article className="space-y-3 rounded border p-4"><h2 className="break-all font-semibold">TEST payment {payment.id}</h2><p className="text-sm">{payment.status} · Paid {krw(payment.amount)} · Refunded {krw(payment.refundedAmount)} · Remaining {krw(remaining)}</p>
    {remaining > 0 && <form className="grid items-end gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const fields = new FormData(form); void act(async () => { const body = refundSchema.omit({ runId: true, paymentId: true, requestKey: true }).parse({ amount: integerInput(fields.get("amount")), reason, ...(needsDetail ? { detail: fields.get("detail") } : {}) }); await onRefund(body); form.reset(); setReason("CUSTOMER_REQUEST"); }); }}>
      <Field label={`TEST refund KRW for payment ${payment.id}`}><Input name="amount" type="number" min={1} max={remaining} step={1} required /></Field>
      <Field label="TEST refund reason"><Select value={reason} onChange={(event) => setReason(event.target.value)}><option value="CUSTOMER_REQUEST">CUSTOMER_REQUEST</option><option value="CLASS_CANCELLED">CLASS_CANCELLED</option><option value="OTHER">OTHER</option></Select></Field>
      {needsDetail && <Field label="Synthetic approval detail (required)"><Select name="detail" required defaultValue=""><option value="" disabled>Select synthetic approval</option><option value="SYNTHETIC_OTHER_APPROVAL">SYNTHETIC_OTHER_APPROVAL</option><option value="SYNTHETIC_NO_SHOW_APPROVAL">SYNTHETIC_NO_SHOW_APPROVAL</option></Select></Field>}<Button>Record TEST refund</Button>
    </form>}
  </article>;
}
