import { appendFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const INVALID_EMAIL = "schema-smoke@release.example.invalid";
const INVALID_PASSWORD = "invalid-smoke-password";
const EXPECTED_ERROR = "이메일 또는 비밀번호가 올바르지 않습니다.";

type VercelDeployment = {
  id?: string;
  readyState?: string;
  target?: string;
  gitSource?: { sha?: string };
};

type VercelAlias = {
  alias?: string;
  deployment?: { id?: string };
  deploymentId?: string;
  projectId?: string;
  redirect?: string | null;
};

export type ProductionDeploymentIdentity = {
  deploymentId: string;
  gitSha: string;
  readyState: string;
  target: string;
};

export class ProductionSmokeError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProductionSmokeError";
  }
}

export type SmokeObservation = {
  loginGetStatus: number;
  responseStatuses: number[];
  alertText: string | null;
  finalPathname: string;
  hasInfrastructureErrorText: boolean;
};

export function assertSmokeObservation(observation: SmokeObservation): void {
  if (observation.loginGetStatus >= 500) throw new ProductionSmokeError("LOGIN_GET_5XX");
  if (observation.responseStatuses.some((status) => status >= 500)) {
    throw new ProductionSmokeError("LOGIN_SUBMIT_5XX");
  }
  if (observation.alertText !== EXPECTED_ERROR) {
    throw new ProductionSmokeError("EXPECTED_CREDENTIAL_FAILURE_NOT_OBSERVED");
  }
  if (observation.finalPathname.startsWith("/dashboard")) {
    throw new ProductionSmokeError("INVALID_CREDENTIAL_AUTHENTICATED");
  }
  if (observation.hasInfrastructureErrorText) {
    throw new ProductionSmokeError("INFRASTRUCTURE_ERROR_EXPOSED");
  }
}

export async function waitForProductionDeployment({
  token,
  teamId,
  projectId,
  productionBaseUrl,
  releaseSha,
  fetcher = fetch,
  delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  attempts = 60,
  expectedDeploymentId,
}: {
  token: string;
  teamId: string;
  projectId: string;
  productionBaseUrl: string;
  releaseSha: string;
  fetcher?: typeof fetch;
  delay?: (milliseconds: number) => Promise<unknown>;
  attempts?: number;
  expectedDeploymentId?: string;
}): Promise<ProductionDeploymentIdentity> {
  const productionUrl = new URL(productionBaseUrl);
  if (productionUrl.protocol !== "https:") {
    throw new ProductionSmokeError("INVALID_PRODUCTION_BASE_URL");
  }
  const productionHostname = productionUrl.hostname.toLowerCase();
  const scopeQuery = new URLSearchParams({ projectId, teamId });
  const aliasEndpoint =
    `https://api.vercel.com/v4/aliases/${encodeURIComponent(productionHostname)}?${scopeQuery.toString()}`;
  const headers = { Authorization: `Bearer ${token}` };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Get an Alias resolves the deployment currently assigned to the Production
    // hostname. Deployment-list ordering is intentionally not used.
    const aliasResponse = await fetcher(aliasEndpoint, { headers });
    if (aliasResponse.status === 404) {
      if (attempt + 1 < attempts) await delay(Math.min(5_000 + attempt * 1_000, 15_000));
      continue;
    }
    if (!aliasResponse.ok) throw new ProductionSmokeError("VERCEL_API_FAILURE");
    const alias = (await aliasResponse.json()) as VercelAlias;
    if (
      alias.alias?.toLowerCase() !== productionHostname ||
      alias.projectId !== projectId ||
      !alias.deploymentId ||
      Boolean(alias.redirect) ||
      (alias.deployment?.id !== undefined && alias.deployment.id !== alias.deploymentId)
    ) {
      throw new ProductionSmokeError("VERCEL_ALIAS_RESPONSE_INVALID");
    }
    if (expectedDeploymentId && alias.deploymentId !== expectedDeploymentId) {
      throw new ProductionSmokeError("VERCEL_CURRENT_DEPLOYMENT_CHANGED");
    }

    const deploymentQuery = new URLSearchParams({ withGitRepoInfo: "true", teamId });
    const deploymentEndpoint =
      `https://api.vercel.com/v13/deployments/${encodeURIComponent(alias.deploymentId)}?${deploymentQuery.toString()}`;
    const deploymentResponse = await fetcher(deploymentEndpoint, { headers });
    if (deploymentResponse.status === 404) {
      if (attempt + 1 < attempts) await delay(Math.min(5_000 + attempt * 1_000, 15_000));
      continue;
    }
    if (!deploymentResponse.ok) throw new ProductionSmokeError("VERCEL_API_FAILURE");
    const deployment = (await deploymentResponse.json()) as VercelDeployment;
    if (deployment.id !== alias.deploymentId) {
      throw new ProductionSmokeError("VERCEL_DEPLOYMENT_ID_MISMATCH");
    }
    if (!deployment.gitSource?.sha || !deployment.readyState || !deployment.target) {
      throw new ProductionSmokeError("VERCEL_DEPLOYMENT_RESPONSE_INVALID");
    }
    if (["ERROR", "CANCELED"].includes(deployment.readyState)) {
      throw new ProductionSmokeError("VERCEL_DEPLOYMENT_FAILED");
    }
    if (
      deployment.gitSource.sha === releaseSha &&
      deployment.readyState === "READY" &&
      deployment.target === "production"
    ) {
      return {
        deploymentId: deployment.id,
        gitSha: deployment.gitSource.sha,
        readyState: deployment.readyState,
        target: deployment.target,
      };
    }
    if (attempt + 1 < attempts) await delay(Math.min(5_000 + attempt * 1_000, 15_000));
  }
  throw new ProductionSmokeError("VERCEL_DEPLOYMENT_TIMEOUT");
}

