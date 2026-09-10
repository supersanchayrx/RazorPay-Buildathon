import { PrismaClient } from "@prisma/client";
import { registerShutdownTask } from "./lib/runtime-lifecycle.server";

declare global {
  // eslint-disable-next-line no-var
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

registerShutdownTask("prisma.disconnect", () => prisma.$disconnect(), 100);

export default prisma;
