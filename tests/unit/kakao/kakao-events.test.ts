import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emitReservationEvent, emitReservationEventIfSuccessful, type ReservationEventInput } from "@/lib/kakao/events";
import { buildDedupeKey, LogNotificationProvider } from "@/lib/kakao/notify";
import { privateProbes, RecordingNotificationProvider } from "./events-fixture";

const received: ReservationEventInput = { kind: "application.received", entityId: "synthetic-submission-id", occasion: "created", audience: "admin" };
// Deferred kinds are exercised as isolated contracts, never as workflow wiring.
const cases = [
  { kind: "application.received", audience: "admin", title: "새 예약 신청이 접수되었습니다", body: "새 예약 신청을 확인해주세요." },
  { kind: "application.confirmed", audience: "customer", title: "예약이 확정되었습니다", body: "예약 신청이 확정되었습니다." },
  { kind: "application.changed", audience: "customer", title: "예약 신청이 변경되었습니다", body: "예약 신청 상태가 변경되었습니다." },
  { kind: "application.cancelled", audience: "customer", title: "예약 신청이 취소되었습니다", body: "예약 신청이 취소되었습니다." },
] as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T00:00:00Z"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("dry-run reservation event contract", () => {
  it.each(cases)("records one $kind adapter attempt with fixed $audience copy and no URL", async (copy) => {
    const provider = new RecordingNotificationProvider();
    const input: ReservationEventInput = { ...received, kind: copy.kind, audience: copy.audience, occasion: copy.kind === "application.received" ? "created" : "synthetic-revision-marker" };
    const record = await emitReservationEvent(provider, input);
    expect(record).toEqual({
      kind: copy.kind, entityId: input.entityId, audience: copy.audience,
      dedupeKey: buildDedupeKey(copy.kind, input.entityId, input.occasion),
      occurredAt: new Date("2026-10-26T00:00:00Z"), result: { status: "skipped" },
    });
    expect(provider.attempts).toEqual([{ event: copy.kind, dedupeKey: record.dedupeKey, title: copy.title, body: copy.body }]);
    expect(JSON.stringify(provider.attempts).toLowerCase()).not.toContain("http");
    expect(Object.keys(record).sort()).toEqual(["audience", "dedupeKey", "entityId", "kind", "occurredAt", "result"]);
  });

  it.each(cases)("rejects mismatched customer/admin routing metadata for $kind without an adapter attempt", async (copy) => {
    const provider = new RecordingNotificationProvider();
    const record = await emitReservationEvent(provider, { ...received, kind: copy.kind, audience: copy.audience === "admin" ? "customer" : "admin" });
    expect(record.result).toEqual({ status: "failed", reason: "invalid-event-audience" });
    expect(provider.attempts).toEqual([]);
  });

  it("uses emit time while deterministic keys alone do not suppress repeated attempts", async () => {
    const provider = new RecordingNotificationProvider();
    const first = await emitReservationEvent(provider, received);
    vi.setSystemTime(new Date("2026-10-27T00:00:00Z"));
    const second = await emitReservationEvent(provider, received);
    expect(second.occurredAt).toEqual(new Date("2026-10-27T00:00:00Z"));
    expect(first.dedupeKey).toBe(second.dedupeKey);
    expect(provider.attempts).toHaveLength(2);
  });

  it("keys changed contracts by caller revision rather than emit time", async () => {
    const provider = new RecordingNotificationProvider();
    const input: ReservationEventInput = { ...received, kind: "application.changed", audience: "customer", occasion: "synthetic-revision-1" };
    const first = await emitReservationEvent(provider, input);
    const second = await emitReservationEvent(provider, { ...input, occasion: "synthetic-revision-2" });
    expect(first.dedupeKey).toBe(buildDedupeKey(input.kind, input.entityId, "synthetic-revision-1"));
    expect(first.dedupeKey).not.toBe(second.dedupeKey);
  });

  it("does not emit on an explicit failed operation signal", async () => {
    const provider = new RecordingNotificationProvider();
    expect(await emitReservationEventIfSuccessful(provider, false, received)).toBeNull();
    expect(provider.attempts).toEqual([]);
    expect((await emitReservationEventIfSuccessful(provider, true, received))?.result).toEqual({ status: "skipped" });
    expect(provider.attempts).toHaveLength(1);
  });

  it.each(["entityId", "occasion"] as const)("never throws for an invalid %s dedupe input and makes no adapter attempt", async (field) => {
    const provider = new RecordingNotificationProvider();
    const record = await emitReservationEvent(provider, { ...received, [field]: "" });
    expect(record.dedupeKey).toBe("");
    expect(record.result).toEqual({ status: "failed", reason: "invalid-reservation-event" });
    expect(provider.attempts).toEqual([]);
  });

  it("contains a throwing provider failure without reflecting private error details", async () => {
    const provider = new RecordingNotificationProvider(new Error(privateProbes.join(" ")));
    const record = await emitReservationEvent(provider, received);
    expect(record.result).toEqual({ status: "failed", reason: "provider-error" });
    expect(provider.attempts).toHaveLength(1);
    for (const probe of privateProbes) expect(JSON.stringify({ record, payload: provider.attempts })).not.toContain(probe);
  });

  it.each(cases)("does not copy synthetic personal/financial inputs into $kind records or payloads", async (copy) => {
    const provider = new RecordingNotificationProvider();
    const input = {
      ...received, kind: copy.kind, audience: copy.audience,
      childName: privateProbes[0], guardianName: privateProbes[1], phone: privateProbes[2],
      amount: privateProbes[3], token: privateProbes[4], accountNumber: privateProbes[5],
    };
    const record = await emitReservationEvent(provider, input);
    const serialized = JSON.stringify({ record, payload: provider.attempts });
    for (const probe of privateProbes) expect(serialized).not.toContain(probe);
  });

  it("real LogNotificationProvider and recording adapter return skipped with zero network calls", async () => {
    const fetch = vi.fn(() => { throw new Error("Network forbidden in this unit test"); });
    vi.stubGlobal("fetch", fetch);
    const logs: string[] = [];
    const realDryRun = new LogNotificationProvider((line) => logs.push(line));
    const recording = new RecordingNotificationProvider();
    const logRecord = await emitReservationEvent(realDryRun, received);
    const recorded = await emitReservationEvent(recording, received);
    expect(logRecord.result).toEqual({ status: "skipped", reason: "provider-skipped" });
    expect(recorded.result).toEqual({ status: "skipped" });
    expect(logs).toHaveLength(1);
    expect(JSON.parse(logs[0]).result.status).toBe("skipped");
    // The interface method send() recorded one attempt; no real transport exists.
    expect(recording.attempts).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
});
