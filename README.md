# 服装进销存 App（cloth_scan）

面向小型服装零售商铺的进销存 App：**扫吊牌二维码（QR）秒匹配商品，售出自动扣库存**。  
全栈统一 **TypeScript**，方便零基础 + AI 辅助开发。

> 👉 **接手开发（人或 AI）请先读 [`AGENTS.md`](AGENTS.md)** —— 项目向导、黄金规则、架构、部署、踩坑清单的统一入口。
> 产品需求（权威）见 [`docs/product/PRD.md`](docs/product/PRD.md)；文档分层导航见 [`docs/README.md`](docs/README.md)。历史规划/开发日志见 `docs/archive/`（仅供溯源）。

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
docker compose up -d   # 注意：宿主机端口是 55432

# 2) 准备后端环境变量
#    复制 apps/server/.env.example 为 apps/server/.env
#    用本地 docker compose 时把 DATABASE_URL 端口改成 55432
#    若要测试注册，需再加一行 REGISTER_CODE=任意码（不设=关闭注册）

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

| 命令                                             | 作用               |
| ------------------------------------------------ | ------------------ |
| `pnpm install`                                   | 安装依赖           |
| `pnpm --filter @cloth-scan/shared build`         | 构建共享包         |
| `pnpm --filter @cloth-scan/server dev`           | 启动后端（热更新） |
| `pnpm --filter @cloth-scan/server prisma:studio` | 可视化查看数据库   |
| `pnpm --filter @cloth-scan/mobile start`         | 启动手机 App       |
| `pnpm --filter @cloth-scan/shared test`          | 跑共享包单元测试   |

---

## 已实现（试运行版）

- ✅ 鉴权：注册（邀请码）/登录/JWT/角色（店主·店员）/门店隔离
- ✅ 商品：拍照建档 + 批量 SKU、编辑/盘点、售罄自动归档、软删除（不删图）
- ✅ 收银：摄像头扫 QR 匹配、购物车、结算确认、离线优先 + 同步引擎（SQLite + outbox）
- ✅ 销售：事务扣库存 + 幂等防超卖、流水、报表（今日/本周/本月 + 利润下钻）、账单编辑/删除
- ✅ 蓝牙标签打印（驰腾 X1 / CTPL，本地原生模块，Expo Go 降级 PDF）
- ✅ 部署：阿里云 Docker 生产环境、EAS OTA 热更新、本地 APK 打包、`/download` 下载页

详细进度见 [`docs/archive/进度记录.md`](docs/archive/进度记录.md)。

## 后续可选方向

- HTTPS / 域名、对象存储（OSS）、CI/CD
- 大库存找货能力（搜索 / 扫码找货 / 入库时间筛选，已设计待开发）
- 应用商店上架
