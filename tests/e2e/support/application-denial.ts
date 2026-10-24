import { expect, type Page } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

/** Synthetic fixture values only; no protected value is included in assertion output. */
export async function applicationPrivateValues(db: PrismaClient, submissionId: string) {
  const family = await db.reservationApplicationSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    select: {
      guardianName: true, guardianPhone: true, declaredPayerName: true,
      applications: { select: { childName: true, requestNote: true, resolutionNote: true } },
      group: { select: { links: { select: { token: true, tokenHash: true } } } },
    },
  });
  return [family.guardianName, family.guardianPhone, family.declaredPayerName,
    ...family.applications.flatMap((row) => [row.childName, row.requestNote, row.resolutionNote]),
    ...(family.group?.links.flatMap((row) => [row.token, row.tokenHash]) ?? []),
  ].filter((value): value is string => Boolean(value));
}

/** A streamed Next.js notFound may be HTTP 200; its UI and payload must still deny access. */
export async function assertApplicationNotFound(page: Page, path: string, protectedValues: readonly string[] = []) {
  const response = await page.goto(path);
  expect(response).not.toBeNull();
  expect([200, 404]).toContain(response!.status());
  expect(response!.request().redirectedFrom()).toBeNull();
  const expected = new URL(path, page.url());
  await expect(page).toHaveURL((url) => url.pathname === expected.pathname && url.search === expected.search);
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "This page could not be found.", exact: true })).toBeVisible();

  const markers = ["family-detail-summary", "family-review", "application-review-card", "review-consents", "application-consents", "family-ledger", "detail-ledger", "deposit-transaction-form", "confirmation-selection-form", "family-application-card", "return-obligation-"];
  for (const marker of markers) await expect(page.locator(`[data-testid^="${marker}"]`)).toHaveCount(0);

  const rsc = await page.request.get(path, { headers: { RSC: "1" }, maxRedirects: 0 });
  expect([200, 404]).toContain(rsc.status());
  for (const payload of [await response!.text(), await rsc.text()]) {
    for (const marker of markers) expect(payload.includes(marker)).toBe(false);
    for (const value of protectedValues) expect(payload.includes(value)).toBe(false);
    // Check the serialized data shape as well as fixture sentinels, including escaped HTML RSC.
    expect(/\\?"(?:guardianName|guardianPhone|declaredPayerName|childName|childBirthDate|quotedAmount|token|tokenHash|applicationPrice|returnedAmount|consentVersion|privacyConsentAgreed|photoShareConsentAgreed|photoMarketingConsentAgreed|pendingFamilyCount|ledger|allocations|deposits|returnObligations|paymentMapping|paidAmount|refundedAmount|capacity|reservedCount)\\?"\s*:/.test(payload)).toBe(false);
    // Single-letter keys also exist in the RSC protocol (e.g. P:null); reject
    // numeric ledger projections without mistaking those protocol fields for money.
    expect(/\\?"(?:Q|D|A|P|R|T)\\?"\s*:\s*-?\d/.test(payload)).toBe(false);
  }
}
