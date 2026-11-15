export type SeedProfile = "safe-off" | "preview-synthetic";
export type SeedConfigView = {
    paused: boolean; schedulerEnabled: boolean; provider: string; model: string;
    priceVersion: string; inputNanoUsdPerToken: number; outputNanoUsdPerToken: number;
    fxMilliKrwPerUsd: number; fxCheckedAt: Date; fxSource: string; hmacVersions: string[];
};
export function verifySeedProfile(config: SeedConfigView, profile: SeedProfile, now: Date): { failures: string[]; lines: string[] } {
    const failures: string[] = [];
    const lines: string[] = [];
    const checks: [string, unknown, unknown][] = [
        ["paused", config.paused, profile === "safe-off"], ["schedulerEnabled", config.schedulerEnabled, false],
        ["provider", config.provider, "OPENAI"], ["model", config.model, "gpt-6-luna"], ["priceVersion", config.priceVersion, "price-v1"],
        ["inputNanoUsdPerToken", config.inputNanoUsdPerToken, 100], ["outputNanoUsdPerToken", config.outputNanoUsdPerToken, 500],
    ];
    for (const [name, actual, expected] of checks) {
        lines.push(`config.${name}: ${String(actual)} (expected ${String(expected)}) ${actual === expected ? "OK" : "MISMATCH"}`);
        if (actual !== expected) failures.push(`config.${name} is ${String(actual)}, expected ${String(expected)}`);
    }
    const fxValid = config.fxMilliKrwPerUsd >= 100_000 && config.fxMilliKrwPerUsd <= 10_000_000;
    lines.push(`config.fxMilliKrwPerUsd: ${config.fxMilliKrwPerUsd} ${fxValid ? "OK" : "MISMATCH"}`);
    if (!fxValid) failures.push("config.fxMilliKrwPerUsd is outside the valid range");
    const age = now.getTime() - config.fxCheckedAt.getTime();
    const fresh = age >= 0 && age <= 72 * 3600000;
    lines.push(`config.fxCheckedAt: ${config.fxCheckedAt.toISOString()} (age ${Math.round(age / 3600000)}h, limit 72h) ${fresh ? "OK" : "MISMATCH"}`);
    if (!fresh) failures.push("config.fxCheckedAt is outside the 72h freshness window");
    lines.push(`config.fxSource: ${config.fxSource} (length ${config.fxSource.length})`);
    lines.push(`config.hmacVersions: ${JSON.stringify(config.hmacVersions)}`);
    lines.push("note: provider=OPENAI is a billing-contract value only; the live path has no provider field and cannot call a model.");
    return { failures, lines };
}
