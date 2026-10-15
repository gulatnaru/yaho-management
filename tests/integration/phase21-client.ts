import { Prisma, type PrismaClient } from "@prisma/client";
export const PG_VERIFICATION_MAX_WAIT_MS=2000;
export type PgFailureCode="P2028"|"P2010"|"P2002"|"P2034"|"UNKNOWN";
export function pgFailureCode(error:unknown):PgFailureCode {
 const allowed=["P2028","P2010","P2002","P2034"] as const;
 return error instanceof Prisma.PrismaClientKnownRequestError && (allowed as readonly string[]).includes(error.code)?error.code as PgFailureCode:"UNKNOWN";
}
/** Harness-only adapter: it never enters application imports or changes HTTP transaction budgets. */
export function pgVerificationClient(client:PrismaClient,onFailure:(code:PgFailureCode)=>void):PrismaClient {
 return new Proxy(client,{
  get(target,property) {
   if(property==="$transaction")return async<T>(callback:(tx:Prisma.TransactionClient)=>Promise<T>,options?:{maxWait?:number;timeout?:number})=>{
    try{return await target.$transaction(callback,{...options,maxWait:PG_VERIFICATION_MAX_WAIT_MS});}
    catch(error){onFailure(pgFailureCode(error));throw error;}
   };
   const value:unknown=Reflect.get(target,property,target);
   return typeof value==="function"?value.bind(target):value;
  },
 });
}
