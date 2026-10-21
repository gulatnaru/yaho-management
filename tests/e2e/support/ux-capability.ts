import { chromium, webkit } from "@playwright/test";
import { assertLocalE2eBaseUrl } from "../../../lib/e2e/local-origin-safety";
import { uxProjectSchema } from "./ux-manifest";

/** Observe the real engine's Secure-cookie policy at the mandatory HTTP origin.
 * Never change cookie flags, inject an app capability, or infer from browser name.
 * Both responses are synthetic, intercepted locally; no application route runs.
 */
export async function probeSecureLoopbackCookie(projectInput: string): Promise<boolean> {
  const project = uxProjectSchema.parse(projectInput);
  const baseURL = assertLocalE2eBaseUrl(process.env.PLAYWRIGHT_BASE_URL);
  const browser = await (project === "desktop-chromium" ? chromium : webkit).launch();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    let sent = false;
    await context.route(`${baseURL}/__ux_secure_probe/*`, async (route) => {
      if (route.request().url().endsWith("/set")) {
        await route.fulfill({ status: 200, contentType: "text/html", headers: { "set-cookie": "ux_secure_probe=synthetic; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=60" }, body: "synthetic cookie probe" });
      } else {
        const headers = await route.request().allHeaders();
        sent = (headers.cookie ?? "").split(";").some((part) => part.trim() === "ux_secure_probe=synthetic");
        await route.fulfill({ status: 200, contentType: "text/html", body: "synthetic cookie probe complete" });
      }
    });
    await page.goto(`${baseURL}/__ux_secure_probe/set`);
    await page.goto(`${baseURL}/__ux_secure_probe/check`);
    return sent;
  } finally { await browser.close(); }
}
