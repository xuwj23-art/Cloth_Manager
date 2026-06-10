# AGENTS.md — 项目向导（人类 & AI 必读）

> 本文件是接手本仓库的**第一入口**。无论你是人还是 AI，开工前请先读完「黄金规则」和「架构速览」两节。
> 目标：让任何人/Agent 都能**快速、准确、可靠**地理解并继续开发本项目。
> 文档与代码冲突时，**以代码为准**，并顺手修正文档。

---

## 1. 这是什么

**服装进销存（cloth_scan）**：面向小型服装零售店的进销存 App。核心场景——**给每件衣服打二维码吊牌，收银时扫码秒匹配商品、自动扣库存、出销售报表**。主要面向"软件零基础"店主，强调稳定、简单、二维码驱动。

- **形态**：Android 手机 App（Expo/RN）+ 自建后端（NestJS）+ PostgreSQL。
- **当前状态**：已在店内**试运行**（未上架应用商店），后端部署在阿里云，通过本地打包 APK + `/download` 页面分发。
- **全栈 TypeScript**，monorepo，前后端共享类型与校验，便于 AI 辅助开发。

---

## 2. 黄金规则（最容易踩坑，务必遵守）

1. **金额一律用「分」（整数）**：数据库、API、共享类型里的 `costPrice/salePrice/price/cost/subtotal/totalAmount` 全是分。只有 UI 展示时除以 100 显示「元」。新写代码不要引入浮点元。
2. **库存只通过 `StockMovement` 流水增减**：建档初始库存写 `in`、销售写 `out`、盘点/改单写 `adjust`。不要直接裸改 `Sku.stock` 而不记流水（`stock` 是流水累计的物化结果）。
3. **`opId` 幂等**：销售开单 / 库存流水带客户端生成的 `opId`（unique）。离线重传同一 `opId` 不得重复扣减。改动开单/同步逻辑时必须保留幂等。
4. **删除是软删除**：商品用 `deletedAt`（且必须先 `archivedAt` 售罄/下架才能删）、订单删除会回滚库存。**删除商品不删除任何图片**（保留历史账单可看图，这是已确认的策略）。永远不要物理删 Product/Sku，会破坏销售外键与报表。
5. **门店隔离**：几乎所有查询都要带 `shopId`（从 JWT 取，不要信任客户端传入）。新接口默认按当前用户 `shopId` 过滤。
6. **角色权限**：`owner`（店主）能做一切；`staff`（店员）只能登录/查商品/扫码/开单。后端用 `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles("owner")` 控制，前端按角色隐藏入口。**权限以后端为准**。
7. **改了共享包要先 build**：`packages/shared` 是 server 的依赖（编译产物），改完跑 `pnpm --filter @cloth-scan/shared build`，否则 server 用的是旧类型。（mobile 经 Metro 直读 shared 源码，无需 build。）
8. **Windows / PowerShell**：本机是 PowerShell，**不能用 `&&` 串联命令**，用 `;` 或分行。仓库里的 bash 脚本（部署文档）才用 `&&`。
9. **提交规范**：用 Conventional Commits（`feat:` `fix:` `docs:` `chore:`），中文描述正文。仅在用户明确要求时才 commit/push。
10. **改完必做自检**：对应包跑 `typecheck` + `test`；后端改业务逻辑要保证 `vitest` 全绿。

---

## 3. 架构速览

```
cloth_scan/                      pnpm + turbo monorepo
├─ apps/
│  ├─ mobile/    Expo/React Native 手机端（TypeScript）
│  │  ├─ src/screens/   各业务页面（无 React Navigation，App.tsx 手动切屏）
│  │  ├─ src/api.ts     REST 客户端    src/config.ts  后端地址 API_HOST
│  │  ├─ src/db|sync/   SQLite 离线缓存 + outbox 同步引擎
│  │  ├─ src/printer/   蓝牙标签打印（JS 封装 + 标签排版）
│  │  └─ modules/ct-printer/  驰腾打印机本地原生模块（Kotlin，仅 Android）
│  └─ server/    NestJS 后端 + Prisma + PostgreSQL
│     ├─ src/<module>/  auth / products / sales / uploads / download / health / prisma
│     └─ prisma/        schema.prisma + migrations/
├─ packages/
│  └─ shared/    前后端共享 Zod schema / 类型 / 常量（@cloth-scan/shared）
├─ docs/         研发方案、阶段文档、部署/打包指南（见 §9）
├─ tools/        E2E 脚本（PowerShell）
├─ docker-compose.yml        本地开发 PostgreSQL
├─ docker-compose.prod.yml   生产 PostgreSQL + server（+ APK 下载目录挂载）
└─ AGENTS.md / README.md
```

