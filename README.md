# 服装进销存 App（cloth_scan）

面向小型服装零售商铺的进销存 App：**扫吊牌二维码（QR）秒匹配商品，售出自动扣库存**。  
全栈统一 **TypeScript**，方便零基础 + AI 辅助开发。

> 完整研发方案见 [`docs/服装进销存App-MVP研发方案.md`](docs/服装进销存App-MVP研发方案.md)

---

## 项目结构（Monorepo）

```
cloth_scan/
├─ apps/
│  ├─ mobile/      # 手机 App（Expo / React Native + TypeScript）
│  └─ server/      # 后端 API（NestJS + Prisma + PostgreSQL）
├─ packages/
│  └─ shared/      # 前后端共享：数据类型 + Zod 校验
├─ docs/           # 研发方案与规格文档
├─ docker-compose.yml  # 本地 PostgreSQL 数据库
└─ pnpm-workspace.yaml
```

---

## 一次性准备

已确认环境：Node ≥ 20、git、pnpm（已通过 corepack 启用）。

```bash
# 1) 安装所有依赖（在项目根目录执行）
pnpm install

# 2) 构建共享包（前后端都依赖它）
pnpm --filter @cloth-scan/shared build
```

---

## 启动后端

```bash
# 1) 启动本地数据库（需已安装 Docker Desktop）
docker compose up -d

# 2) 准备后端环境变量
#    复制 apps/server/.env.example 为 apps/server/.env（默认值即可配合 docker compose 使用）

# 3) 生成 Prisma 客户端 + 建表
pnpm --filter @cloth-scan/server prisma:generate
pnpm --filter @cloth-scan/server prisma:migrate

# 4) 写入演示数据（会打印「门店ID」和演示条码）
pnpm --filter @cloth-scan/server db:seed

# 5) 启动后端（开发模式，热更新）
pnpm --filter @cloth-scan/server dev
```

启动后访问 `http://localhost:3000/api/v1/health` 应返回 `{"status":"ok","db":"up"}`。

> 没有安装 Docker？也可以用一个免费的托管 PostgreSQL，把连接串填到 `apps/server/.env` 的 `DATABASE_URL` 即可。

---

## 启动手机 App

```bash
# 1) 把后端地址改成「你电脑的局域网 IP」
#    编辑 apps/mobile/src/config.ts 的 API_HOST，例如 http://192.168.1.100:3000
#    （手机和电脑要连同一个 WiFi）

# 2) 启动 Expo
pnpm --filter @cloth-scan/mobile start
```

然后用手机装 **Expo Go** App 扫描终端里的二维码即可运行。  
在 App 里点「扫码收银」，对准用演示条码（如 `DEMO-WHITE-M`）生成的二维码，即可看到商品卡片。

> 提示：可用任意「二维码生成器」把演示条码文本生成 QR 图片来测试扫码。

---

## 常用命令

| 命令 | 作用 |
|------|------|
| `pnpm install` | 安装依赖 |
| `pnpm --filter @cloth-scan/shared build` | 构建共享包 |
| `pnpm --filter @cloth-scan/server dev` | 启动后端（热更新） |
| `pnpm --filter @cloth-scan/server prisma:studio` | 可视化查看数据库 |
| `pnpm --filter @cloth-scan/mobile start` | 启动手机 App |
| `pnpm --filter @cloth-scan/shared test` | 跑共享包单元测试 |

---

## 已实现（脚手架阶段）

- ✅ Monorepo + 全栈 TypeScript + 共享类型/校验
- ✅ 数据模型（Prisma）：门店/用户/商品/SKU/库存流水/销售单
- ✅ 后端接口：健康检查、商品建档、**按条码扫码匹配**、**销售开单（事务扣库存 + 幂等防超卖）**
- ✅ 手机 App：首页 + **摄像头扫 QR 匹配商品** 演示

## 下一步（待开发）
- 登录鉴权（替换接口里临时的 `shopId` 传参）
- 建档界面（拍照 + 批量 SKU）
- 离线优先本地库 + 同步引擎
- 报表、权限、新手引导、监控与部署
