import { Prisma } from "@prisma/client";
import { ApplicationNotPendingError } from "@/lib/reservation-applications/errors";
import {
  ApplicationPaymentAlreadyExistsError,
  ApplicationSubmissionOverbookingConfirmationError,
  InsufficientApplicationDepositError,
} from "@/server/reservation-applications/finance";

export const PHASE20_RACE_OUTCOME = {
  FULFILLED: "FULFILLED",
  APPLICATION_NOT_PENDING: "APPLICATION_NOT_PENDING",
  INSUFFICIENT_DEPOSIT: "INSUFFICIENT_DEPOSIT",
  PAYMENT_ALREADY_EXISTS: "PAYMENT_ALREADY_EXISTS",
  OVERBOOKING_CONFIRMATION: "OVERBOOKING_CONFIRMATION",
  PRISMA_P1001: "PRISMA_P1001",
  PRISMA_P1002: "PRISMA_P1002",
  PRISMA_P1008: "PRISMA_P1008",
  PRISMA_P1017: "PRISMA_P1017",
  PRISMA_P2002: "PRISMA_P2002",
  PRISMA_P2003: "PRISMA_P2003",
  PRISMA_P2010: "PRISMA_P2010",
  PRISMA_P2010_SQL_23503: "PRISMA_P2010_SQL_23503",
  PRISMA_P2010_SQL_23505: "PRISMA_P2010_SQL_23505",
  PRISMA_P2010_SQL_40001: "PRISMA_P2010_SQL_40001",
  PRISMA_P2010_SQL_40P01: "PRISMA_P2010_SQL_40P01",
  PRISMA_P2010_SQL_42P01: "PRISMA_P2010_SQL_42P01",
  PRISMA_P2010_SQL_42703: "PRISMA_P2010_SQL_42703",
  PRISMA_P2010_SQL_55P03: "PRISMA_P2010_SQL_55P03",
  PRISMA_P2021: "PRISMA_P2021",
  PRISMA_P2022: "PRISMA_P2022",
  PRISMA_P2024: "PRISMA_P2024",
  PRISMA_P2025: "PRISMA_P2025",
  PRISMA_P2027: "PRISMA_P2027",
  PRISMA_P2028: "PRISMA_P2028",
  PRISMA_P2034: "PRISMA_P2034",
  PRISMA_UNKNOWN_REQUEST: "PRISMA_UNKNOWN_REQUEST",
  OTHER_REJECTION: "OTHER_REJECTION",
} as const;

export type Phase20RaceOutcome = (typeof PHASE20_RACE_OUTCOME)[keyof typeof PHASE20_RACE_OUTCOME];

const RAW_QUERY_SQLSTATE_OUTCOME = new Map<string, Phase20RaceOutcome>([
  ["23503", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_23503],
  ["23505", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_23505],
  ["40001", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_40001],
  ["40P01", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_40P01],
  ["42P01", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_42P01],
  ["42703", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_42703],
  ["55P03", PHASE20_RACE_OUTCOME.PRISMA_P2010_SQL_55P03],
]);

function rawQuerySqlState(error: Prisma.PrismaClientKnownRequestError): Phase20RaceOutcome | null {
  if (error.code !== "P2010" || !error.meta || typeof error.meta.code !== "string") return null;
  return RAW_QUERY_SQLSTATE_OUTCOME.get(error.meta.code) ?? null;
}

/** Maps only class identity and a fixed code allowlist; messages, metadata and SQL never escape. */
export function classifyPhase20RaceOutcome(result: PromiseSettledResult<unknown>): Phase20RaceOutcome {
  if (result.status === "fulfilled") return PHASE20_RACE_OUTCOME.FULFILLED;
  if (result.reason instanceof ApplicationNotPendingError) return PHASE20_RACE_OUTCOME.APPLICATION_NOT_PENDING;
  if (result.reason instanceof InsufficientApplicationDepositError) return PHASE20_RACE_OUTCOME.INSUFFICIENT_DEPOSIT;
  if (result.reason instanceof ApplicationPaymentAlreadyExistsError) return PHASE20_RACE_OUTCOME.PAYMENT_ALREADY_EXISTS;
  if (result.reason instanceof ApplicationSubmissionOverbookingConfirmationError) return PHASE20_RACE_OUTCOME.OVERBOOKING_CONFIRMATION;
  if (result.reason instanceof Prisma.PrismaClientUnknownRequestError) return PHASE20_RACE_OUTCOME.PRISMA_UNKNOWN_REQUEST;
  if (result.reason instanceof Prisma.PrismaClientKnownRequestError) {
    const rawQueryOutcome = rawQuerySqlState(result.reason);
    if (rawQueryOutcome) return rawQueryOutcome;
    const known = `PRISMA_${result.reason.code}` as Phase20RaceOutcome;
    return Object.values(PHASE20_RACE_OUTCOME).includes(known) ? known : PHASE20_RACE_OUTCOME.OTHER_REJECTION;
  }
  return PHASE20_RACE_OUTCOME.OTHER_REJECTION;
}

export function assertExactlyOneFulfilledPhase20Race(result: PromiseSettledResult<unknown>[]) {
  const outcomes = result.map(classifyPhase20RaceOutcome);
  if (outcomes.filter((outcome) => outcome === PHASE20_RACE_OUTCOME.FULFILLED).length !== 1) {
    throw new Error(`PHASE20_RACE_OUTCOME:${outcomes.join(",")}`);
  }
}
