import { Controller, Get } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check() {
    let db = "unknown";
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = "up";
    } catch {
      db = "down";
    }
    return {
      status: "ok",
      db,
      time: new Date().toISOString(),
    };
  }
}
