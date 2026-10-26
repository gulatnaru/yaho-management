import { describe, expect, it } from "vitest";
import { buildAdminShareFeed, buildCustomerShareFeed, buildReservationShareFeed } from "@/lib/kakao/share";

const adminUrl = "https://synthetic.example.test/reservation-applications/submissions/synthetic-id";
const customerUrl = "https://synthetic.example.test/apply/synthetic-public-id";

describe("fixed-copy admin/customer feed boundaries", () => {
  it("puts only the ADMIN submission URL in the admin feed with an admin-only marker", () => {
    const feed = buildAdminShareFeed(adminUrl);
    expect(feed.content.link).toEqual({ mobileWebUrl: adminUrl, webUrl: adminUrl });
    expect(feed.content.title).toContain("관리자 전용");
    expect(feed.content.description).toContain("관리자 전용");
    expect(feed.content.description).toContain("관리자(ADMIN)");
    expect(JSON.stringify(feed)).toContain("/reservation-applications/submissions/");
    expect(JSON.stringify(feed)).not.toContain("/apply/");
    expect(feed).toEqual(buildReservationShareFeed({ title: feed.content.title, description: feed.content.description, linkUrl: adminUrl }));
  });

  it("puts only the application URL and generic fixed copy in the customer feed", () => {
    const feed = buildCustomerShareFeed(customerUrl);
    expect(feed.content.link).toEqual({ mobileWebUrl: customerUrl, webUrl: customerUrl });
    expect(JSON.stringify(feed)).toContain("/apply/");
    expect(JSON.stringify(feed)).not.toContain("/reservation-applications/submissions/");
    expect(feed.content.title).not.toContain("관리자");
    expect(feed).toEqual(buildReservationShareFeed({ title: feed.content.title, description: feed.content.description, linkUrl: customerUrl }));
  });

  it("rejects customer URLs passed to the admin builder", () => {
    expect(() => buildAdminShareFeed(customerUrl)).toThrow("Invalid share destination.");
  });

  it("rejects admin URLs passed to the customer builder", () => {
    expect(() => buildCustomerShareFeed(adminUrl)).toThrow("Invalid share destination.");
  });

  it("rejects other route kinds instead of constructing a mislabeled feed", () => {
    for (const value of ["https://synthetic.example.test/", "https://synthetic.example.test/apply/", "https://synthetic.example.test/reservation-applications/submissions/"]) {
      expect(() => buildAdminShareFeed(value)).toThrow("Invalid share destination.");
      expect(() => buildCustomerShareFeed(value)).toThrow("Invalid share destination.");
    }
  });

  it("rejects private query or fragment data in either wrapper", () => {
    for (const suffix of ["?phone=synthetic-private", "#guardianName=synthetic-private", "?token=synthetic-private", "?amount=synthetic-private"]) {
      expect(() => buildAdminShareFeed(`${adminUrl}${suffix}`)).toThrow("Invalid share destination.");
      expect(() => buildCustomerShareFeed(`${customerUrl}${suffix}`)).toThrow("Invalid share destination.");
    }
  });

  it("retains the existing builder's HTTPS and credential-free destination validation", () => {
    expect(() => buildAdminShareFeed(adminUrl.replace("https:", "http:"))).toThrow("Invalid reservation share feed.");
    expect(() => buildCustomerShareFeed(customerUrl.replace("https:", "http:"))).toThrow("Invalid reservation share feed.");
    expect(() => buildAdminShareFeed(adminUrl.replace("https://", "https://synthetic-user@"))).toThrow("Invalid reservation share feed.");
    expect(() => buildCustomerShareFeed(customerUrl.replace("https://", "https://synthetic-user@"))).toThrow("Invalid reservation share feed.");
  });

  it("contains no new PII keys or synthetic private probe values in either feed", () => {
    const json = JSON.stringify([buildAdminShareFeed(adminUrl), buildCustomerShareFeed(customerUrl)]);
    const negativeProbes = {
      phone: "synthetic-phone-value", guardianName: "synthetic-guardian-value",
      childName: "synthetic-child-value", token: "synthetic-private-value", amount: "synthetic-financial-value",
    };
    for (const [field, value] of Object.entries(negativeProbes)) {
      expect(json).not.toContain(field);
      expect(json).not.toContain(value);
    }
    expect(Object.keys(buildAdminShareFeed(adminUrl))).toEqual(["objectType", "content"]);
    expect(Object.keys(buildCustomerShareFeed(customerUrl))).toEqual(["objectType", "content"]);
  });
});
