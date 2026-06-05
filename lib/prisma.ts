import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL nao configurada. Configure no .env.local antes de usar o Prisma.",
    );
  }

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createClient();
    }
    const value = Reflect.get(globalForPrisma.prisma, prop, receiver);
    return typeof value === "function" ? value.bind(globalForPrisma.prisma) : value;
  },
});
