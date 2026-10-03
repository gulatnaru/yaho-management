const LOCAL_E2E_ORIGIN = "http://127.0.0.1:3000";

/** Keeps the ordinary Playwright route on the local webServer it creates. */
export function assertLocalE2eBaseUrl(value: string | undefined): string {
  const baseUrl = value ?? LOCAL_E2E_ORIGIN;
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("[Playwright local safety] PLAYWRIGHT_BASE_URL must be the local E2E origin.");
  }

  if (
    parsed.origin !== LOCAL_E2E_ORIGIN ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("[Playwright local safety] PLAYWRIGHT_BASE_URL must be http://127.0.0.1:3000.");
  }
  return LOCAL_E2E_ORIGIN;
}
