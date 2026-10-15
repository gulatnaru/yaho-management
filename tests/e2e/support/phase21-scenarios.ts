import { randomUUID } from "node:crypto";
import {
  AiDenied,
  SYNTHETIC_UTTERANCES,
  type Scenario,
  type Scope,
} from "@/lib/ai-consultations/contracts";
export type Phase21SubjectIndex = 0 | 1 | 2;
/** Trusted manifest selection, never a caller-supplied customer ID or reduced/rehashed scope. */
export function syntheticSkill(
  scope: Scope,
  scenario: Scenario = "PROGRAMS",
  requestId: string = randomUUID(),
  subjectIndex: Phase21SubjectIndex = 0,
) {
  const subject = scope.manifest.subjectIds[subjectIndex];
  if (!subject || ![0, 1, 2].includes(subjectIndex)) throw new AiDenied();
  return {
    version: "2.0" as const,
    userRequest: {
      utterance: SYNTHETIC_UTTERANCES[scenario],
      user: { id: subject },
    },
    action: { params: { scenario, requestId } },
  };
}
export function phase21RequestScenarios(scope: Scope) {
  return {
    http: syntheticSkill(scope, "PROGRAMS", randomUUID(), 0),
    duplicate: syntheticSkill(scope, "PROGRAMS", randomUUID(), 1),
    lastQuota: [
      syntheticSkill(scope, "PROGRAMS", randomUUID(), 2),
      syntheticSkill(scope, "PROGRAMS", randomUUID(), 2),
    ] as const,
  };
}
export type BucketEvidence = {
  bucketKey: string;
  accepted: number;
  usedCalls: number;
  reservedCalls: number;
};
export function globalBucketDelta(
  before: BucketEvidence[],
  after: BucketEvidence[],
  key: string,
) {
  if (!key.startsWith("global-")) throw new AiDenied();
  const previous = before.find((row) => row.bucketKey === key);
  const current = after.find((row) => row.bucketKey === key);
  if (!current) throw new AiDenied();
  return {
    accepted: current.accepted - (previous?.accepted ?? 0),
    usedCalls: current.usedCalls - (previous?.usedCalls ?? 0),
    reservedCalls: current.reservedCalls - (previous?.reservedCalls ?? 0),
  };
}
