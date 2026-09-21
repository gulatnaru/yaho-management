import { describe, expect, it, vi } from "vitest";
import {
  assertSmokeObservation,
  ProductionSmokeError,
  type ProductionDeploymentIdentity,
  verifyStableProductionSmoke,
  waitForProductionDeployment,
} from "@/scripts/release/production-smoke";

const WAIT_INPUT = {
  token: "vercel-token",
  teamId: "team-id",
  projectId: "project-id",
  productionBaseUrl: "https://production.example.com",
  releaseSha: "release-sha",
  delay: vi.fn(),
  attempts: 1,
};

function aliasResponse(deploymentId = "dpl_current", overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      alias: "production.example.com",
      deployment: { id: deploymentId },
      deploymentId,
      projectId: "project-id",
      ...overrides,
    }),
    { status: 200 },
  );
}

function deploymentResponse(overrides: Record<string, unknown> = {}) {
  return new Response(
    JSON.stringify({
      id: "dpl_current",
      readyState: "READY",
      target: "production",
      gitSource: { sha: "release-sha" },
      ...overrides,
    }),
    { status: 200 },
  );
}

function vercelFetcher(
  alias: Response = aliasResponse(),
  deployment: Response = deploymentResponse(),
) {
  return vi.fn().mockResolvedValueOnce(alias).mockResolvedValueOnce(deployment);
}

describe("Production invalid-login smoke", () => {
  const success = {
    loginGetStatus: 200,
    responseStatuses: [200, 200],
    alertText: "이메일 또는 비밀번호가 올바르지 않습니다.",
    finalPathname: "/login",
    hasInfrastructureErrorText: false,
  };

  it("accepts only the expected generic credential failure", () => {
    expect(() => assertSmokeObservation(success)).not.toThrow();
  });

  it.each([
    { ...success, responseStatuses: [200, 500] },
    { ...success, alertText: null },
    { ...success, alertText: "" },
    { ...success, alertText: "다른 오류" },
    { ...success, finalPathname: "/dashboard" },
    { ...success, hasInfrastructureErrorText: true },
  ])("fails closed for an invalid smoke outcome", (observation) => {
    expect(() => assertSmokeObservation(observation)).toThrowError(ProductionSmokeError);
  });

});

describe("current Production deployment verification", () => {
  it("passes when the authoritative alias resolves to the ready expected release", async () => {
    const fetcher = vercelFetcher();

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).resolves.toEqual({
      deploymentId: "dpl_current",
      gitSha: "release-sha",
      readyState: "READY",
      target: "production",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain(
      "/v4/aliases/production.example.com?projectId=project-id&teamId=team-id",
    );
    expect(String(fetcher.mock.calls[1][0])).toContain(
      "/v13/deployments/dpl_current?withGitRepoInfo=true&teamId=team-id",
    );
    expect(fetcher.mock.calls[0][1]).toEqual({
      headers: { Authorization: "Bearer vercel-token" },
    });
  });

  it("fails when the expected SHA only exists historically and the current alias points elsewhere", async () => {
    const fetcher = vercelFetcher(
      aliasResponse("dpl_rollback"),
      deploymentResponse({ id: "dpl_rollback", gitSource: { sha: "rollback-sha" } }),
    );

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).rejects.toMatchObject({
      code: "VERCEL_DEPLOYMENT_TIMEOUT",
    });
  });

  it("fails when the Production alias cannot be resolved", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).rejects.toMatchObject({
      code: "VERCEL_DEPLOYMENT_TIMEOUT",
    });
  });

  it("fails closed when the alias and deployment detail IDs differ", async () => {
    const fetcher = vercelFetcher(aliasResponse(), deploymentResponse({ id: "dpl_other" }));

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).rejects.toMatchObject({
      code: "VERCEL_DEPLOYMENT_ID_MISMATCH",
    });
  });

  it.each([
    { deploymentId: undefined },
    { redirect: "redirected.example.com" },
    { projectId: "other-project" },
  ])("fails closed for an incomplete or ambiguous alias response", async (overrides) => {
    const fetcher = vercelFetcher(aliasResponse("dpl_current", overrides));

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).rejects.toMatchObject({
      code: "VERCEL_ALIAS_RESPONSE_INVALID",
    });
  });

  it("fails when the current deployment Git SHA differs from the release", async () => {
    const fetcher = vercelFetcher(
      aliasResponse(),
      deploymentResponse({ gitSource: { sha: "other-sha" } }),
    );

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).rejects.toMatchObject({
      code: "VERCEL_DEPLOYMENT_TIMEOUT",
    });
  });

  it("fails when the expected current deployment is not ready", async () => {
    const fetcher = vercelFetcher(aliasResponse(), deploymentResponse({ readyState: "BUILDING" }));

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).rejects.toMatchObject({
      code: "VERCEL_DEPLOYMENT_TIMEOUT",
    });
  });

  it("ignores unrelated historical deployments because it resolves the current alias directly", async () => {
    const fetcher = vercelFetcher();

    await expect(waitForProductionDeployment({ ...WAIT_INPUT, fetcher })).resolves.toMatchObject({
      deploymentId: "dpl_current",
    });
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("/v6/deployments"))).toBe(false);
  });

  it("does not proceed to smoke when the current Production SHA mismatches", async () => {
    const fetcher = vercelFetcher(
      aliasResponse(),
      deploymentResponse({ gitSource: { sha: "other-sha" } }),
    );
    const smoke = vi.fn();

    await expect(
      waitForProductionDeployment({ ...WAIT_INPUT, fetcher }).then(smoke),
    ).rejects.toMatchObject({ code: "VERCEL_DEPLOYMENT_TIMEOUT" });
    expect(smoke).not.toHaveBeenCalled();
  });
});

