import { billingContract } from "../../../server/ai-service/billing";
import { conservativeKrw, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS, type Price } from "../../../server/ai-service/cost";

export const MODEL = "gpt-6-luna" as const;
export const COST_CAP_KRW = 300;
/** Fixed evaluation valuation, never production configuration or a credential source. */
export const EVAL_PRICE: Price = {
  ...billingContract("OPENAI", MODEL), inputNanoUsdPerToken: 100, outputNanoUsdPerToken: 500,
  fxMilliKrwPerUsd: 2_000_000, fxCheckedAt: new Date("2026-10-17T00:00:00Z"), priceVersion: "eval-2026-10-17",
};
export const MAX_REQUEST_KRW = conservativeKrw(EVAL_PRICE, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS);
