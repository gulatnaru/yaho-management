import { ServiceDenied } from "./contracts";
export type Price = {
    inputNanoUsdPerToken: number;
    outputNanoUsdPerToken: number;
    fxMilliKrwPerUsd: number;
    fxCheckedAt: Date;
    priceVersion: string;
    billingContract: string;
    inputCostNumerator: number;
    inputCostDenominator: number;
};
export const MAX_INPUT_TOKENS = 6000, MAX_OUTPUT_TOKENS = 256, FX_MAX_AGE_MS = 72 * 3600000;
export function monthKst(now: Date) { if (!Number.isFinite(now.getTime()))
    throw new ServiceDenied(); return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 7); }
function integer(v: number) { if (!Number.isSafeInteger(v) || v < 0)
    throw new ServiceDenied(); return BigInt(v); }
/** Snapshot maximum input rate includes cache writes. Cached-read discounts are never assumed. */
export function conservativeKrw(price: Price, input: number, output: number) {
    if (!price.priceVersion || !/^((OPENAI)|(TEST_DOUBLE))_STANDARD_INPUT_MAX_V1$/.test(price.billingContract) || price.inputCostNumerator !== 5 || price.inputCostDenominator !== 4 || !Number.isFinite(price.fxCheckedAt.getTime()))
        throw new ServiceDenied();
    const den = integer(price.inputCostDenominator), num = integer(price.inputCostNumerator);
    const nanos = integer(input) * integer(price.inputNanoUsdPerToken) * num + integer(output) * integer(price.outputNanoUsdPerToken) * den;
    const numerator = nanos * integer(price.fxMilliKrwPerUsd) * 110n * 110n * 105n;
    const denominator = 1000000000n * 1000n * 100n * 100n * 100n * den;
    const amount = (numerator + denominator - 1n) / denominator;
    if (amount > BigInt(Number.MAX_SAFE_INTEGER))
        throw new ServiceDenied();
    return Number(amount);
}
export function reserveKrw(price: Price, now: Date) { const age = +now - +price.fxCheckedAt; if (age < 0 || age > FX_MAX_AGE_MS || price.inputNanoUsdPerToken <= 0 || price.outputNanoUsdPerToken <= 0 || price.fxMilliKrwPerUsd <= 0)
    throw new ServiceDenied(); return conservativeKrw(price, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS); }
