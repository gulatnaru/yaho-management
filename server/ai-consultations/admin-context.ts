import { headers } from "next/headers";
import {
  assertMockEnvironment,
  verifyProof,
  authorizeScope,
  AI_PROOF_HEADER,
} from "./runtime";
/** Never include capability/key material in Client props, HTML or action results. */
export async function adminContext() {
  assertMockEnvironment(process.env);
  const requestHeaders = await headers();
  const proof = verifyProof(
    requestHeaders.get(AI_PROOF_HEADER),
    "",
    "AI_ADMIN",
    process.env,
    new Date(),
  );
  const { requireAdminPrincipal } = await import("@/lib/auth/authorization");
  const principal = await requireAdminPrincipal();
  const { prisma } = await import("@/lib/db/prisma");
  const scope = await authorizeScope(prisma, proof, process.env, new Date());
  return {
    client: prisma,
    scope,
    actor: { userId: principal.userId, role: principal.role, active: true },
    keys: proof.keys,
  };
}
