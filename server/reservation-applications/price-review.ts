import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { APPLICATION_CONSENT_CONTENT } from "@/lib/reservation-applications/consent-content";
import { hashApplicationCapabilityToken } from "@/lib/reservation-applications/token";
import { MAX_POSTGRES_INTEGER } from "@/lib/reservation-applications/phase20-validation";
import { ApplicationClosedError } from "@/lib/reservation-applications/errors";

export type ReviewedClassPrice = { classScheduleId: string; amount: number };
export type ApplicationPriceReview = { proof: string; prices: ReviewedClassPrice[] };
const reviewSchema = z.object({
  version: z.literal(1), scope: z.string().length(64), operation: z.string().uuid(),
  issuedAt: z.number().int(), consentVersion: z.string().min(1),
  prices: z.array(z.object({ classScheduleId: z.string().min(1).max(200), amount: z.number().int().positive().max(MAX_POSTGRES_INTEGER) }).strict()).min(1).max(10),
}).strict();
type Review = z.infer<typeof reviewSchema>;
const REVIEW_LIFETIME_MS = 2 * 60 * 60 * 1000;
function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new ApplicationClosedError();
  return value;
}
function signature(body: string): Buffer {
  return createHmac("sha256", secret()).update(`yaho-application-price-review-v1:${body}`).digest();
}
export function applicationReviewScope(input: { token?: string; companionToken?: string }): string {
  return hashApplicationCapabilityToken(JSON.stringify([input.token ?? null, input.companionToken ?? null]));
}
/** No names, contact information, child IDs or consent originals enter the signed review. */
export function issueApplicationPriceReview(input: { scope: string; prices: ReviewedClassPrice[]; now: Date; operation?: string }): ApplicationPriceReview {
  const data = reviewSchema.parse({ version: 1, scope: input.scope, operation: input.operation ?? randomUUID(), issuedAt: input.now.getTime(), consentVersion: APPLICATION_CONSENT_CONTENT.version, prices: [...input.prices].sort((a, b) => a.classScheduleId.localeCompare(b.classScheduleId)) });
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return { proof: `${body}.${signature(body).toString("base64url")}`, prices: data.prices };
}
/** Authenticate before considering freshness; expiry never relaxes signature or scope checks. */
export function authenticateApplicationPriceReview(proof: string, scope: string, now: Date): Review {
  if (proof.length > 10000) throw new ApplicationClosedError();
  const parts = proof.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ApplicationClosedError();
  const expected = signature(parts[0]);
  const actual = Buffer.from(parts[1], "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new ApplicationClosedError();
  let data: Review;
  try { data = reviewSchema.parse(JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"))); } catch { throw new ApplicationClosedError(); }
  if (data.scope !== scope || data.issuedAt > now.getTime() || data.consentVersion !== APPLICATION_CONSENT_CONTENT.version || new Set(data.prices.map((row) => row.classScheduleId)).size !== data.prices.length) throw new ApplicationClosedError();
  return data;
}
export function isApplicationPriceReviewExpired(review: Review, now: Date): boolean {
  return now.getTime() - review.issuedAt > REVIEW_LIFETIME_MS;
}
export function verifyApplicationPriceReview(proof: string, scope: string, now: Date): Review {
  const review = authenticateApplicationPriceReview(proof, scope, now);
  if (isApplicationPriceReviewExpired(review, now)) throw new ApplicationPriceReviewExpiredError();
  return review;
}
/** A current replacement is attached only after the live capability and prior operation are checked. */
export class ApplicationPriceReviewExpiredError extends Error {
  constructor(readonly priceReview?: ApplicationPriceReview) { super("APPLICATION_PRICE_REVIEW_EXPIRED"); }
}
export class ApplicationPriceChangedError extends Error {
  constructor(readonly priceReview: ApplicationPriceReview) { super("APPLICATION_PRICE_CHANGED"); }
}
export class ApplicationAlreadySubmittedError extends Error {
  constructor() { super("APPLICATION_RESULT_UNKNOWN"); }
}
