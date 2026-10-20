import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { assertSafeE2eDatabaseUrls } from "../../tests/e2e/support/db-safety";

const expectedMetadata = z.array(z.object({
  version: z.string().regex(/^PostgreSQL 16(?:\.|\s)/),
  database: z.literal("yaho_e2e"),
  username: z.literal("yaho_e2e"),
})).length(1);

async function main() {
  assertSafeE2eDatabaseUrls({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });

  const prisma = new PrismaClient();
  try {
    const metadata = await prisma.$queryRaw<unknown>`
      SELECT version() AS version,
             current_database()::text AS database,
             current_user::text AS username
    `;

    if (!expectedMetadata.safeParse(metadata).success) {
      throw new Error("Unexpected PostgreSQL server metadata.");
    }

    console.log("Verified PostgreSQL 16, database yaho_e2e, user yaho_e2e.");
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("E2E database verification failed: require safe local URLs and PostgreSQL 16 with database/user yaho_e2e.");
  process.exitCode = 1;
});
