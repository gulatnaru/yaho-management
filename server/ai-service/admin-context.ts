import { assertDeploymentApproved } from "./runtime";
import type { Database } from "./repository";
import { environmentSchema, type Environment, type Actor } from "./contracts";
import { readServiceKeys } from "./keys";
import type { Keys } from "./crypto";
export type AdminContext = {
    db: Database;
    environment: Environment;
    actor: Actor;
    keys: Keys;
};
/** The immutable BUILD lock is deliberately before Auth.js/Prisma imports or queries. */
export async function adminContext(): Promise<AdminContext> {
    assertDeploymentApproved();
    const { requireAdminPrincipal } = await import("@/lib/auth/authorization");
    const actor = await requireAdminPrincipal();
    const environment = environmentSchema.parse(process.env.VERCEL_ENV === "preview" ? "PREVIEW" : process.env.VERCEL_ENV === "production" ? "PRODUCTION" : null);
    const keys = readServiceKeys(process.env);
    const { prisma } = await import("@/lib/db/prisma");
    return { db: prisma, environment, actor: { userId: actor.userId, role: actor.role, active: true }, keys };
}
