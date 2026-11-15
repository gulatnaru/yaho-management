import { describe, expect, it } from "vitest";
import { verifySeedProfile, type SeedConfigView, type SeedProfile } from "@/server/ai-service/seed-profile";
const now = new Date("2026-11-15T12:00:00Z");
const config: SeedConfigView = { paused: true, schedulerEnabled: false, provider: "OPENAI", model: "gpt-6-luna", priceVersion: "price-v1", inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500, fxMilliKrwPerUsd: 1399999, fxCheckedAt: now, fxSource: "synthetic", hmacVersions: [] };
describe("seed profiles", () => {
    it("S1/S2 validates safe-off pause", () => {
        expect(verifySeedProfile(config, "safe-off", now).failures).toEqual([]);
        expect(verifySeedProfile({ ...config, paused: false }, "safe-off", now).failures.join()).toContain("paused");
    });
    it("S3/S4 validates preview and scheduler", () => {
        const preview = { ...config, paused: false };
        expect(verifySeedProfile(preview, "preview-synthetic", now).failures).toEqual([]);
        expect(verifySeedProfile({ ...preview, schedulerEnabled: true }, "preview-synthetic", now).failures.join()).toContain("schedulerEnabled");
    });
    it("S5 reports arbitrary sources without comparing them", () => {
        for (const profile of ["safe-off", "preview-synthetic"] as SeedProfile[]) for (const fxSource of ["x", "bank-x 2026-11-15", "mid-market 2026-11-07 ~1364; planning 1400"]) {
            const result = verifySeedProfile({ ...config, paused: profile === "safe-off", fxSource }, profile, now);
            expect(result.failures).toEqual([]); expect(result.lines.join()).toContain(fxSource);
        }
    });
    it("S6 checks both ends of the freshness window", () => {
        for (const profile of ["safe-off", "preview-synthetic"] as SeedProfile[]) for (const [age, valid] of [[0, true], [72 * 3600000, true], [72 * 3600000 + 1, false], [73 * 3600000, false], [-1, false]] as const) {
            const result = verifySeedProfile({ ...config, paused: profile === "safe-off", fxCheckedAt: new Date(+now - age) }, profile, now);
            expect(result.failures.some(x => x.includes("fxCheckedAt"))).toBe(!valid);
        }
    });
    it("S7 checks FX bounds without requiring a literal", () => {
        for (const [rate, valid] of [[99999, false], [100000, true], [1399999, true], [1400000, true], [10000000, true], [10000001, false]] as const)
            expect(verifySeedProfile({ ...config, fxMilliKrwPerUsd: rate }, "safe-off", now).failures.length === 0).toBe(valid);
    });
    it("S8 reports hmac versions", () => {
        for (const hmacVersions of [[], ["v1"], ["v1", "v2"]]) {
            const result = verifySeedProfile({ ...config, hmacVersions }, "safe-off", now);
            expect(result.failures).toEqual([]); expect(result.lines.join()).toContain(JSON.stringify(hmacVersions));
        }
    });
});
