import { chromium, webkit } from "@playwright/test";

async function main() {
  const engines = process.env.UX_PROJECT === "desktop-chromium"
    ? [chromium]
    : [chromium, webkit];
  let failed = false;

  for (const engine of engines) {
    try {
      const browser = await engine.launch({ timeout: 30_000 });
      try {
        const context = await browser.newContext();
        try {
          const page = await context.newPage();
          await page.close();
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
      console.log(`SMOKE_OK ${engine.name()}`);
    } catch (error) {
      failed = true;
      console.error(`SMOKE_FAIL ${engine.name()}: ${error instanceof Error ? error.message : "Unknown launch failure"}`);
    }
  }

  if (failed) process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(`SMOKE_FAIL: ${error instanceof Error ? error.message : "Unexpected smoke failure"}`);
  process.exitCode = 1;
});
