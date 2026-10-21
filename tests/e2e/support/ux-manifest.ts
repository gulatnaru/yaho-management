import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { z } from "zod";

export const uxProjects = ["desktop-chromium", "mobile-webkit-360", "mobile-webkit-390", "tablet-webkit-768"] as const;
export const uxProjectSchema = z.enum(uxProjects);
export const uxManifestSchema = z.object({
  project: uxProjectSchema,
  environment: z.record(z.string()),
  accounts: z.array(z.object({ role: z.enum(["ADMIN", "MANAGER", "TEACHER"]), email: z.string().email(), password: z.string().min(8), finalPassword: z.string().min(8) })).length(3).refine((accounts) => new Set(accounts.map((account) => account.role)).size === 3),
});
export type UxManifest = z.infer<typeof uxManifestSchema>;

export function runtimePath(path: string) {
  const root = resolve("test-results/ux-runtime");
  const target = resolve(path);
  if (!target.startsWith(root + sep)) throw new Error("UX_RUNTIME_PATH_MUST_BE_GITIGNORED");
  return target;
}

export function loadUxManifest(path: string): UxManifest {
  try { return uxManifestSchema.parse(JSON.parse(readFileSync(runtimePath(path), "utf8"))); }
  catch { throw new Error("UX_MANIFEST_INVALID_OR_MISSING"); }
}

export function applyUxManifest(path: string) {
  const manifest = loadUxManifest(path);
  const entries = Object.entries(manifest.environment);
  if (entries.some(([key]) => !/^(UX_|E2E_UX_)/.test(key))) throw new Error("UX_MANIFEST_ENV_KEY_REJECTED");
  for (const [key, value] of entries) process.env[key] = value;
  return manifest;
}
