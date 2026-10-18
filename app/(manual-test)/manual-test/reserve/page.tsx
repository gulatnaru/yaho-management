"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { submissionSchema } from "@/server/manual-test/contracts";
import { csrfSchema, errorMessage, kst, ManualClientError, manualRequest, readReservationLocation, reservationSession, uuid, type ReservationSession } from "../client";
import { Field, Notice, Panel } from "../ui";

export default function ManualTestReservationPage() {
  const [session, setSession] = useState<ReservationSession | null>(null);
  const [busy, setBusy] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const [childId, setChildId] = useState("child-1");
  const locked = useRef(true);
  const initialization = useRef<Promise<ReservationSession> | null>(null);

  useEffect(() => {
    let active = true;
    if (!initialization.current) initialization.current = (async () => {
      const href = window.location.href;
      // Erase the grant before validation or network access, even for malformed links.
      if (window.location.hash) window.history.replaceState(null, "", window.location.pathname + window.location.search);
      const { runId, grant } = readReservationLocation(href);
      if (grant) {
        const challenge = await manualRequest("csrf", csrfSchema);
        await manualRequest("exchange", csrfSchema.extend({ runId: uuid }), { body: { runId, grant }, csrf: challenge.csrf });
      }
      return manualRequest("session", reservationSession, { query: { runId, scope: "RESERVATION" } });
    })();
    // Reuse the same initialization promise across React StrictMode effect replay.
    initialization.current.then((next) => { if (active) { setSession(next); setExpired(next.expiresAt <= Date.now()); } })
      .catch((caught: unknown) => { if (active) setError(caught instanceof z.ZodError || (caught instanceof Error && caught.message === "Invalid TEST link") ? "TEST link is missing or malformed. Request a new single-use reservation URL." : errorMessage(caught)); })
      .finally(() => { if (active) { locked.current = false; setBusy(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const timer = window.setTimeout(() => setExpired(true), Math.max(0, session.expiresAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [session]);

  async function act(task: (current: ReservationSession) => Promise<void>) {
    if (locked.current || !session) return;
    locked.current = true; setBusy(true); setError("");
    try { await task(session); } catch (caught) { setError(errorMessage(caught)); if (caught instanceof ManualClientError && caught.status === 401) setExpired(true); }
    finally { locked.current = false; setBusy(false); }
  }
  async function refresh(current: ReservationSession) {
    const next = await manualRequest("session", reservationSession, { query: { runId: current.runId, scope: "RESERVATION" } });
    setSession(next); setExpired(next.expiresAt <= Date.now());
  }

  return <div className="mx-auto max-w-lg space-y-5">
    <div><h1 className="text-2xl font-bold">TEST reservation form</h1><p className="mt-2 text-sm text-slate-600">Synthetic child fixtures only. This creates a mock application for operator confirmation.</p></div>
    <Notice error={error} busy={busy} />
    {!session && !busy && <Panel title="TEST link unavailable"><p className="text-sm">Use a fresh single-use URL from the TEST operator. Expired, already-used, closed-run, and disabled-runtime links cannot start a session. After successful exchange, reloads use only the reservation cookie and run ID.</p></Panel>}
    {session && <Panel title={session.application ? "TEST application result" : "Choose a synthetic TEST child"}>
      <p className="text-xs text-slate-500">TEST reservation session expires {kst(session.expiresAt)}</p>
      {expired && <p role="alert" className="text-sm font-semibold text-red-800">TEST session expired or unavailable. Ask the operator for a new link.</p>}
      {session.application ? <div className="space-y-3"><p className="text-lg font-bold">TEST · {session.application.status === "CONFIRMED" ? "CONFIRMED" : "PENDING operator confirmation"}</p><p className="break-all text-sm">Application {session.application.id}</p><p className="text-sm">The TEST operator records a synthetic deposit and confirms the mock reservation. Refresh to check the result.</p></div> : <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void act(async (current) => {
        const body = submissionSchema.parse({ runId: current.runId, childId });
        const result = await manualRequest("submission", z.object({ applicationId: uuid, status: z.literal("PENDING") }), { body, csrf: current.csrf });
        // Keep the successful result visible even if status refresh later fails.
        setSession({ ...current, application: { id: result.applicationId, status: result.status } });
        await refresh(current);
      }); }}>
        <Field label="Synthetic child fixture"><Select value={childId} onChange={(event) => setChildId(event.target.value)} disabled={busy || expired}>{Array.from({ length: 12 }, (_, index) => `child-${index + 1}`).map((id) => <option key={id} value={id}>{id}{id === "child-12" ? " · INACTIVE edge fixture" : " · active fixture"}</option>)}</Select></Field>
        {childId === "child-12" && <p className="text-sm text-amber-900">TEST edge case: child-12 is inactive. Submission is allowed for testing; operator confirmation is blocked.</p>}
        <p className="text-sm text-slate-600">No real names, phone numbers, or customer notes are collected.</p>
        <Button className="w-full" disabled={busy || expired}>Submit TEST application</Button>
      </form>}
      <Button type="button" className="w-full" disabled={busy || expired} onClick={() => void act(refresh)}>Refresh TEST status / session</Button>
    </Panel>}
  </div>;
}
