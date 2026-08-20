import { hash } from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const environmentSchema = z.object({
  ADMIN_EMAIL: z.string().trim().email(),
  ADMIN_PASSWORD: z.string().min(12).max(128),
});

const prisma = new PrismaClient();

async function main() {
  const environment = environmentSchema.parse(process.env);
  const password = await hash(environment.ADMIN_PASSWORD, 12);

  await prisma.user.upsert({
    where: { email: environment.ADMIN_EMAIL },
    create: {
      email: environment.ADMIN_EMAIL,
      name: "운영자",
      password,
      role: "ADMIN",
      isActive: true,
    },
    update: { password, role: "ADMIN", isActive: true },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
