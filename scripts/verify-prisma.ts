import { prisma } from "../lib/prisma";

async function main() {
  await prisma.vereador.findFirst({
    select: {
      id: true,
    },
  });

  console.log("✅ Connected.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
