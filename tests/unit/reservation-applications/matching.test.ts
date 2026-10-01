import { describe, expect, it } from "vitest";
import { rankChildCandidates } from "@/lib/reservation-applications/candidates";
import {
  planApplicationConsentRecords,
  planOptionalConsentAction,
} from "@/lib/reservation-applications/consent-plan";
import { findDuplicateApplicationIds, toApplicantKey } from "@/lib/reservation-applications/duplicates";
import {
  buildApplicationListOrderBy,
  buildApplicationListWhere,
  parseApplicationListPage,
  parseApplicationListStatus,
} from "@/lib/reservation-applications/list";
import {
  generateApplicationLinkToken,
  isWellFormedApplicationLinkToken,
} from "@/lib/reservation-applications/token";

describe("planApplicationConsentRecords", () => {
  const none = { currentPhotoShareAction: null, currentPhotoMarketingAction: null };

  it("records privacy agreement and both optional choices, including declines", () => {
    expect(
      planApplicationConsentRecords({ photoShareConsentAgreed: false, photoMarketingConsentAgreed: false, ...none }),
    ).toEqual([
      { consentType: "PRIVACY", action: "AGREED" },
      { consentType: "PHOTO_SHARE", action: "DECLINED" },
      { consentType: "PHOTO_MARKETING", action: "DECLINED" },
    ]);
  });

  it("records agreement for opted-in optional consents", () => {
    expect(
      planApplicationConsentRecords({
        photoShareConsentAgreed: true,
        photoMarketingConsentAgreed: true,
        currentPhotoShareAction: "REVOKED",
        currentPhotoMarketingAction: "DECLINED",
      }),
    ).toEqual([
      { consentType: "PRIVACY", action: "AGREED" },
      { consentType: "PHOTO_SHARE", action: "AGREED" },
      { consentType: "PHOTO_MARKETING", action: "AGREED" },
    ]);
  });

  it("revokes an existing agreement when the latest application did not opt in", () => {
    const records = planApplicationConsentRecords({
      photoShareConsentAgreed: false,
      photoMarketingConsentAgreed: false,
      currentPhotoShareAction: "AGREED",
      currentPhotoMarketingAction: "AGREED",
    });
    expect(records).toContainEqual({ consentType: "PHOTO_SHARE", action: "REVOKED" });
    expect(records).toContainEqual({ consentType: "PHOTO_MARKETING", action: "REVOKED" });
  });

  it("uses DECLINED, not REVOKED, when there was no current agreement", () => {
    expect(planOptionalConsentAction(false, null)).toBe("DECLINED");
    expect(planOptionalConsentAction(false, "REVOKED")).toBe("DECLINED");
    expect(planOptionalConsentAction(false, "DECLINED")).toBe("DECLINED");
    expect(planOptionalConsentAction(false, "AGREED")).toBe("REVOKED");
    expect(planOptionalConsentAction(true, "AGREED")).toBe("AGREED");
  });
});

describe("duplicate applications", () => {
  it("normalizes spacing and phone formatting", () => {
    expect(toApplicantKey(" 테스트  아이 ", "010-0000-1111")).toBe(toApplicantKey("테스트 아이", "01000001111"));
  });

  it("flags pending or confirmed applications for the same child in the same class", () => {
    const duplicates = findDuplicateApplicationIds([
      { id: "a", classScheduleId: "class-1", childName: "테스트아이", guardianPhone: "010-0000-1111", status: "SUBMITTED" },
      { id: "b", classScheduleId: "class-1", childName: "테스트아이", guardianPhone: "01000001111", status: "CONFIRMED" },
      { id: "c", classScheduleId: "class-2", childName: "테스트아이", guardianPhone: "010-0000-1111", status: "SUBMITTED" },
      { id: "d", classScheduleId: "class-1", childName: "테스트아이", guardianPhone: "010-0000-1111", status: "REJECTED" },
      { id: "e", classScheduleId: "class-1", childName: "다른아이", guardianPhone: "010-0000-1111", status: "SUBMITTED" },
    ]);
    expect([...duplicates].sort()).toEqual(["a", "b"]);
  });
});

describe("rankChildCandidates", () => {
  const base = { birthDate: null, guardianName: null, isActive: true };

  it("keeps name or phone matches and ranks both-match first", () => {
    const ranked = rankChildCandidates(
      [
        { ...base, id: "phone-only", name: "형제아이", guardianPhone: "010-0000-1111" },
        { ...base, id: "none", name: "무관아이", guardianPhone: "010-9999-9999" },
        { ...base, id: "both", name: "테스트아이", guardianPhone: "01000001111" },
        { ...base, id: "name-only", name: "테스트아이", guardianPhone: null },
      ],
      { childName: "테스트아이", guardianPhone: "010-0000-1111" },
    );

    expect(ranked.map((candidate) => candidate.id)).toEqual(["both", "name-only", "phone-only"]);
    expect(ranked[0]).toMatchObject({ matchesName: true, matchesPhone: true });
  });
});

describe("application list parameters", () => {
  it("defaults to pending applications and ignores unknown values", () => {
    expect(parseApplicationListStatus(undefined)).toBe("SUBMITTED");
    expect(parseApplicationListStatus("unknown")).toBe("SUBMITTED");
    expect(parseApplicationListStatus("all")).toBe("all");
    expect(parseApplicationListStatus("REJECTED")).toBe("REJECTED");
    expect(parseApplicationListPage("0")).toBe(1);
    expect(parseApplicationListPage("abc")).toBe(1);
    expect(parseApplicationListPage("3")).toBe(3);
  });

  it("filters by status and sorts pending work by the nearest class", () => {
    expect(buildApplicationListWhere("all")).toEqual({});
    expect(buildApplicationListWhere("CONFIRMED")).toEqual({ status: "CONFIRMED" });
    expect(buildApplicationListOrderBy("SUBMITTED")[0]).toEqual({ classSchedule: { startsAt: "asc" } });
    expect(buildApplicationListOrderBy("all")[0]).toEqual({ submittedAt: "desc" });
  });
});

describe("application link tokens", () => {
  it("generates unguessable url-safe tokens that satisfy the DB length check", () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateApplicationLinkToken()));
    expect(tokens.size).toBe(20);
    for (const token of tokens) {
      expect(token).toHaveLength(32);
      expect(isWellFormedApplicationLinkToken(token)).toBe(true);
    }
  });

  it("rejects malformed tokens before any lookup", () => {
    expect(isWellFormedApplicationLinkToken("short")).toBe(false);
    expect(isWellFormedApplicationLinkToken("a".repeat(31))).toBe(false);
    expect(isWellFormedApplicationLinkToken(`${"a".repeat(31)}/`)).toBe(false);
  });
});
