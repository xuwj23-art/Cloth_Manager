import { Controller, Get, ServiceUnavailableException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

@Controller("health")
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 健康检查。db 不可用时抛 503 而非仍返回 status:ok——
   * 该接口用作 docker healthcheck / 移动端 isOnline 探活，
   * 「进程活着但数据库挂了」必须能被监控发现。
   */
  @Get()
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException({
        status: "error",
        db: "down",
        time: new Date().toISOString(),
      });
    }
    return {
      status: "ok",
      db: "up",
      time: new Date().toISOString(),
    };
  }
}
