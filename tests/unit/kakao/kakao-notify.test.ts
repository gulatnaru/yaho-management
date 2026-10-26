import { describe, expect, it, vi } from "vitest";
import { buildDedupeKey, LogNotificationProvider, notifyReservationEvent, type NotificationProvider, type ReservationNotificationEvent } from "@/lib/kakao/notify";

const event = "application.received" as const;
const input = { event, dedupeKey: buildDedupeKey(event, "synthetic-entity", "synthetic-occasion"), title: "synthetic-title", body: "synthetic-body" };

describe("notification provider boundary", () => {
  it("returns a sent result from the injected provider", async () => {
    const send = vi.fn<NotificationProvider["send"]>().mockResolvedValue({ status: "sent" });
    expect(await notifyReservationEvent({ send }, input)).toEqual({ status: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(input);
  });

  it.each(["", " "])("returns failure for an empty dedupe key %j without invoking the provider", async (dedupeKey) => {
    const send = vi.fn<NotificationProvider["send"]>();
    await expect(notifyReservationEvent({ send }, { ...input, dedupeKey })).resolves.toEqual({ status: "failed", reason: "invalid-notification-input" });
    expect(send).not.toHaveBeenCalled();
  });

  it("catches synchronous exceptions and promise rejections without exposing error messages", async () => {
    const failure = new Error("synthetic-recipient@example.test synthetic-entity synthetic-private-detail");
    const synchronous: NotificationProvider = { send: () => { throw failure; } };
    const asynchronous: NotificationProvider = { send: async () => { throw failure; } };
    for (const provider of [synchronous, asynchronous]) {
      await expect(notifyReservationEvent(provider, input)).resolves.toEqual({ status: "failed", reason: "provider-error" });
    }
  });

  it("rejects extra recipient fields and invalid copy before invoking the provider", async () => {
    const send = vi.fn<NotificationProvider["send"]>();
    const unexpected = { ...input, recipient: "synthetic-recipient@example.test" };
    expect(await notifyReservationEvent({ send }, unexpected)).toEqual({ status: "failed", reason: "invalid-notification-input" });
    expect(await notifyReservationEvent({ send }, { ...input, title: " " })).toEqual({ status: "failed", reason: "invalid-notification-input" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not expose an untrusted provider reason", async () => {
    const provider: NotificationProvider = { send: async () => ({ status: "failed", reason: "synthetic-private-detail" }) };
    expect(await notifyReservationEvent(provider, input)).toEqual({ status: "failed", reason: "provider-failed" });
  });

  it("returns failure for an invalid runtime result or a broken logger", async () => {
    const invalid = { send: async () => null } as unknown as NotificationProvider;
    expect(await notifyReservationEvent(invalid, input)).toEqual({ status: "failed", reason: "invalid-provider-result" });
    const logger = new LogNotificationProvider(() => { throw new Error("synthetic-log-error"); });
    expect(await notifyReservationEvent(logger, input)).toEqual({ status: "failed", reason: "provider-error" });
  });

  it("logs only event, an opaque correlation key and a skipped result; sends nothing", async () => {
    const lines: string[] = [];
    const provider = new LogNotificationProvider((line) => lines.push(line));
    const unsafeInput = { ...input, dedupeKey: "synthetic-internal-id", title: "synthetic-child-name", body: "synthetic-recipient@example.test" };
    expect(await provider.send(unsafeInput)).toEqual({ status: "skipped", reason: "log-only-provider" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ event, dedupeKey: expect.stringMatching(/^[a-f0-9]{64}$/), result: { status: "skipped", reason: "log-only-provider" } });
    for (const value of [unsafeInput.dedupeKey, unsafeInput.title, unsafeInput.body, "recipient", "title", "body", "@"]) expect(lines[0]).not.toContain(value);
    expect(await notifyReservationEvent(provider, input)).toEqual({ status: "skipped", reason: "provider-skipped" });
  });
});

describe("future outbox dedupe contract", () => {
  it("is deterministic, opaque, and distinct per event, entity and occasion", () => {
    expect(buildDedupeKey(event, "synthetic-entity", "synthetic-occasion")).toBe(input.dedupeKey);
    expect(input.dedupeKey).toMatch(/^application\.received:[a-f0-9]{64}$/);
    expect(input.dedupeKey).not.toContain("synthetic-entity");
    expect(input.dedupeKey).not.toContain("synthetic-occasion");
    const keys = [input.dedupeKey, buildDedupeKey("application.confirmed", "synthetic-entity", "synthetic-occasion"), buildDedupeKey(event, "synthetic-other-entity", "synthetic-occasion"), buildDedupeKey(event, "synthetic-entity", "synthetic-other-occasion")];
    expect(new Set(keys).size).toBe(4);
  });

  it("does not confuse tuple components containing separators", () => {
    expect(buildDedupeKey(event, "synthetic-entity:synthetic-part", "synthetic-occasion")).not.toBe(buildDedupeKey(event, "synthetic-entity", "synthetic-part:synthetic-occasion"));
  });

  it.each(["", " "])("rejects empty entity or occasion %j", (value) => {
    expect(() => buildDedupeKey(event, value, "synthetic-occasion")).toThrow("Invalid notification dedupe input.");
    expect(() => buildDedupeKey(event, "synthetic-entity", value)).toThrow("Invalid notification dedupe input.");
  });

  it("rejects an unknown runtime event", () => {
    expect(() => buildDedupeKey("synthetic-invalid-event" as ReservationNotificationEvent, "synthetic-entity", "synthetic-occasion")).toThrow("Invalid notification dedupe input.");
  });
});
