import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    // 不因数据库未就绪而阻断服务启动：连接失败仅告警，首个 DB 请求时会再次尝试。
    try {
      await this.$connect();
      this.logger.log("数据库连接成功");
    } catch (err) {
      this.logger.warn(
        `数据库暂未连接（可稍后启动 PostgreSQL）：${(err as Error).message}`,
      );
    }
  }
}
