import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const schema = readFileSync(resolve("prisma/schema.prisma"), "utf8");
const migration = readFileSync(resolve("prisma/migrations/20261028090000_notification_dispatch_guard/migration.sql"), "utf8");
describe("notification migration file contract (no database)", () => {
  it("declares the six selected auxiliary models", () => {
    for (const model of ["NotificationRecipientRegistration", "NotificationDispatch", "NotificationAudit", "NotificationBudgetPeriod", "NotificationCostReservation", "NotificationRuntimeConfig"]) expect(schema).toMatch(new RegExp(`model ${model} \\{`));
    expect(schema).not.toMatch(/model NotificationDispatchAttempt\s*\{/);
  });
  it("declares persistent slot constraints and non-cascading references", () => {
    expect(migration).toContain('"sequence" BETWEEN 1 AND 5');
    expect(migration).toContain('"notification_one_unresolved_slot"');
    expect(migration).toMatch(/FOREIGN KEY \("dispatchId"\) REFERENCES "NotificationDispatch"\("id"\) ON DELETE RESTRICT/);
    expect(migration).toMatch(/FOREIGN KEY \("recipientId"\) REFERENCES "NotificationRecipientRegistration"\("id"\) ON DELETE RESTRICT/);
  });
  it("declares distinct cost kinds, nullable purged amounts and immutable markers", () => {
    for (const kind of ["SEND_SLOT", "LOOKUP_COST", "COST_CORRECTION"]) expect(migration).toContain(`'${kind}'`);
    expect(schema).toMatch(/sequence Int\?/);
    expect(schema).toMatch(/reservedMilliKrw BigInt\?/);
    expect(migration).toContain('"costSummaryPurgedAt" IS NOT NULL');
    expect(migration).toContain('"reservedMilliKrw" IS NULL AND "confirmedMilliKrw" IS NULL AND "adjustmentMilliKrw" IS NULL');
    expect(migration).toContain('CREATE TRIGGER notification_cost_immutable_update');
    expect(migration).toContain('FOREIGN KEY ("dispatchId", "sourceSlotId")');
    expect(migration).toContain('WHERE "entryKind" = \'SEND_SLOT\' AND "status" IN');
  });
});