**数据流**：手机端扫码 → 本地 SQLite 优先匹配 → 购物车（共享纯函数 `cart.ts`）→ 结算进 outbox（乐观扣本地库存，断网可用）→ 同步引擎 push 到后端 → 后端事务扣库存、记流水、防超卖。

**请求约定**：所有 API 在 `/api/v1` 前缀下（常量 `API_PREFIX`）；唯一例外是公开下载页 `/download` 和 `/download/app.apk`（在 `main.ts` 里 exclude 出前缀）。图片静态服务在 `/uploads/`。

---

## 4. 技术栈与版本

| 层 | 选型 | 版本 |
|----|------|------|
| 包管理 | pnpm | 10.34.1（corepack 固定，`packageManager` 字段） |
| 任务编排 | Turbo | ^2.3.3 |
| Node | — | ≥ 20（Docker 用 node:20-bookworm-slim） |
| 后端 | NestJS / Prisma | ^10.4.15 / ^6.1.0 |
| 后端其他 | @nestjs/jwt, bcryptjs, multer, sharp, qrcode, zod | — |
| 数据库 | PostgreSQL | 16-alpine |
| 移动端 | Expo / React Native / React | ~54.0.35 / 0.81.5 / 19.1.0 |
| 移动端关键库 | expo-camera, expo-sqlite, expo-updates, expo-dev-client, expo-secure-store, expo-haptics | — |
| 共享 | zod | ^3.24.1 |

---

## 5. 本地开发：从零跑起来

```bash
# 0) 安装依赖（仓库根目录）
pnpm install

# 1) 构建共享包（server 依赖编译产物）
pnpm --filter @cloth-scan/shared build

# 2) 起本地数据库（Docker Desktop）。注意：宿主机端口是 55432
docker compose up -d

# 3) 后端环境变量：复制 apps/server/.env.example 为 apps/server/.env
#    用 docker-compose.yml 时把 DATABASE_URL 端口改成 55432
#    本地若要测注册，需手动加一行 REGISTER_CODE=任意码（见 §6 环境变量）

# 4) 生成 Prisma Client + 建表 + 灌演示数据
pnpm --filter @cloth-scan/server prisma:generate
pnpm --filter @cloth-scan/server prisma:migrate
pnpm --filter @cloth-scan/server db:seed     # 演示账号 13800000000 / 123456

# 5) 启后端（热更新）→ 验证 http://localhost:3000/api/v1/health => {"status":"ok","db":"up"}
pnpm --filter @cloth-scan/server dev

# 6) 启手机端：先把 apps/mobile/src/config.ts 的 API_HOST 改成你电脑局域网 IP
pnpm --filter @cloth-scan/mobile start       # Expo Go 扫码运行（蓝牙打印等原生功能需 dev-client/APK）
```

**常用校验命令**

| 命令 | 作用 |
|------|------|
| `pnpm --filter @cloth-scan/server typecheck` | 后端类型检查 |
| `pnpm --filter @cloth-scan/server test` | 后端单测（vitest，25 例） |
| `pnpm --filter @cloth-scan/server build` | `nest build`（Docker 也用它） |
| `pnpm --filter @cloth-scan/mobile typecheck` | 移动端类型检查 |
| `pnpm --filter @cloth-scan/shared build && ...test` | 共享包构建/测试 |
| `pnpm --filter @cloth-scan/server prisma:studio` | 可视化看库 |

