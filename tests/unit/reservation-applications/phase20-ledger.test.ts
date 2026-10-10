import { describe, expect, it } from "vitest";
import { allocateFifo, availableDepositAmount, validateLedgerAllocations } from "@/lib/reservation-applications/ledger";
import { applicationPriceSchema, depositInputSchema, groupSubmissionSchema, MAX_POSTGRES_INTEGER, parseKstDateTime, reservationApplicationSettingsSchema, returnInputSchema } from "@/lib/reservation-applications/phase20-validation";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";

describe("Phase 20 quoted price and capability validation", () => {
  it("allows only positive whole-KRW class prices and keeps a raw capability out of persistence helpers", () => {
    expect(applicationPriceSchema.safeParse(1).success).toBe(true);
    expect(applicationPriceSchema.safeParse(0).success).toBe(false);
    expect(applicationPriceSchema.safeParse(1.5).success).toBe(false);
    expect(applicationPriceSchema.safeParse(MAX_POSTGRES_INTEGER + 1).success).toBe(false);
    expect(hashApplicationCapabilityToken("token-value")).not.toContain("token-value");
  });

  it("parses only real past KST datetime-local values and enforces integer financial limits", () => {
    const cutoff = new Date("2026-10-06T00:00:00.000Z");
    expect(parseKstDateTime("2026-10-06T09:00", cutoff)?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
    expect(parseKstDateTime("2026-02-30T09:00", cutoff)).toBeNull();
    expect(parseKstDateTime("2026-10-06T24:00", cutoff)).toBeNull();
    expect(parseKstDateTime("2026-10-06T09:01", cutoff)).toBeNull();
    expect(depositInputSchema.safeParse({ amount: MAX_POSTGRES_INTEGER + 1, payerName: "입금자", depositedAt: "2020-01-01T09:00" }).success).toBe(false);
    expect(returnInputSchema.safeParse({ amount: 1, reason: "반환", returnedAt: "2999-01-01T09:00", idempotencyKey: "return-idempotency-key-0001" }).success).toBe(false);
  });

  it("requires guardian and current consent per submitted child", () => {
    const result = groupSubmissionSchema.safeParse({
      guardianName: "테스트 보호자", guardianPhone: "010-1234-5678", guardianRelationship: "MOTHER", declaredPayerName: "테스트입금자",
      children: [{ classScheduleId: "class-1", childName: "테스트 아이", childBirthDate: "2020-01-01", childGender: "UNSPECIFIED", programTerms: true, privacyConsent: true, legalGuardianConfirmation: true, refundTerms: true, photoShareConsent: false, photoMarketingConsent: false }],
    });
    expect(result.success).toBe(true);
    expect(reservationApplicationSettingsSchema.safeParse({ bankName: "은행", accountNumber: "1", accountHolder: "예금주", blogUrl: "https://blog.example.test", instagramUrl: "https://instagram.example.test", kakaoChannelUrl: "https://kakao.example.test" }).success).toBe(true);
  });
});

describe("Phase 20 pre-reservation ledger", () => {
  const deposits = [
    { id: "d1", amount: 10_000, confirmedAt: new Date("2026-10-01T01:00:00.000Z") },
    { id: "d2", amount: 20_000, confirmedAt: new Date("2026-10-02T01:00:00.000Z") },
  ];

  it("uses verified deposits FIFO and leaves excess outside Payment", () => {
    const allocations = [{ depositId: "d1", amount: 8_000, paymentMappingId: "map-1", returnObligationId: null }];
    expect(availableDepositAmount(deposits, allocations)).toBe(22_000);
    expect(allocateFifo(deposits, allocations, 15_000)).toEqual([{ depositId: "d1", amount: 2_000 }, { depositId: "d2", amount: 13_000 }]);
  });

  it("rejects double target, overdraw and incomplete return obligation allocations", () => {
    expect(() => validateLedgerAllocations(deposits, [{ depositId: "d1", amount: 1, paymentMappingId: "p", returnObligationId: "r" }], [])).toThrow("invalid allocation target");
    expect(() => validateLedgerAllocations(deposits, [{ depositId: "d1", amount: 10_001, paymentMappingId: "p", returnObligationId: null }], [])).toThrow("deposit overdrawn");
    expect(() => validateLedgerAllocations(deposits, [{ depositId: "d1", amount: 100, paymentMappingId: null, returnObligationId: "r" }], [{ id: "r", amount: 200, returnedAmount: 0 }])).toThrow("return obligation is not fully funded");
  });
});
