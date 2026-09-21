import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const schemaGate = readFileSync(".github/workflows/production-schema-gate.yml", "utf8");
const releaseVerify = readFileSync(".github/workflows/production-release-verify.yml", "utf8");

describe("Production workflow contract", () => {
  it("uses native PR job dependencies and one final schema gate", () => {
    expect(schemaGate).toContain("detect-schema-change:");
    expect(schemaGate).toContain("production-migrate:");
    expect(schemaGate).toContain("production-schema-gate:");
    expect(schemaGate).toContain("needs: [detect-schema-change, production-migrate]");
    expect(schemaGate).toContain("if: always()");
    expect(schemaGate).not.toContain("workflow_dispatch");
    expect(schemaGate).not.toMatch(/statuses|commit status/i);
  });

  it("skips Production access for no-schema changes and requires the protected environment otherwise", () => {
    expect(schemaGate).toContain("schema_change == 'true'");
    expect(schemaGate).toContain("environment: production");
    expect(schemaGate).toContain('test "$MIGRATE_RESULT" = "skipped"');
    expect(schemaGate).toContain('test "$MIGRATE_RESULT" = "success"');
    expect(schemaGate).toContain("group: production-migration");
  });

  it("separates trusted tooling from the exact-head migration payload", () => {
    expect(schemaGate).toContain("path: trusted");
    expect(schemaGate).toContain("path: payload");
    expect(schemaGate).toContain("npm ci --ignore-scripts");
    expect(schemaGate).toContain("prisma/schema.prisma");
    expect(schemaGate).toContain("prisma/migrations");
    expect(schemaGate).toContain("Recheck exact pull request head after approval");
    expect(schemaGate).toContain("Recheck exact pull request head before migration");
  });

  it("contains no forbidden Production mutation command", () => {
    for (const workflow of [schemaGate, releaseVerify]) {
      expect(workflow).not.toMatch(/prisma\s+db\s+push/);
      expect(workflow).not.toMatch(/prisma\s+migrate\s+reset/);
      expect(workflow).not.toMatch(/prisma\s+db\s+seed/);
      expect(workflow).not.toMatch(/prisma\s+migrate\s+resolve/);
    }
  });

  it("runs post-deploy verification only for schema-changing main releases without a smoke account", () => {
    expect(releaseVerify).toContain("branches: [main]");
    expect(releaseVerify).toContain("schema_change == 'true'");
    expect(releaseVerify).toContain("production-migration.ts verify");
    expect(releaseVerify).toContain("production-smoke.ts wait");
    expect(releaseVerify).toContain("production-smoke.ts smoke");
    expect(releaseVerify).toContain("PRODUCTION_BASE_URL: ${{ vars.PRODUCTION_BASE_URL }}");
    expect(releaseVerify).toContain(
      "PRODUCTION_DB_RUNTIME_IDENTITY_SHA256: ${{ secrets.PRODUCTION_DB_RUNTIME_IDENTITY_SHA256 }}",
    );
    expect(releaseVerify.indexOf("Install Chromium for read-only live smoke")).toBeLessThan(
      releaseVerify.indexOf("production-smoke.ts wait"),
    );
    expect(releaseVerify.indexOf("production-smoke.ts wait")).toBeLessThan(
      releaseVerify.indexOf("production-migration.ts verify"),
    );
    expect(releaseVerify.indexOf("production-migration.ts verify")).toBeLessThan(
      releaseVerify.indexOf("production-smoke.ts smoke"),
    );
    expect(releaseVerify).not.toContain("PRODUCTION_SMOKE_EMAIL");
    expect(releaseVerify).not.toContain("PRODUCTION_SMOKE_PASSWORD");
  });

  it("pins smoke checkpoints B and C to checkpoint A's authoritative deployment", () => {
    expect(releaseVerify).toContain("id: production-checkpoint-a");
    expect(releaseVerify).toContain(
      "EXPECTED_PRODUCTION_DEPLOYMENT_ID: ${{ steps.production-checkpoint-a.outputs.deployment_id }}",
    );
    expect(releaseVerify).toContain("RELEASE_SHA: ${{ github.sha }}");
    expect(releaseVerify).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(releaseVerify).toContain("Checkpoints B and C - verify stable Production invalid-login path");
  });

  it("requires both URL and runtime DB fingerprints only inside schema-gated jobs", () => {
    expect(schemaGate.match(/PRODUCTION_DB_RUNTIME_IDENTITY_SHA256/g)).toHaveLength(6);
    expect(schemaGate).toContain("schema_change == 'true'");
    expect(schemaGate).toContain('test "$MIGRATE_RESULT" = "skipped"');
    expect(releaseVerify).toContain("schema_change == 'true'");
  });
});