> ⚠️ `lint` 脚本存在但本机/各包未必装了 ESLint 二进制，跑不起来属环境问题，不代表代码有错。以 `typecheck` + `test` 为准。

---

## 6. 后端 `apps/server`

### 6.1 模块职责（`src/app.module.ts`）

| 模块 | 职责 |
|------|------|
| `prisma/` | PrismaClient 单例 |
| `auth/` | 注册（需邀请码）/登录/JWT/`me`/店员增删查；`@Global` 导出 `JwtAuthGuard`、`RolesGuard`、`@Roles` |
| `products/` | 建档、列表（active/archived/all）、编辑、盘点、软归档、软删除、按条码匹配、演示数据 |
| `sales/` | 开单（事务+幂等+防超卖）、流水、报表、编辑账单、删除整单 |
| `uploads/` | 图片上传 + sharp 压缩主图/缩略图（仅 owner） |
| `download/` | 公开 APK 下载页 `/download`（服务端生成二维码，流式发送 APK） |
| `health/` | `GET /api/v1/health` |

### 6.2 数据模型（`prisma/schema.prisma`）

枚举：`UserRole(owner|staff)`、`StockMovementType(in|out|adjust|transfer)`、`SaleOrderStatus(draft|completed|voided)`。

| 模型 | 关键字段 | 备注 |
|------|----------|------|
| `Shop` | name | 多租户根 |
| `User` | shopId, phone(unique), passwordHash, role | 登录主体 |
| `Category` | shopId, name | 当前业务少用 |
| `Product` | archivedAt(软归档), deletedAt(软删除), coverImage, images[] | 一个「款」 |
| `Sku` | barcode(unique=QR内容), costPrice/salePrice(分), stock, version | 颜色×尺码的具体单品 |
| `StockMovement` | type, quantity(±), opId(unique 幂等), refOrderId | 库存唯一真相来源 |
| `SaleOrder` | status, totalAmount(分), opId(unique) | 一笔销售单 |
| `SaleItem` | price, cost(进价快照), subtotal | 报表利润 = Σ(price−cost) |

### 6.3 关键业务逻辑去哪找

| 能力 | 位置 |
|------|------|
| 注册邀请码校验（`REGISTER_CODE`） | `auth/auth.service.ts`（未配置则禁止注册） |
| JWT/角色守卫 | `auth/jwt-auth.guard.ts`、`auth/roles.guard.ts`、`auth/roles.decorator.ts` |
| 售罄自动归档/补货恢复/已删不复活 | `products/products.service.ts` `recomputeArchive` |
| 商品软删除（须先 archived，不删图） | `products/products.service.ts` `deleteProduct` |
| 列表过滤（deletedAt:null + scope） | `products/products.service.ts` `listProducts` |
| 销售开单（事务/幂等/防超卖/售罄归档） | `sales/sales.service.ts` `createSale` |
| 账单编辑（改价/改量/删行，不能加货） | `sales/sales.service.ts` `editOrder` |
| 删除整单（回滚库存） | `sales/sales.service.ts` `deleteOrder` |
| 销售报表（today/week/month + 利润 + 下钻） | `sales/sales.service.ts` `report` |
| 图片压缩/缩略图 | `uploads/uploads.controller.ts`（sharp，主图1280/缩略320） |

### 6.4 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL` | ✅ | PG 连接串（本地 docker 端口 55432） |
| `JWT_SECRET` | ✅ | 生产必须改随机长串 |
| `REGISTER_CODE` | 生产✅ | 注册邀请码；**未设置=关闭注册**。本地测注册需手动加 |
| `PORT` | ✗ | 默认 3000 |
| `DB_PASSWORD` | 生产✅ | 仅 `docker-compose.prod.yml` 用（根目录 `.env`） |

### 6.5 迁移

按时间顺序：`init` → `product_archive`(archivedAt) → `add_saleitem_cost`(cost) → `product_soft_delete`(deletedAt)。
容器启动时自动 `prisma migrate deploy && node dist/main.js`（见 `apps/server/Dockerfile`）。**改 schema 后必须新建迁移**，不要只改 schema 不生成迁移。

