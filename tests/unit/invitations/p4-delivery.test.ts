import { describe, expect, it, vi } from "vitest";
import { deliveryConfig, invitationUseEnabled } from "@/lib/invitations/config";
import { invitationEmail, resendDelivery } from "@/lib/invitations/resend";

const origin = "https://example.test";
const input = { email: "recipient@example.test", acceptUrl: `${origin}/invite/${"sample-capability"}`, expiresAt: new Date(), invitationId: "inv-1", attemptId: "attempt-1" };
const fakeEnv = { NODE_ENV: "test", YAHO_INVITATION_DELIVERY: "fake", YAHO_P4_ISOLATED_HARNESS: "1", DATABASE_URL: "postgresql://yaho_e2e@127.0.0.1:55432/yaho_e2e" };

describe("P4 delivery", () => {
  it("defaults off and confines fake delivery to the isolated harness", () => {
    expect(deliveryConfig({})).toEqual({ kind: "off" });
    expect(deliveryConfig({ YAHO_INVITATION_DELIVERY: "resend" })).toEqual({ kind: "off" });
    expect(deliveryConfig({ ...fakeEnv, NODE_ENV: "production" }).kind).toBe("fake");
    expect(deliveryConfig({ ...fakeEnv, YAHO_P4_ISOLATED_HARNESS: undefined })).toEqual({ kind: "off" });
    expect(deliveryConfig({ ...fakeEnv, DATABASE_URL: "postgresql://yaho_e2e@127.0.0.1:55432/other" })).toEqual({ kind: "off" });
    expect(deliveryConfig({ ...fakeEnv, YAHO_P4_ISOLATED_HARNESS: "true" })).toEqual({ kind: "off" });
    expect(deliveryConfig(fakeEnv).kind).toBe("fake");
    expect(invitationUseEnabled({})).toBe(false);
  });
  it("requires complete approved HTTPS configuration and separate use transition", () => {
    const config = { YAHO_INVITATION_DELIVERY: "resend", YAHO_INVITATION_REAL_SEND_APPROVED: "1", YAHO_INVITATION_RESEND_ACCOUNT_APPROVED: "1", YAHO_INVITATION_TRACKING_DISABLED: "1", YAHO_INVITATION_MIGRATION_DEPLOY_APPROVED: "1", YAHO_INVITATION_DOMAIN_AUTHENTICATED: "1", YAHO_INVITATION_SENDER_APPROVED: "1", YAHO_INVITATION_ORIGIN_APPROVED: "1", RESEND_API_KEY: ["re", "placeholder"].join("_"), YAHO_INVITATION_SENDER: "sender@example.test", YAHO_INVITATION_SENDING_DOMAIN: "example.test", YAHO_INVITATION_ORIGIN: origin };
    expect(deliveryConfig(config).kind).toBe("resend");
    expect(invitationUseEnabled(config)).toBe(false);
    expect(invitationUseEnabled({ ...config, YAHO_INVITATION_USE_TRANSITION_APPROVED: "1" })).toBe(true);
    expect(deliveryConfig({ ...config, YAHO_INVITATION_ORIGIN: "http://example.test" }).kind).toBe("off");
    expect(deliveryConfig({ ...config, YAHO_INVITATION_TRACKING_DISABLED: "true" }).kind).toBe("off");
  });
  it("escapes HTML and includes the link only in the body", () => {
    const body = invitationEmail("a&b@example.test", input.acceptUrl);
    expect(body.html).toContain("a&amp;b@example.test");
    expect(body.html).toContain(input.acceptUrl);
    expect(body.text).toContain(input.acceptUrl);
    expect(body.text).toContain("72시간");
    expect(body.text).toContain("비밀번호");
  });
  it("constructs one request with stable idempotency key and reports API acceptance", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "message-1" }), { status: 200 }));
    const result = await resendDelivery("test-value", "sender@example.test", fetcher).sendInvitation(input);
    expect(result).toEqual({ status: "ACCEPTED", providerMessageId: "message-1" });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers["Idempotency-Key"]).toBe("invitation/inv-1/attempt-1");
    expect(init.headers["Idempotency-Key"]).not.toContain("sample-capability");
    expect(JSON.parse(init.body).text).toContain(input.acceptUrl);
  });
  it.each([[429, "LIMIT"], [401, "AUTH"], [403, "AUTH"], [400, "PROVIDER"]])("classifies HTTP %i as failure", async (status, category) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
    expect(await resendDelivery("test-value", "sender@example.test", fetcher).sendInvitation(input)).toEqual({ status: "FAILED", errorCategory: category });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("reports network uncertainty rather than retrying", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("timeout"));
    expect(await resendDelivery("test-value", "sender@example.test", fetcher).sendInvitation(input)).toEqual({ status: "UNKNOWN", errorCategory: "NETWORK" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("treats malformed success as unknown", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await resendDelivery("test-value", "sender@example.test", fetcher).sendInvitation(input)).toEqual({ status: "UNKNOWN", errorCategory: "INVALID_RESPONSE" });
  });
});
