import { ServiceDenied, skillReply } from "./contracts";
/**
 * BUILD approval is deliberately not a deployment capability. No env flag, user
 * payload, synthetic marker or NODE_ENV can enable these public entry points.
 * Replacing this lock requires a separately reviewed operational approval change.
 */
export function assertDeploymentApproved(): never { throw new ServiceDenied(); }
export function disabledResponse() {
    return Response.json(skillReply(), { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
