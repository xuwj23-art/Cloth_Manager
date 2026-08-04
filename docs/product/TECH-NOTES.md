# 技术参考笔记（TECH-NOTES）

> ⚠️ **本文件是技术参考，不是权威约束。**
>
> 它记录"当前实现用了什么技术栈、有哪些已知技术债和坑"，目的是给重构提供**出发点**和**避坑清单**。
> 重构时**技术选型可自由重估**——只要满足 [`PRD.md`](./PRD.md) 的产品需求与业务规则，换框架/换 ORM/换数据库都视为合规。
>
> **权威性**：本文件 < `PRD.md`。本文件与代码冲突时，以代码为准并回头修正本文件。
>
> 版本：v1.0（2026-08-04）

---

## 1. 当前技术栈（现状快照，非推荐）

> 这一节描述"现在是什么样"，不等于"应该是什么样"。重构时可逐项重估。

| 层 | 现状选型 | 备注 |
|----|----------|------|
| 包管理 / 编排 | pnpm 10.34.1 + Turbo ^2.3.3 | monorepo |
| 移动端 | Expo ~54.0.35 / React Native 0.81.5 / React 19.1.0 | 仅 Android |
| 移动端关键库 | expo-camera, expo-sqlite, expo-updates, expo-dev-client, expo-secure-store, expo-haptics, expo-audio, expo-image-picker | |
| 后端 | NestJS ^10.4.15 + Prisma ^6.1.0 | |
| 后端其他 | @nestjs/jwt, bcryptjs, multer, sharp, qrcode, zod | |
| 数据库 | PostgreSQL 16 | |
| 共享包 | zod ^3.24.1（前后端共享类型/校验） | |
| 蓝牙打印原生模块 | 驰腾 CTPL SDK（`ctaiotCtpl1.1.8.jar`，Kotlin 封装） | 仅 Android，Expo Go 中降级 PDF |
| 部署 | 阿里云 Ubuntu + Docker（docker-compose.prod.yml） | |
| 分发 | EAS OTA（JS 改动）+ 本地 Gradle 打 APK + `/download` 页 | |

### 当前版本
- App `1.1.0`，Android `versionCode=2`，`runtimeVersion.policy="appVersion"`。
- channel：development(devClient APK) / preview(APK) / production(AAB)。
- `targetSdkVersion: 33`（刻意降级，兼容驰腾蓝牙 SDK 的广播注册，规避 Android 14 行为）。

---

## 2. 当前架构（现状）

```
cloth_scan/                      pnpm + turbo monorepo
├─ apps/
│  ├─ mobile/    Expo/RN 手机端（TypeScript）
│  │  ├─ src/screens/   各业务页面（无 React Navigation，App.tsx 手动切屏）
│  │  ├─ src/api.ts     REST 客户端    src/config.ts  后端地址
│  │  ├─ src/db|sync/   SQLite 离线缓存 + outbox 同步引擎
│  │  ├─ src/printer/   蓝牙标签打印（JS 封装 + 标签排版）
│  │  └─ modules/ct-printer/  驰腾打印机本地原生模块（Kotlin，仅 Android）
│  └─ server/    NestJS 后端 + Prisma + PostgreSQL
│     ├─ src/<module>/  auth / products / sales / uploads / download / health / prisma
│     └─ prisma/        schema.prisma + migrations/
├─ packages/
│  └─ shared/    前后端共享 Zod schema / 类型 / 常量（@cloth-scan/shared）
└─ docs/
```

**数据流**：手机扫码 → 本地 SQLite 优先匹配 → 购物车（共享纯函数）→ 结算进 outbox（乐观扣本地库存，断网可用）→ 同步引擎 push 到后端 → 后端事务扣库存、记流水、防超卖。

**API 约定**：除 `/download` 和 `/uploads/` 静态资源外，所有 API 在 `/api/v1` 前缀下（常量 `API_PREFIX`）。

---

## 3. 当前数据模型（Prisma 现状，重构可调整）

枚举：`UserRole(owner|staff)`、`StockMovementType(in|out|adjust|transfer)`、`SaleOrderStatus(draft|completed|voided)`。

