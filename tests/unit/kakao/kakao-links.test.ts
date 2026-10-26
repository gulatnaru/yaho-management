import { describe, expect, it } from "vitest";
import { adminSubmissionPath, adminSubmissionUrl, applyPath, applyUrl, channelChatUrl, shareTextForReservationEvent } from "@/lib/kakao/links";

describe("Kakao links", () => {
  it("encodes customer tokens and builds absolute root routes from an explicit origin", () => {
    expect(applyPath("synthetic-token/with space?fragment#")).toBe("/apply/synthetic-token%2Fwith%20space%3Ffragment%23");
    expect(applyUrl("https://synthetic-site.example.test/synthetic-base", "synthetic-token")).toBe("https://synthetic-site.example.test/apply/synthetic-token");
    expect(applyUrl("http://synthetic-site.example.test", "synthetic-token")).toBe("http://synthetic-site.example.test/apply/synthetic-token");
  });

  it("keeps ADMIN submission URLs distinct from customer application URLs", () => {
    expect(adminSubmissionPath("synthetic-submission/id")).toBe("/reservation-applications/submissions/synthetic-submission%2Fid");
    expect(adminSubmissionUrl("https://synthetic-site.example.test", "synthetic-submission")).toBe("https://synthetic-site.example.test/reservation-applications/submissions/synthetic-submission");
    expect(adminSubmissionPath("synthetic-submission")).not.toBe(applyPath("synthetic-submission"));
    expect(adminSubmissionPath("synthetic-submission")).not.toContain("(admin)");
  });

  it.each(["", " ", ".", "..", "\ud800"])("rejects invalid path input %j with a generic Error", (value) => {
    expect(() => applyPath(value)).toThrow(Error);
    expect(() => applyUrl("https://synthetic-site.example.test", value)).toThrow("Invalid link identifier.");
    expect(() => adminSubmissionPath(value)).toThrow("Invalid link identifier.");
    expect(() => adminSubmissionUrl("https://synthetic-site.example.test", value)).toThrow("Invalid link identifier.");
  });

  it.each(["", "synthetic-invalid", "/synthetic-relative", "ftp://synthetic-site.example.test", "javascript:synthetic-invalid", "https://synthetic-user@synthetic-site.example.test"])("rejects invalid base URL %j", (value) => {
    expect(() => applyUrl(value, "synthetic-token")).toThrow("Invalid base URL.");
    expect(() => adminSubmissionUrl(value, "synthetic-submission")).toThrow("Invalid base URL.");
  });

  it("preserves configured HTTPS channel links and fails closed for other values", () => {
    const channel = "https://synthetic-channel.example.test/synthetic-chat";
    expect(channelChatUrl(channel)).toBe(channel);
    for (const value of ["", "synthetic-invalid", "/synthetic-channel", "http://synthetic-channel.example.test", "https://synthetic-user@synthetic-channel.example.test"]) {
      expect(channelChatUrl(value)).toBeNull();
    }
  });
});

describe("reservation event share text", () => {
  const labels = { programLabel: "synthetic-program", classLabel: "synthetic-class", scheduleText: "synthetic-schedule", statusLabel: "synthetic-status" };
  it.each([
    ["application.received", "예약 신청이 접수되었습니다."],
    ["application.confirmed", "예약 신청이 확정되었습니다."],
    ["application.changed", "예약 신청이 변경되었습니다."],
    ["application.cancelled", "예약 신청이 취소되었습니다."],
  ] as const)("uses only non-PII labels for %s", (event, heading) => {
    expect(shareTextForReservationEvent({ event, ...labels })).toBe(`${heading}\nsynthetic-program · synthetic-class\nsynthetic-schedule\nsynthetic-status`);
  });

  it("allows a program label without a separate class label and bounds text length", () => {
    expect(shareTextForReservationEvent({ ...labels, event: "application.received", classLabel: undefined })).not.toContain(" · ");
    const long = "synthetic-label".repeat(50);
    expect(Array.from(shareTextForReservationEvent({ event: "application.received", programLabel: long, classLabel: long, scheduleText: long, statusLabel: long })).length).toBeLessThan(320);
  });

  it("rejects extra customer/financial/identifier fields instead of accepting an application object", () => {
    for (const field of ["childName", "guardianName", "phone", "amount", "token", "submissionId"]) {
      expect(() => shareTextForReservationEvent({ event: "application.received", ...labels, [field]: "synthetic-forbidden" })).toThrow("Invalid reservation share text.");
    }
    expect(() => shareTextForReservationEvent({ event: "application.received", ...labels, scheduleText: " " })).toThrow("Invalid reservation share text.");
  });
});
