import { describe, it, expect } from "vitest";
import {
  phase21RequestScenarios,
  syntheticSkill,
  globalBucketDelta,
} from "../../e2e/support/phase21-scenarios";
import type { Scope } from "@/lib/ai-consultations/contracts";
import { manifestDigest } from "@/server/ai-consultations/runtime";
const scope: Scope = {
  runId: "preview-abcdefghijklmnopqrstuv",
  deploymentSha: "a".repeat(40),
  manifest: {
    version: 1,
    programIds: ["own-program"],
    classIds: ["own-class"],
    subjectIds: [
      "synthetic-http0001",
      "synthetic-duplicate0001",
      "synthetic-lastquota0001",
    ],
  },
};
describe("authored PostgreSQL scenario isolation", () => {
  it("uses distinct manifest subjects and distinct request keys on fresh last quota without narrowing scope", () => {
    const digest = manifestDigest(scope.manifest);
    const cases = phase21RequestScenarios(scope);
    expect(cases.http.userRequest.user.id).toBe(scope.manifest.subjectIds[0]);
    expect(cases.duplicate.userRequest.user.id).toBe(
      scope.manifest.subjectIds[1],
    );
    expect(cases.lastQuota.map((x) => x.userRequest.user.id)).toEqual([
      scope.manifest.subjectIds[2],
      scope.manifest.subjectIds[2],
    ]);
    expect(cases.lastQuota[0].action.params.requestId).not.toBe(
      cases.lastQuota[1].action.params.requestId,
    );
    expect(manifestDigest(scope.manifest)).toBe(digest);
    expect(() =>
      syntheticSkill(scope, "PROGRAMS", undefined, 3 as never),
    ).toThrow();
  });
  it("global assertions use baseline deltas instead of assuming no previous HTTP usage", () => {
    const before = [
      {
        bucketKey: "global-day:2026-10-15",
        accepted: 7,
        usedCalls: 5,
        reservedCalls: 2,
      },
    ];
    const after = [
      {
        bucketKey: "global-day:2026-10-15",
        accepted: 9,
        usedCalls: 6,
        reservedCalls: 4,
      },
    ];
    expect(globalBucketDelta(before, after, before[0].bucketKey)).toEqual({
      accepted: 2,
      usedCalls: 1,
      reservedCalls: 2,
    });
    expect(() => globalBucketDelta(before, after, "subject:other")).toThrow();
  });
});