### 6.6 API 路由速查（除 `/download` 外都带 `/api/v1`）

| 方法 路径 | 角色 |
|-----------|------|
| POST `/auth/register`（需 inviteCode）/ `/auth/login` | 公开 |
| GET `/auth/me` | 登录 |
| GET/POST/DELETE `/auth/staff` | owner |
| POST/GET/PATCH/DELETE `/products*`、POST `/products/demo` | owner（列表/扫码=登录） |
| GET `/skus/by-barcode/:barcode` | 登录 |
| POST `/sales`（开单=owner+staff）、GET/PATCH/DELETE 其余 | owner |
| POST `/uploads` | owner |
| GET `/health` | 公开 |
| GET `/download`、`/download/app.apk` | 公开（无前缀） |

---

## 7. 移动端 `apps/mobile`

### 7.1 屏幕与导航
无 React Navigation：`App.tsx` 用 `useState<Screen>` 切屏 + `BackHandler` 逐级返回；`AuthProvider` 决定登录态、登录后包 `SyncProvider`。

| 屏幕 | 职责 |
|------|------|
| `LoginScreen` | 登录 / 注册门店 |
| `HomeScreen` | 入口、今日营业额（新手引导已移除） |
| `CashierScreen` | 扫码收银、购物车、结算确认弹窗 |
| `ProductsScreen` / `CreateProductScreen` / `EditProductScreen` | 商品列表 / 建档 / 编辑下架 |
| `LabelPrintScreen` | 标签打印（蓝牙 / PDF 降级） |
| `SalesScreen` / `SaleDetailScreen` | 报表流水 / 单据详情·编辑·删除（owner） |
| `StaffScreen` | 店员管理（owner） |

### 7.2 网络 & 后端地址
`src/config.ts` 的 `API_HOST` 是后端地址：
- 当前指向阿里云公网 `http://39.108.186.58:3000`（试运行）。
- 本地调试改成电脑局域网 IP，或 Android 模拟器用 `http://10.0.2.2:3000`。
- 后端目前**明文 HTTP**，`app.json` 已开 `usesCleartextTraffic: true`。

`src/api.ts` 封装全部 REST + Bearer token；`imageUrl/thumbUrl` 拼接静态图地址；`ApiError` 带 HTTP status（同步引擎据此区分重试/失败）。

### 7.3 离线同步
`src/db/database.ts`（SQLite：`skus_cache` + `outbox`）+ `src/sync/sync.ts`（先 push outbox 后 pull 目录）+ `src/sync/sync-context.tsx`（15s 自动同步）。

### 7.4 蓝牙标签打印（驰腾 CTPL / X1）
- 原生模块 `modules/ct-printer/`（Kotlin 封装厂商 jar，**仅 Android**）；Expo Go 中模块为 null → 自动降级 PDF。
- `src/printer/ctPrinter.ts`：权限、SPP/BLE 自动连接、打印。
- `src/printer/labelLayout.ts`：`buildCtPrintJob()` 用 mm 排版（默认 60×40mm，二维码居中 + SKU 条码 + 全角￥价格），原生按 DPI 换算，203/300dpi 通用。

### 7.5 EAS / app.json 要点
- `runtimeVersion.policy = "appVersion"`；`updates.url` 指向 Expo（owner `wesleysho`，projectId `3b8070f8-...`）。
- channel：`development`(devClient APK) / `preview`(APK) / `production`(AAB)。
- **`targetSdkVersion: 33`**（刻意降级，兼容驰腾蓝牙 SDK 的广播注册，规避 Android 14 行为）。
- 权限：CAMERA、BLUETOOTH_*、LOCATION、POST_NOTIFICATIONS。

---

## 8. 共享包 `packages/shared`

前后端共用，改这里同时影响双端（注意 §2 规则 7）。导出：`API_PREFIX`、枚举（`enums.ts`）、鉴权（`auth.ts`）、商品 + `expandSkuMatrix`（`product.ts`）、库存（`inventory.ts`）、销售 DTO/响应（`sale.ts`）、购物车纯函数（`cart.ts`：`addToCart/addToCartQty/setQuantity/setLinePrice/cartToSaleInput`）。购物车与建档逻辑有 vitest 单测。

