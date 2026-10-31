import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "server-only": path.resolve(__dirname, "tests/unit/manual-test/server-only.ts"), "@": path.resolve(__dirname, ".") } },
  test: { include: ["tests/p7-integration/p7-first-super-admin.test.ts"], environment: "node", globals: true, fileParallelism: false },
});