export async function verifyStableProductionSmoke({
  expectedDeploymentId,
  releaseSha,
  productionBaseUrl,
  checkpoint,
  smoke = runInvalidLoginSmoke,
}: {
  expectedDeploymentId: string;
  releaseSha: string;
  productionBaseUrl: string;
  checkpoint: () => Promise<ProductionDeploymentIdentity>;
  smoke?: (baseUrl: string) => Promise<void>;
}): Promise<void> {
  const assertCheckpoint = (identity: ProductionDeploymentIdentity) => {
    if (
      identity.deploymentId !== expectedDeploymentId ||
      identity.gitSha !== releaseSha ||
      identity.readyState !== "READY" ||
      identity.target !== "production"
    ) {
      throw new ProductionSmokeError("VERCEL_CURRENT_DEPLOYMENT_CHANGED");
    }
  };

  // Checkpoint B narrows the race window to the smoke itself. Checkpoint C
  // proves that the same authoritative Production deployment served throughout it.
  assertCheckpoint(await checkpoint());
  await smoke(productionBaseUrl);
  assertCheckpoint(await checkpoint());
}

export async function runInvalidLoginSmoke(baseUrl: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const loginResponse = await page.goto(new URL("/login", baseUrl).toString(), {
      waitUntil: "networkidle",
    });
    assertSmokeObservation(
      await submitInvalidLoginSmoke(page, loginResponse?.status() ?? 599),
    );
  } finally {
    await browser.close();
  }
}

export async function submitInvalidLoginSmoke(
  page: Page,
  loginGetStatus: number,
  options: { credentialAlertTimeoutMs?: number } = {},
): Promise<SmokeObservation> {
  const responseStatuses: number[] = [];
  page.on("response", (response) => responseStatuses.push(response.status()));

  const loginForm = page.locator("form").filter({ has: page.locator("#email") });
  if ((await loginForm.count()) !== 1) {
    throw new ProductionSmokeError("LOGIN_FORM_NOT_FOUND");
  }

  await loginForm.locator("#email").fill(INVALID_EMAIL);
  await loginForm.locator("#password").fill(INVALID_PASSWORD);
  await loginForm.getByRole("button", { name: "로그인" }).click();

  const credentialAlert = loginForm.getByRole("alert").filter({ hasText: EXPECTED_ERROR });
  await credentialAlert.waitFor({
    state: "visible",
    timeout: options.credentialAlertTimeoutMs ?? 15_000,
  });
  const bodyText = await page.locator("body").innerText();
  const currentUrl = new URL(page.url());

  return {
    loginGetStatus,
    responseStatuses,
    alertText: (await credentialAlert.textContent())?.trim() ?? null,
    finalPathname: currentUrl.pathname,
    hasInfrastructureErrorText:
      /prisma|callbackrouteerror|column .* does not exist|database connection|query engine/i.test(bodyText),
  };
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ProductionSmokeError("MISSING_ENVIRONMENT");
  return value;
}

async function main(): Promise<void> {
  const stage = process.argv[2];
  if (stage === "wait") {
    const identity = await waitForProductionDeployment({
      token: required("VERCEL_TOKEN"),
      teamId: required("VERCEL_ORG_ID"),
      projectId: required("VERCEL_PROJECT_ID"),
      productionBaseUrl: required("PRODUCTION_BASE_URL"),
      releaseSha: required("RELEASE_SHA"),
    });
    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath) appendFileSync(outputPath, `deployment_id=${identity.deploymentId}\n`);
    console.log("[production-smoke] exact Production deployment is ready");
    return;
  }
  if (stage !== "smoke") throw new ProductionSmokeError("INVALID_STAGE");

  const productionBaseUrl = required("PRODUCTION_BASE_URL");
  const parsedBaseUrl = new URL(productionBaseUrl);
  if (parsedBaseUrl.protocol !== "https:") throw new ProductionSmokeError("INVALID_PRODUCTION_BASE_URL");
  const expectedDeploymentId = required("EXPECTED_PRODUCTION_DEPLOYMENT_ID");
  const releaseSha = required("RELEASE_SHA");
  const checkpointInput = {
    token: required("VERCEL_TOKEN"),
    teamId: required("VERCEL_ORG_ID"),
    projectId: required("VERCEL_PROJECT_ID"),
    productionBaseUrl: parsedBaseUrl.toString(),
    releaseSha,
    expectedDeploymentId,
    attempts: 1,
  };
  await verifyStableProductionSmoke({
    expectedDeploymentId,
    releaseSha,
    productionBaseUrl: parsedBaseUrl.toString(),
    checkpoint: () => waitForProductionDeployment(checkpointInput),
  });
  console.log("[production-smoke] invalid-login smoke succeeded for the approved Production release");
}

if (process.argv[1]?.endsWith("production-smoke.ts")) {
  main().catch((error: unknown) => {
    const code = error instanceof ProductionSmokeError ? error.code : "UNEXPECTED_FAILURE";
    console.error(`[production-smoke] failed (${code})`);
    process.exitCode = 1;
  });
}
