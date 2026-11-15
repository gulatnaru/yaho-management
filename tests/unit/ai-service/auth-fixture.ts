import { authenticateSkillContext } from "@/server/ai-service/transport";
import type { Environment } from "@/server/ai-service/contracts";

/** Issues real server-side authentication evidence for ledger-only unit tests. */
export function claimAuth(environment: Environment = "PREVIEW") {
    const prod = "synthetic-unit-claim-secret-0123456789abcdef";
    return authenticateSkillContext(new Headers({ "x-yaho-skill-key": prod }), { prod }, environment);
}
