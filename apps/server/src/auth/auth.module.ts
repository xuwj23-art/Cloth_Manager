import { Global, Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { RolesGuard } from "./roles.guard";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>("JWT_SECRET");
        // 启动强校验：杜绝 dev 兜底弱密钥被误带到生产。
        // JWT_SECRET 必须配置且长度 ≥ 32 字符（满足 HS256 安全基线）。
        if (!secret || secret.length < 32) {
          throw new Error(
            "JWT_SECRET 必须配置且长度≥32字符（生产安全要求）；请在 .env 设置随机长密钥后重启。",
          );
        }
        return { secret, signOptions: { expiresIn: "30d" } };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, RolesGuard],
  exports: [JwtAuthGuard, RolesGuard, JwtModule],
})
export class AuthModule {}