---

## 9. 构建 · 部署 · 分发

| 场景 | 怎么做 | 详见 |
|------|--------|------|
| **JS/界面改动**（占绝大多数） | OTA：`cd apps/mobile && eas update --channel preview -m "说明"`，手机重开 App 即生效、**免重装** | `docs/本地打包环境部署指南-Windows.md` |
| **原生改动**（权限/插件/原生模块/targetSdk） | 本地 `pnpm --filter @cloth-scan/mobile build:android` → APK 在 `android/app/build/outputs/apk/release/` | 同上 §3 |
| **后端改动** | 服务器 `git pull` + `docker compose -f docker-compose.prod.yml up -d --build`（迁移自动跑） | `docs/服务器部署指南.md` |
| **给别人装 APK** | 下载页 `http://39.108.186.58:3000/download`；更新：`scp app-release.apk root@39.108.186.58:/opt/Cloth_Manager/apk/app.apk` | `docs/本地打包环境部署指南-Windows.md` §7 |

本地打包前提：`apps/mobile/.env` 需含 `EXPO_NO_METRO_WORKSPACE_ROOT=1`（gitignore，换机要重建）。
EAS↔本地 APK 签名不同，互换需先卸载旧 App；本地版之间可覆盖安装。

**运维**：数据库每日自动备份脚本 `ops/db-backup.sh`（cron + gzip + 14 天滚动清理），启用与恢复见 `docs/服务器部署指南.md`「数据库备份与恢复」。2G 内存建议加 2G swap（同文档）。

**文档索引（`docs/`）**：
- `服装进销存App-MVP研发方案.md` — 总体方案/路线
- `进度记录.md` — 各阶段完成情况（开发日志）
- `权限说明-老板与员工.md` — 用户视角权限表
- `服务器部署指南.md` — 阿里云 Docker 生产部署/运维/升级
- `本地打包环境部署指南-Windows.md` — 打包/OTA/下载页分发
- `到货自检清单-蓝牙打印.md` — 打印机联调
- `stages/01..05A-*.md` — 各功能阶段的设计细节

---

## 10. 已知坑（踩过的，别再踩）

| 坑 | 真相 / 对策 |
|----|------------|
| Metro 解析不到依赖 | `.npmrc` 必须 `node-linker=hoisted` |
| release 打包入口指向 repo 根报错 | `apps/mobile/.env` 写 `EXPO_NO_METRO_WORKSPACE_ROOT=1` |
| 本地 PG 连不上 | `docker-compose.yml` 宿主端口是 **55432**，不是 5432 |
| 注册总是失败/被拒 | 后端没配 `REGISTER_CODE`（=关闭注册）或邀请码不匹配 |
| 蓝牙打印在 Expo Go 不可用 | 需 dev-client/APK；Expo Go 中自动降级 PDF |
| PowerShell 报 `&&` 语法错 | 用 `;` 或分行 |
| git push 连不上 GitHub | 多为本机代理端口问题，检查 `git config --get http.proxy` 与实际代理端口是否一致 |
| scp 传 APK 报 `Permission denied (publickey)` | 服务器只认密钥；需把本机公钥加到服务器 `~/.ssh/authorized_keys`（见 `docs/本地打包环境部署指南-Windows.md` §7）。scp 要在**本机**跑，目标不带 `http://`/`:3000` |
| 提交信息 heredoc 在 PowerShell 失败 | 把信息写临时文件用 `git commit -F 文件` |
| 改 schema 不生效 | 必须新建迁移；生产靠 `prisma migrate deploy` |

---

## 11. 维护本文件

新增模块/接口/数据模型/部署方式，或推翻了某条约定时，**同步更新本文件相应小节**（尤其 §2 黄金规则、§6.6 路由表、§9 部署）。让 AGENTS.md 始终是项目的"可信地图"。
