import {previewValidationHandler} from "@/server/ai-service/preview/handler";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=30;
export const POST=previewValidationHandler({
 environment:process.env,
 client:async()=>{const{prisma}=await import("@/lib/db/prisma");return prisma;},
 otherClient:async()=>{const{PrismaClient}=await import("@prisma/client");return new PrismaClient({datasourceUrl:process.env.DIRECT_URL});},
});