| 模型 | 关键字段 |
|------|----------|
| Shop | name |
| User | shopId, phone(unique), passwordHash, role |
| Category | shopId, name（当前业务少用） |
| Product | archivedAt(软归档), deletedAt(软删除), coverImage, images[] |
| Sku | barcode(unique=QR内容), costPrice/salePrice(分), stock, version |
| StockMovement | type, quantity(±), opId(unique 幂等), refOrderId |
| SaleOrder | status, totalAmount(分), opId(unique) |
| SaleItem | price, cost(进价快照), subtotal |

迁移历史：`init` → `product_archive` → `add_saleitem_cost` → `product_soft_delete`。

---

## 4. 已知技术债与坑（重构的重点候选）

> 这些是试运行期间暴露的问题，重构时值得优先评估。**仅作参考，不强制重构必须解决所有项**。

### 4.1 移动端
- **无 React Navigation**：`App.tsx` 用 `useState<Screen>` 手动切屏 + `BackHandler` 逐级返回。屏幕增多后状态管理与返回栈管理变脆弱。评估引入导航库。
- **同步为"整目录拉取"**：商品量大时性能下降，后续可改增量同步（按 updatedAt/游标）。
- **联网检测用健康接口探测**：可接 `expo-network` 做更实时的网络状态。
- **`failed` 的 op 无 UI 重试/查看入口**。
- **蓝牙首次连接闪退**（厂商 CTPL SDK 初始化竞态）：已两次修复（列表打开即 init + 首次 connect 丢主线程 + 400ms 稳定窗口），待真机验证；若仍崩需 `adb logcat` 抓栈。详见归档进度记录。
- **扫码框范围限制已回退**：expo-camera 在该机型返回坐标不可靠，回退为原生扫码，绿框仅视觉。

### 4.2 后端
- **报表为实时查询聚合**：单量大时可加按天预聚合表或缓存。
- **图片为本地磁盘存储**：上线前应切对象存储（OSS/COS/R2）。
- **明文 HTTP**：后端目前明文，`app.json` 开了 `usesCleartextTraffic`。生产应上 HTTPS/域名。
- **无刷新令牌 / 登出黑名单 / 找回密码 / 手机验证码**：MVP 简化，店员密码重置/停用店员等管理操作待补。

### 4.3 工程化
- **`lint` 脚本缺 ESLint 二进制**：本机/各包未必装了，以 `typecheck` + `test` 为准。
- **改共享包必须先 build**：`packages/shared` 是 server 的依赖（编译产物），改完要 `pnpm --filter @cloth-scan/shared build`，否则 server 用旧类型。（mobile 经 Metro 直读源码，无需 build。）
- **OTA 与原生改动的版本协调**：改 `version` 会同时改 `runtimeVersion`，旧包收不到新 runtime 的 OTA；升版须 `expo prebuild -p android` → 重打包 → 再按新 runtime `eas update`。

### 4.4 平台/环境
- Windows / PowerShell：不能用 `&&` 串联命令，用 `;` 或分行。仓库 bash 脚本才用 `&&`。
- 本地 PG 宿主端口是 **55432**（不是 5432）。
- `.npmrc` 必须 `node-linker=hoisted`，否则 Metro 解析不到依赖。
- `apps/mobile/.env` 需含 `EXPO_NO_METRO_WORKSPACE_ROOT=1`（gitignore，换机要重建）。

---

## 5. 重构时的评估维度（建议清单）

这些是重构期间**值得重新做技术决策**的点（不预设答案）：

- 移动端是否引入导航库？状态管理方案（当前无全局状态管理）？
- 后端是否保持 NestJS？模块划分是否合理？是否过度耦合？
- ORM 是否保持 Prisma？数据库是否保持 PG？
- 离线同步引擎是否需要重写或换库（如 WatermelonDB / Turso / PowerSync）？
- 共享包的边界是否清晰？前后端类型共享方式是否最优？
- 是否引入测试体系（当前仅关键逻辑单测 + e2e 脚本）？端到端测试框架？
- 是否上 HTTPS / 对象存储 / CI/CD？
- 蓝牙打印模块的抽象是否便于测试与替换？

> 这些问题的答案在重构方案阶段（brainstorming + writing-plans）与你共同确定，本文件不预设。
