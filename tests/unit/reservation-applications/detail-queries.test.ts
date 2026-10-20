import { beforeEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
vi.stubGlobal("React", React);
import { renderToStaticMarkup } from "react-dom/server";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), transaction: vi.fn(), submission: vi.fn(), children: vi.fn(), raw: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: mocks.auth }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock("@/app/(admin)/reservation-applications/submissions/[id]/deposit-form", () => ({ DepositForm: () => null }));
vi.mock("@/app/(admin)/reservation-applications/submissions/[id]/confirmation-form", () => ({ SubmissionConfirmationForm: () => null }));
import { applicationReviewHref, getApplicationWorkflowDetail, resolveApplicationFocus, WORKFLOW_APPLICATION_SELECT } from "@/lib/reservation-applications/detail-queries";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { ApplicationRelatedRecords, ApplicationReviewCard } from "@/app/(admin)/reservation-applications/_components/application-review-card";
import ApplicationSubmissionPage from "@/app/(admin)/reservation-applications/submissions/[id]/page";
import { LedgerSummary } from "@/app/(admin)/reservation-applications/_components/ledger-summary";
const date = new Date("2026-01-01T00:00:00Z");
const application = (id: string, status = "SUBMITTED") => ({
  id, submissionId: "s1", status, quotedAmount: 10000, childName: "합성 아이", childBirthDate: date, childGender: "UNSPECIFIED",
  guardianName: null, guardianPhone: null, guardianRelationship: null, requestNote: "ORIGINAL_ALLERGY_REQUEST", requestedChildId: "ch1", requestedChildPurgedAt: null,
  privacyConsentAgreed: true, programTermsAcknowledged: true, legalGuardianConfirmed: true, refundTermsAcknowledged: true,
  photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, consentVersion: APPLICATION_CONSENT_CONTENT.version,
  submittedAt: date, depositConfirmedAt: null, depositConfirmedBy: null, resolvedAt: null, resolvedBy: null, resolutionNote: null,
  personalDataPurgedAt: null, personalDataPurgedBy: null, childId: null, child: null, reservationId: null, reservation: null, paymentMapping: null,
  classScheduleId: "c1", classSchedule: { id: "c1", startsAt: date, endsAt: date, location: "합성 장소", status: "SCHEDULED", program: { name: "합성 프로그램" } },
});
const submission = () => ({ id: "s1", guardianName: "합성 보호자", guardianPhone: "01000000000", guardianRelationship: "MOTHER", declaredPayerName: "합성 입금자", submittedAt: date, depositNotifiedAt: null, personalDataPurgedAt: null, applications: [application("a1"), application("a2", "REJECTED")], deposits: [], returnObligations: [] });
beforeEach(() => {
  vi.resetAllMocks(); mocks.auth.mockResolvedValue({ role: "ADMIN" }); mocks.submission.mockResolvedValue(submission());
  mocks.children.mockResolvedValue([{ id: "ch1", name: "합성 아이", birthDate: date, gender: "UNSPECIFIED" }]); mocks.raw.mockResolvedValue([]);
  mocks.transaction.mockImplementation((fn) => fn({ reservationApplicationSubmission: { findUnique: mocks.submission }, child: { findMany: mocks.children }, $queryRaw: mocks.raw }));
});
describe("ADMIN family detail query", () => {
  it.each(["MANAGER", "TEACHER", "anonymous"])("rejects %s before all DB access", async (role) => {
    mocks.auth.mockRejectedValue(new Error(role)); await expect(getApplicationWorkflowDetail("s1", "a1")).rejects.toThrow(role);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.submission).not.toHaveBeenCalled(); expect(mocks.children).not.toHaveBeenCalled(); expect(mocks.raw).not.toHaveBeenCalled();
  });
  it("authenticates before a bounded submission read, loads every sibling and batches exact candidate identities", async () => {
    const result = await getApplicationWorkflowDetail("s1", "a2");
    expect(mocks.auth.mock.invocationCallOrder[0]).toBeLessThan(mocks.transaction.mock.invocationCallOrder[0]!);
    expect(result?.applications.map((row) => row.status)).toEqual(["SUBMITTED", "REJECTED"]);
    expect(mocks.submission.mock.calls[0]?.[0].where).toEqual({ id: "s1" });
    expect(mocks.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(mocks.children).toHaveBeenCalledTimes(1); expect(mocks.children.mock.calls[0]?.[0].where).toMatchObject({ isActive: true, personalDataPurgedAt: null, guardianName: "합성 보호자", guardianPhone: "01000000000" });
    expect(result?.applications[0]?.reviewCandidates).toEqual([{ id: "ch1", name: "합성 아이", birthDate: date, gender: "UNSPECIFIED", isRequested: true }]);
    expect(result?.applications[0]?.confirmationCandidates).toEqual([{ id: "ch1", label: "합성 아이 · UNSPECIFIED · 기존 아이", isRequested: true }]);
    expect(result?.applications[1]?.confirmationCandidates).toEqual([]);
    expect(result?.focusedApplicationId).toBe("a2"); expect(result?.ledger).toMatchObject({ state: "available", Q: 20000, D: 0, A: 0 });
    expect(JSON.stringify(WORKFLOW_APPLICATION_SELECT)).not.toMatch(/safetyInfo|token|idempotency/);
    // Only read delegates exist on the transaction mock: auto-linking/updating is impossible.
    expect(result?.applications[0]?.childId).toBeNull(); expect(result?.applications[0]?.requestNote).toBe("ORIGINAL_ALLERGY_REQUEST");
  });
  it("keeps optional refusal normal, supplies the exact version original and never invents consent history", async () => {
    const result = (await getApplicationWorkflowDetail("s1"))!;
    const row = result.applications[0]!;
    expect(row.consentOriginal).toEqual(APPLICATION_CONSENT_CONTENT); expect(row.isPurged).toBe(false); expect(row.consentHistory).toBeNull();
    const html = renderToStaticMarkup(createElement(ApplicationReviewCard, { application: row, context: {} }));
    expect(html).toContain("미동의 (정상 신청)"); expect(html).toContain("동의 문구 원문 보기"); expect(html).toContain("ORIGINAL_ALLERGY_REQUEST"); expect(html).toContain("참고용");
    expect(html).not.toContain("개인정보 파기로 동의 이력을");
    expect(html).not.toContain("결제 등록"); expect(html).not.toContain("/payments/");
  });
  it("unknown original versions and empty confirmed history are explicitly unavailable", async () => {
    const data = submission(); data.applications[0]!.consentVersion = "unknown-version";
    mocks.submission.mockResolvedValue(data);
    const row = (await getApplicationWorkflowDetail("s1"))!.applications[0]!;
    expect(row.consentOriginal).toBeNull();
    const html = renderToStaticMarkup(createElement(ApplicationReviewCard, { application: row, context: {} }));
    expect(html).toContain("이 버전의 동의 원문을 확인할 수 없습니다"); expect(html).not.toContain("동의 문구 원문 보기");
  });
  it("purged applications redact original PII, skip candidate queries, and retain independently computed retention", async () => {
    const data = submission(); mocks.submission.mockResolvedValue({ ...data, personalDataPurgedAt: date });
    const result = (await getApplicationWorkflowDetail("s1"))!;
    expect(mocks.children).not.toHaveBeenCalled(); expect(result.applications[0]).toMatchObject({ isPurged: true, childName: null, childBirthDate: null, requestNote: null, reviewCandidates: [], consentHistory: null, retention: { basis: "CLASS_DATE", retainUntil: "2027-01-01" } });
  });
  it("loads confirmed retention facts once for all linked siblings and preserves append-only decline versus revoke history", async () => {
    const data = submission();
    const history = [{ id: "h1", consentType: "PHOTO_SHARE", action: "DECLINED", recordedAt: date, consentVersion: "v1" }, { id: "h2", consentType: "PHOTO_MARKETING", action: "REVOKED", recordedAt: date, consentVersion: "v2" }];
    mocks.submission.mockResolvedValue({ ...data, applications: data.applications.map((row) => ({ ...row, status: "CONFIRMED", childId: "ch1", child: { id: "ch1", name: "합성 아이", consents: history } })) });
    mocks.raw.mockResolvedValue([{ id: "ch1", lastReservedClassAt: new Date("2028-01-01"), latestConfirmedClassAt: date }]);
    const result = (await getApplicationWorkflowDetail("s1"))!;
    expect(mocks.raw).toHaveBeenCalledTimes(1); expect(result.applications[0]?.retention).toMatchObject({ basis: "LAST_RESERVED_CLASS_DATE", retainUntil: "2033-01-01" });
    expect(result.applications[0]?.consentHistory?.map((row) => row.action)).toEqual(["DECLINED", "REVOKED"]);
    const html = renderToStaticMarkup(createElement(ApplicationReviewCard, { application: result.applications[0]!, context: {} })); expect(html).toContain("미동의 (정상 신청)"); expect(html).toContain("철회");
  });
  it.each([null, 0, -1])("invalid modern quote %s yields error guidance, never a normal available balance", async (quotedAmount) => {
    const data = submission(); mocks.submission.mockResolvedValue({ ...data, applications: [{ ...data.applications[0], quotedAmount }] });
    const result = (await getApplicationWorkflowDetail("s1"))!; expect(result.ledger).toEqual({ state: "unavailable" });
    const html = renderToStaticMarkup(createElement(LedgerSummary, { detail: result }));
    expect(html).toContain("가용액을 표시할 수 없습니다"); expect(html).not.toContain("0원");
  });
  it("shows only actual reservation/payment/refund links and keeps reservation memo distinct from original request", async () => {
    const data = submission();
    mocks.submission.mockResolvedValue({ ...data, applications: [{ ...data.applications[0], status: "CONFIRMED", childId: "ch1", reservationId: "r1", child: { id: "ch1", name: "합성 아이", consents: [] },
      reservation: { id: "r1", memo: "ADMIN_REVIEWED_MEMO", paymentItem: { id: "pi1", paymentId: "p1", refunds: [{ id: "refund1", amount: 1000, status: "COMPLETED", refundedAt: date }] } },
      paymentMapping: { id: "mapping1", paymentItem: { id: "pi1", paymentId: "p1", paidAmount: 10000 } },
    }], deposits: [{ id: "d1", amount: 10000, confirmedAt: date, depositedAt: date, payerName: "합성 입금자", confirmedBy: { name: "합성 관리자" }, allocations: [{ id: "alloc1", depositId: "d1", amount: 10000, paymentMappingId: "mapping1", returnObligationId: null, createdAt: date }] }] });
    const result = (await getApplicationWorkflowDetail("s1"))!;
    expect(result.ledger).toMatchObject({ state: "available", P: 10000, A: 0 });
    const reviewHtml = renderToStaticMarkup(createElement(ApplicationReviewCard, { application: result.applications[0]!, context: {} }));
    const relatedHtml = renderToStaticMarkup(createElement(ApplicationRelatedRecords, { applications: result.applications }));
    expect(relatedHtml).toContain('href="/reservations/r1"'); expect(relatedHtml).toContain('href="/payments/p1"');
    expect(relatedHtml).toContain("확정 후 환불 refund1"); expect(relatedHtml).toContain("예약 운영 메모: ADMIN_REVIEWED_MEMO");
    expect(relatedHtml).toContain("신청 a1"); expect(relatedHtml).not.toContain("ORIGINAL_ALLERGY_REQUEST"); expect(relatedHtml).not.toContain("/payments/new");
    expect(reviewHtml).toContain("ORIGINAL_ALLERGY_REQUEST"); expect(reviewHtml).not.toContain("ADMIN_REVIEWED_MEMO"); expect(reviewHtml).not.toContain("/payments/");
    expect(reviewHtml).toContain("연결된 아이의 동의 이력을 확인할 수 없습니다");
  });
  it("related records never invent a reservation or payment from a reference candidate", async () => {
    const result = (await getApplicationWorkflowDetail("s1"))!;
    expect(result.applications[0]?.reviewCandidates).toHaveLength(1);
    const html = renderToStaticMarkup(createElement(ApplicationRelatedRecords, { applications: result.applications }));
    expect(html).toContain("연결된 예약 없음"); expect(html).not.toContain("/reservations/"); expect(html).not.toContain("/payments/"); expect(html).not.toContain("/children/ch1");
  });
  it("server-rendered document puts related records after confirmation and before the contextual list return", async () => {
    const page = await ApplicationSubmissionPage({ params: Promise.resolve({ id: "s1" }), searchParams: Promise.resolve({ status: "all", page: "3", classScheduleId: "c1" }) });
    const html = renderToStaticMarkup(page);
    const areas = [...html.matchAll(/data-testid="(family-detail-summary|family-review|family-ledger|family-confirmation|family-related-records)"/g)].map((match) => match[1]);
    expect(areas).toEqual(["family-detail-summary", "family-review", "family-ledger", "family-confirmation", "family-related-records"]);
    expect(html.lastIndexOf("신청 목록으로")).toBeGreaterThan(html.indexOf('data-testid="family-related-records"'));
    expect(html).toContain("page=3#family-submission-s1");
  });
  it("missing family or invalid ID returns safely without touching unrelated data; DB read failures propagate", async () => {
    expect(await getApplicationWorkflowDetail("../bad")).toBeNull(); expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.submission.mockResolvedValue(null); expect(await getApplicationWorkflowDetail("missing")).toBeNull(); expect(mocks.children).not.toHaveBeenCalled();
    mocks.submission.mockRejectedValue(new Error("read-failed")); await expect(getApplicationWorkflowDetail("s1")).rejects.toThrow("read-failed");
  });
});
describe("safe family review navigation", () => {
  it.each([undefined, "", ["a1"], "other-family-child", "../a1", "<script>"])("ignores missing/foreign/invalid child %j", (input) => expect(resolveApplicationFocus(input, ["a1", "a2"])).toBeNull());
  it("preserves only list context and the child position without personal data or arbitrary returnTo", async () => {
    const url = applicationReviewHref("s1", "a1", { status: "all", classScheduleId: "c1", page: "3", guardianPhone: "secret", returnTo: "https://evil.test" });
    expect(url).toBe("/reservation-applications/submissions/s1?status=all&classScheduleId=c1&page=3&applicationId=a1#application-a1");
    const result = await getApplicationWorkflowDetail("s1", "foreign-child"); expect(result?.focusedApplicationId).toBeNull(); expect(result?.invalidApplicationFocus).toBe(true);
  });
});
