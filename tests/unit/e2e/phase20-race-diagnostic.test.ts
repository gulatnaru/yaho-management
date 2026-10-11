import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import {
  classifyPhase20RaceOutcome,
  PHASE20_RACE_OUTCOME,
} from "@/tests/e2e/support/phase20-race-diagnostic";

const rejected = (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason });

describe("Phase 20 PostgreSQL race diagnostic", () => {
  it("classifies interactive transaction and unknown Prisma requests without exposing their messages", () => {
    const secret = "postgres://private-token@example.invalid/hidden";
    const interactive = new Prisma.PrismaClientKnownRequestError(secret, { code: "P2028", clientVersion: "test" });
    const unknown = new Prisma.PrismaClientUnknownRequestError(secret, { clientVersion: "test" });
    const outcomes = [classifyPhase20RaceOutcome(rejected(interactive)), classifyPhase20RaceOutcome(rejected(unknown))];

    expect(outcomes).toEqual([PHASE20_RACE_OUTCOME.PRISMA_P2028, PHASE20_RACE_OUTCOME.PRISMA_UNKNOWN_REQUEST]);
    expect(JSON.stringify(outcomes)).not.toContain(secret);
  });

  it("uses only allowlisted P2010 SQLSTATE codes and never returns raw query metadata", () => {
    const secret = "select * from Child where guardian_phone = 'private'";
    const allowlisted = new Prisma.PrismaClientKnownRequestError(secret, {
      code: "P2010",
      clientVersion: "test",
      meta: { code: "42P01", message: secret },
    });
    const unallowlisted = new Prisma.PrismaClientKnownRequestError(secret, {
      code: "P2010",
      clientVersion: "test",
      meta: { code: "XX000", message: secret },
    });
    const outcomes = [classifyPhase20RaceOutcome(rejected(allowlisted)), classifyPhase20RaceOutcome(rejected(unallowlisted))];

    expect(outcomes).toEqual([PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_42P01, PHASE20_RACE_OUTCOME.PRISMA_P2010]);
    expect(JSON.stringify(outcomes)).not.toContain(secret);
  });

  it("treats inherited object property names in untrusted P2010 metadata as unallowlisted", () => {
    const secret = "postgres://private-token@example.invalid/untrusted-metadata";
    const inheritedPropertyCodes = ["toString", "__proto__"];
    const outcomes = inheritedPropertyCodes.map((code) => classifyPhase20RaceOutcome(rejected(new Prisma.PrismaClientKnownRequestError(secret, {
      code: "P2010",
      clientVersion: "test",
      meta: { code, message: secret },
    }))));

    expect(outcomes).toEqual([PHASE20_RACE_OUTCOME.PRISMA_P2010, PHASE20_RACE_OUTCOME.PRISMA_P2010]);
    expect(JSON.stringify(outcomes)).not.toContain(secret);
  });
});
