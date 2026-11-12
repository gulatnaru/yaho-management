import { ServiceDenied, environmentSchema, type Actor, type Environment } from "./contracts";
import type { Database } from "./repository";
export type GuidanceAdminContext = {
    db: Database;
    environment: "PREVIEW";
    actor: Actor;
};
/**
 * Approved-guidance registration context (OQ-16). Deliberately separate from
 * adminContext(): it never calls assertDeploymentApproved(), never reads
 * encryption keys, and only ever yields the PREVIEW environment. The caller
 * is an authenticated ADMIN session (requireAdminPrincipal), never an
 * email match or a synthetic actor.
 */
export async function guidanceAdminContext(): Promise<GuidanceAdminContext> {
    const { requireAdminPrincipal } = await import("@/lib/auth/authorization");
    const actor = await requireAdminPrincipal();
    let environment: Environment;
    try {
        environment = environmentSchema.parse(process.env.VERCEL_ENV === "preview" ? "PREVIEW" : process.env.VERCEL_ENV === "production" ? "PRODUCTION" : null);
    } catch {
        throw new ServiceDenied();
    }
    if (environment !== "PREVIEW")
        throw new ServiceDenied();
    const { prisma } = await import("@/lib/db/prisma");
    return { db: prisma, environment, actor: { userId: actor.userId, role: actor.role, active: true } };
}
