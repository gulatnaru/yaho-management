import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { runtimeDatabaseIdentityFingerprint } from "@/lib/e2e/preview-safety";
import { PrismaOutboxStore } from "@/lib/kakao/outbox-store";
const fake = vi.hoisted(() => ({ identity: vi.fn() }));
vi.mock("@/lib/db/prisma", () => ({ prisma: { $queryRaw: fake.identity } }));
import { GET } from "@/app/api/cron/kakao-notifications/route";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
it("runs the real P5 worker fail-closed before claim when safe inputs are missing", async () => {
  const secret = randomBytes(32).toString("base64url");
  const identity = { database: "synthetic_db", currentUser: "synthetic_user", currentSchema: "public" };
  vi.stubEnv("KAKAO_DISPATCH_BEARER_SECRET", secret); vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("KAKAO_PREVIEW_PROJECT_REF", "syntheticpreview"); vi.stubEnv("KAKAO_PRODUCTION_PROJECT_REF", "syntheticproduction");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@db.syntheticpreview.supabase.co/synthetic");
  vi.stubEnv("KAKAO_PREVIEW_DB_IDENTITY_SHA256", runtimeDatabaseIdentityFingerprint(identity, "syntheticpreview"));
  fake.identity.mockResolvedValue([identity]);
  const sweep = vi.spyOn(PrismaOutboxStore.prototype, "recoverStale").mockResolvedValue([]);
  const claim = vi.spyOn(PrismaOutboxStore.prototype, "claimDue");
  const response = await GET(new Request("http://fixture.invalid", { headers: { authorization: `Bearer ${secret}` } }));
  expect(await response.json()).toEqual({ code: "batch_failed" });
  expect(sweep).toHaveBeenCalledOnce(); expect(claim).not.toHaveBeenCalled();
});
