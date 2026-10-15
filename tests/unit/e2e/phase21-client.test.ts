import {describe,expect,it,vi} from "vitest";
import {Prisma,type PrismaClient} from "@prisma/client";
import {pgVerificationClient,pgFailureCode,PG_VERIFICATION_MAX_WAIT_MS} from "../../integration/phase21-client";
describe("WAN PostgreSQL verification acquisition",()=>{
 it("overrides only the harness acquisition wait and retains the requested transaction deadline",async()=>{
  const callback=vi.fn(async()=>"observed"),transaction=vi.fn(async(fn:()=>Promise<unknown>)=>fn());
  const source={$transaction:transaction} as unknown as PrismaClient;
  const wrapped=pgVerificationClient(source,vi.fn());
  expect(await wrapped.$transaction(callback,{maxWait:40,timeout:8000})).toBe("observed");
  expect(transaction).toHaveBeenCalledWith(callback,{maxWait:PG_VERIFICATION_MAX_WAIT_MS,timeout:8000});
  expect(source.$transaction).toBe(transaction);
 });
 it("captures only known Prisma codes and never raw connection/query diagnostics",async()=>{
  const error=new Prisma.PrismaClientKnownRequestError("SYNTHETIC_PRIVATE_URL",{code:"P2028",clientVersion:"test"});
  const observed=vi.fn();const source={$transaction:vi.fn(async()=>{throw error;})} as unknown as PrismaClient;
  await expect(pgVerificationClient(source,observed).$transaction(async()=>null)).rejects.toBe(error);
  expect(observed).toHaveBeenCalledWith("P2028");
  expect(pgFailureCode(new Error("PRIVATE_BODY"))).toBe("UNKNOWN");
 });
});
