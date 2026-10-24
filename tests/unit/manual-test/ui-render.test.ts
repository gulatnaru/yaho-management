import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ManualTestLayout, { metadata } from "@/app/(manual-test)/manual-test/layout";
import ManualTestAdminPage from "@/app/(manual-test)/manual-test/admin/page";
import ManualTestAdminClient from "@/app/(manual-test)/manual-test/admin/admin-client";
import { requireAdminPrincipal } from "@/lib/auth/authorization";
vi.mock("@/lib/auth/authorization", () => ({ requireAdminPrincipal: vi.fn() }));
import ManualTestReservationPage from "@/app/(manual-test)/manual-test/reserve/page";

describe("manual TEST page initial rendering", () => {
  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => vi.unstubAllGlobals());

  it("marks admin and customer initial/loading views as synthetic TEST without database access", () => {
    for (const page of [ManualTestAdminClient, ManualTestReservationPage]) {
      const html = renderToStaticMarkup(React.createElement(ManualTestLayout, null, React.createElement(page)));
      expect(html).toContain("TEST ENVIRONMENT");
      expect(html).toContain("ISOLATED TEST DATA");
      expect(html).toContain("SYNTHETIC DATA ONLY");
      expect(html).toContain("Never enter real customer information");
      expect(html).not.toContain("name=\"phone\"");
      expect(html).not.toContain("name=\"guardianName\"");
    }
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });

  it("checks ADMIN authorization before returning any test controls", async () => {
    vi.mocked(requireAdminPrincipal).mockRejectedValueOnce(new Error("ADMIN_REQUIRED"));
    await expect(ManualTestAdminPage()).rejects.toThrow("ADMIN_REQUIRED");
    vi.mocked(requireAdminPrincipal).mockResolvedValueOnce({ role: "ADMIN" } as Awaited<ReturnType<typeof requireAdminPrincipal>>);
    const page = await ManualTestAdminPage();
    expect(page.type).toBe(ManualTestAdminClient);
    expect(requireAdminPrincipal).toHaveBeenCalledTimes(2);
  });

  it("starts with ADMIN cookie auth and labels the customer loading state", () => {
    const admin = renderToStaticMarkup(React.createElement(ManualTestAdminClient));
    expect(admin).toContain("Start TEST as ADMIN");
    expect(admin).not.toContain('type="password"');
    const reserve = renderToStaticMarkup(React.createElement(ManualTestReservationPage));
    expect(reserve).toContain("TEST reservation form");
    expect(reserve).toContain('role="status"');
    expect(reserve).toContain("Processing test request");
  });
});
