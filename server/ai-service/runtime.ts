import { ServiceDenied, skillReply } from "./contracts";
/** Retained for unrelated entry points whose operational lock remains closed. */
export function assertDeploymentApproved(): never { throw new ServiceDenied(); }
export function assertPreviewEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): void {
    if (env.VERCEL_ENV !== "preview") throw new ServiceDenied();
}
export function assertAdminEnabled(env: Readonly<Record<string, string | undefined>> = process.env): void {
    assertPreviewEnvironment(env);
    if (env.AI_SERVICE_ADMIN_ENABLED !== "true") throw new ServiceDenied();
}
export function assertSyntheticSkillEnabled(env: Readonly<Record<string, string | undefined>> = process.env): void {
    assertPreviewEnvironment(env);
    if (env.AI_SERVICE_SYNTHETIC_ENABLED !== "true") throw new ServiceDenied();
}
export function disabledResponse() {
    return Response.json(skillReply(), { status: 503, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
