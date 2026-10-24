import { Prisma, PrismaClient } from "@prisma/client";
import { assertSafeE2eDatabaseUrls } from "../../tests/e2e/support/db-safety";

const roles = [
  {
    name: "anon",
    sql: "CREATE ROLE anon NOLOGIN",
  },
  {
    name: "authenticated",
    sql: "CREATE ROLE authenticated NOLOGIN",
  },
] as const;

async function main() {
  assertSafeE2eDatabaseUrls({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });

  const prisma = new PrismaClient();
  try {
    for (const role of roles) {
      try {
        await prisma.$executeRawUnsafe(role.sql);
        console.log(`Created ephemeral CI database role ${role.name} (NOLOGIN).`);
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2010" ||
          error.meta?.code !== "42710"
        ) {
          throw error;
        }

        console.log(`Ephemeral CI database role ${role.name} already existed.`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(() => {
  console.error("E2E database role preparation failed: require safe local URLs and permission to create roles in the disposable E2E database.");
  process.exitCode = 1;
});
