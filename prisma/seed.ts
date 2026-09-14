import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ensureBootstrapAdmin } from "../server/accounts/bootstrap";

const environmentSchema = z.object({
  ADMIN_EMAIL: z.string().trim().email(),
  ADMIN_PASSWORD: z.string().min(12).max(128),
});

const prisma = new PrismaClient();

async function main() {
  const environment = environmentSchema.parse(process.env);
  await ensureBootstrapAdmin(prisma, {
    email: environment.ADMIN_EMAIL,
    password: environment.ADMIN_PASSWORD,
  });
}

main()
  .catch(() => {
    console.error("Seed failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
