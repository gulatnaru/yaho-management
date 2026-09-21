import { expect, test, type Page } from "@playwright/test";
import {
  assertSmokeObservation,
  submitInvalidLoginSmoke,
} from "../../scripts/release/production-smoke";

test("redirects an unauthenticated visitor to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "운영자 로그인" })).toBeVisible();
});

test("invalid-login smoke ignores an empty route announcer and reads the form error", async ({ page }) => {
  const response = await page.goto("/login");
  await page.evaluate(() => {
    const routeAnnouncer = document.createElement("div");
    routeAnnouncer.dataset.testid = "empty-route-announcer";
    routeAnnouncer.setAttribute("role", "alert");
    document.body.append(routeAnnouncer);
  });

  const observation = await submitInvalidLoginSmoke(page, response?.status() ?? 599);

  expect(await page.getByRole("alert").count()).toBeGreaterThanOrEqual(2);
  expect(page.getByTestId("empty-route-announcer")).toHaveText("");
  expect(observation.alertText).toBe("이메일 또는 비밀번호가 올바르지 않습니다.");
  expect(() => assertSmokeObservation(observation)).not.toThrow();
});

type SyntheticSmokeScenario =
  | "wrong-alert"
  | "route-alert-only"
  | "dashboard"
  | "server-error"
  | "infrastructure-error";

async function installSyntheticLoginForm(page: Page, scenario: SyntheticSmokeScenario) {
  await page.goto("/login");
  await page.setContent(`
    <form>
      <label for="email">이메일</label>
      <input id="email" name="email" />
      <label for="password">비밀번호</label>
      <input id="password" name="password" type="password" />
      <button type="submit">로그인</button>
    </form>
    <div role="alert" data-testid="empty-route-announcer"></div>
  `);
  await page.locator("form").evaluate((form, selectedScenario) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (selectedScenario === "route-alert-only") return;
      if (selectedScenario === "server-error") {
        await fetch("/__phase17_smoke_500");
      }

      const alert = document.createElement("p");
      alert.setAttribute("role", "alert");
      alert.textContent = selectedScenario === "wrong-alert"
        ? "다른 오류"
        : "이메일 또는 비밀번호가 올바르지 않습니다.";
      form.append(alert);

      if (selectedScenario === "dashboard") history.pushState({}, "", "/dashboard");
      if (selectedScenario === "infrastructure-error") {
        document.body.append("CallbackRouteError");
      }
    });
  }, scenario);
}

test("invalid-login smoke fails closed for browser-level error outcomes", async ({ page }) => {
  await installSyntheticLoginForm(page, "wrong-alert");
  await expect(
    submitInvalidLoginSmoke(page, 200, { credentialAlertTimeoutMs: 100 }),
  ).rejects.toThrow();

  await installSyntheticLoginForm(page, "route-alert-only");
  await expect(
    submitInvalidLoginSmoke(page, 200, { credentialAlertTimeoutMs: 100 }),
  ).rejects.toThrow();

  await installSyntheticLoginForm(page, "dashboard");
  const dashboardObservation = await submitInvalidLoginSmoke(page, 200);
  expect(() => assertSmokeObservation(dashboardObservation)).toThrow();

  await page.route("**/__phase17_smoke_500", (route) =>
    route.fulfill({ status: 500, body: "server error" }),
  );
  await installSyntheticLoginForm(page, "server-error");
  const serverErrorObservation = await submitInvalidLoginSmoke(page, 200);
  expect(serverErrorObservation.responseStatuses).toContain(500);
  expect(() => assertSmokeObservation(serverErrorObservation)).toThrow();

  await installSyntheticLoginForm(page, "infrastructure-error");
  const infrastructureObservation = await submitInvalidLoginSmoke(page, 200);
  expect(infrastructureObservation.hasInfrastructureErrorText).toBe(true);
  expect(() => assertSmokeObservation(infrastructureObservation)).toThrow();
});