describe("Production verification checkpoint orchestration", () => {
  const identity = (
    deploymentId: string,
    gitSha = "release-sha",
  ): ProductionDeploymentIdentity => ({
    deploymentId,
    gitSha,
    readyState: "READY",
    target: "production",
  });

  async function verifyFromCheckpointA({
    checkpointA = identity("dpl_a"),
    checkpoints,
    smoke = vi.fn().mockResolvedValue(undefined),
  }: {
    checkpointA?: ProductionDeploymentIdentity;
    checkpoints: ProductionDeploymentIdentity[];
    smoke?: ReturnType<typeof vi.fn>;
  }) {
    const checkpoint = vi.fn();
    for (const value of checkpoints) checkpoint.mockResolvedValueOnce(value);
    await verifyStableProductionSmoke({
      expectedDeploymentId: checkpointA.deploymentId,
      releaseSha: "release-sha",
      productionBaseUrl: "https://production.example.com",
      checkpoint,
      smoke,
    });
    return { checkpoint, smoke };
  }

  it("passes only for stable A/A/A around a successful smoke", async () => {
    const smoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyFromCheckpointA({ checkpoints: [identity("dpl_a"), identity("dpl_a")], smoke }),
    ).resolves.toMatchObject({ checkpoint: expect.any(Function), smoke });
    expect(smoke).toHaveBeenCalledOnce();
  });

  it("fails A/B before smoke", async () => {
    const smoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyFromCheckpointA({
        checkpoints: [identity("dpl_b", "other-sha")],
        smoke,
      }),
    ).rejects.toMatchObject({ code: "VERCEL_CURRENT_DEPLOYMENT_CHANGED" });
    expect(smoke).not.toHaveBeenCalled();
  });

  it("fails A/A/B after smoke even when the smoke passed", async () => {
    const smoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyFromCheckpointA({
        checkpoints: [identity("dpl_a"), identity("dpl_b", "other-sha")],
        smoke,
      }),
    ).rejects.toMatchObject({ code: "VERCEL_CURRENT_DEPLOYMENT_CHANGED" });
    expect(smoke).toHaveBeenCalledOnce();
  });

  it("fails when the SHA is unchanged but the deployment ID changes", async () => {
    const smoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyFromCheckpointA({ checkpoints: [identity("dpl_b")], smoke }),
    ).rejects.toMatchObject({ code: "VERCEL_CURRENT_DEPLOYMENT_CHANGED" });
    expect(smoke).not.toHaveBeenCalled();
  });

  it("fails when the deployment ID is unchanged but the Git SHA changes", async () => {
    const smoke = vi.fn().mockResolvedValue(undefined);

    await expect(
      verifyFromCheckpointA({ checkpoints: [identity("dpl_a", "other-sha")], smoke }),
    ).rejects.toMatchObject({ code: "VERCEL_CURRENT_DEPLOYMENT_CHANGED" });
    expect(smoke).not.toHaveBeenCalled();
  });

  it("fails immediately when smoke fails", async () => {
    const smoke = vi.fn().mockRejectedValue(new ProductionSmokeError("LOGIN_SUBMIT_5XX"));

    await expect(
      verifyFromCheckpointA({ checkpoints: [identity("dpl_a")], smoke }),
    ).rejects.toMatchObject({ code: "LOGIN_SUBMIT_5XX" });
  });

  it.each([
    { readyState: "BUILDING", target: "production" },
    { readyState: "READY", target: "preview" },
  ])("fails when a checkpoint is not ready Production", async ({ readyState, target }) => {
    await expect(
      verifyFromCheckpointA({
        checkpoints: [{ ...identity("dpl_a"), readyState, target }],
      }),
    ).rejects.toMatchObject({ code: "VERCEL_CURRENT_DEPLOYMENT_CHANGED" });
  });
});
