# 建档页：三图 + 人工项 + AI/手动双路径 Implementation Plan

> **For agentic workers:** 按 Task 顺序实现。每个 Task 含 Files、Steps（`- [ ]`）、命令与 Expected。Windows PowerShell 用 `;` 不用 `&&`。改完 shared 后跑 typecheck/test（server typecheck 经 paths 读 shared 源码，不必先 build；`nest build`/部署前仍需 `pnpm --filter @cloth-scan/shared build`）。金额一律用分。本计划**只改建档/编辑与识图草稿**，不接微信小店、不改收银主路径。

**Goal:** 店员建档时必须拍满正面/反面/细节三张图；尺码默认均码、材质默认「默认」、售价库存仍手填；可走「AI 入库」识图填名称/品类/颜色（人可改），或走「手动入库」一次填完。识图失败不能空标题保存。

**Architecture:** 共享预设与映射纯函数 → Prisma 落材质/品类名 + `images[]` → 服务端识图接口（读本地已上传 JPEG，转 base64 调视觉模型，**不要**用公网 URL）→ 手机建档两段式界面。无密钥时服务照常启动，AI 按钮提示改走手动。识图对不上芯片时写入**自定义短词**，不回落到「默认」。网络/限流/5xx **自动重试**；密钥无效、欠费等 **立刻失败并提示手动**。

**Tech Stack:** TypeScript / Zod / NestJS / Prisma / Expo RN / vitest。视觉默认走**阿里云百炼 Qwen3-VL**（国内、中文品类、和现网阿里云同机房）；接口做成 provider，便于以后换智谱衣物识别 / Grok。环境变量见 Task 3。

---

## 给店员看的流程（实现必须长这样）

### 第一屏（默认，两种入口共用）

从上到下：

1. **三张图（必拍满）**：格子标题写「正面」「反面」「细节」。每格可拍照或相册。正面 = 收银封面 = `images[0]`。
2. **要人手填的项（非 AI）**
   - 材质：芯片，**默认已勾「默认」**，可改选现有材质库
   - 尺码：芯片，**默认已勾「均码」**，可多选
   - 进价（可选）、**售价（必填）**、库存（默认 1）
3. 底部两个大按钮并排：**AI 入库** | **手动入库**
   - 未拍满 3 张：两个按钮都不可用，文案「请拍满正面、反面、细节」
   - 未填售价：可点 AI（先认图），但最终「确认建档」仍要售价

### 走 AI 入库

1. 点「AI 入库」→ 全屏半透明遮罩 + 转圈，文案「正在识别正面图…」（**只用正面图**，反面/细节不上传给模型，为了快；三张仍都要存档）。最少展示约 0.6 秒，避免闪一下。超时 15 秒。
2. 识别结束弹出**核对页（二级界面，Modal，不是新导航页）**，只含 AI 负责的项：
   - 商品名称（可改字）
   - 品类（芯片，可改点）
   - 颜色（芯片，可改点；建档这一件默认单色，仍允许多选）
   - 底部：**取消** | **确认**
3. 取消：关掉核对页，回到第一屏，图和人手项都还在。
4. 确认：关掉核对页，第一屏**展开成完整建档页**（人手项 + 名称/品类/颜色都可见可改），底部主按钮变成 **确认建档**；左下保留较小的「重新识别」。
5. 点确认建档 → 走现有 `createProduct`（带 3 图 + 材质 + 色码 SKU）。

### 走手动入库

点「手动入库」后，同一页直接展开名称/品类/颜色（不弹核对页）。名称可空着先点材质+品类自动拼；若仍空则**禁止保存**（不再生成「未命名商品」）。底部 **确认建档**；**左侧较小「AI 入库」**：已有 3 张图则可随时改走识图（弹出同一核对页）。无图则提示先拍照。

### 识图等待与失败（必须按此分类）

遮罩文案随状态变：「正在识别正面图…」→「网络不稳，正在重试（2/3）…」。

**会自动重试（最多 3 次，间隔约 0.8s、2s）：** 超时、断网、连接重置、HTTP 429/500/502/503/504、上游暂时不可用。店员不用点，转圈等着。

**立刻失败、不要重试、必须说人话并引导手动：**

- 没配密钥 / Key 无效 →「识图暂未开通（密钥无效），请改用手动入库」
- 欠费、余额不足、额度用尽 →「识图额度不足，请改用手动入库」
- 内容审核拒绝 →「这张图无法识别，请重拍正面或改用手动入库」

重试用尽仍是网络类错误：遮罩消失，红字「识别超时，请点重试或改用手动入库」，并留 **重试** 按钮（再走同一套 3 次）。不改已经填好的材质/尺码/价钱。标题保持空，不能保存。

---

## 对原思路的优化（已拍板，执行时不要改回）

| 原思路                           | 优化                                                                                                                 | 为什么                                                 |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 非 AI 项没写售价                 | **售价放第一屏且最终必填**                                                                                           | 现在收银建档就靠售价，漏了无法卖                       |
| AI 用三张图还是正面              | **v1 只用正面**                                                                                                      | 一张更快、更省；反面/细节给人看、给以后小店头图        |
| 二级界面                         | **Modal 核对页，不是新路由**                                                                                         | 取消不丢图；返回栈简单                                 |
| 确认后「合并成完整页再确认建档」 | 保留这两步                                                                                                           | 人手项和 AI 项都还能改，防识图填错直接落库             |
| 手动时左侧留 AI                  | 保留；做成底栏左侧小按钮                                                                                             | 改主意不用重进页面                                     |
| 尺码默认均码、材质默认「默认」   | 作为**已勾选的芯片**，不要再静默填看不见的值                                                                         | 「均码」直播也看得懂；材质「默认」店内能卖，直播前可改 |
| 颜色对不上芯片                   | **AI 路径：对不上就自定义短词（如酒红、墨绿），不要改成「默认」**；印花/多色用「花色」。手动路径未选颜色才用「默认」 | 识图给出了颜色就要留下，让人改比悄悄丢掉准             |

**本期不做：** 微信同步、以图搜款、识图填材质/尺码、识图完直接保存不问人、标题允许空。

---

## 识图结果：固定芯片还是自定义？

**规则：先对现有芯片；对不上 → 自定义短词进核对页（已勾选），禁止回落到「默认」。禁止模型自由发挥一长串。**

芯片来源（从 `CreateProductScreen` 抽到 `packages/shared`，前后端共用）：

- 颜色：`黑 白 灰 红 蓝 绿 黄 粉 卡其`（系统值仅 **花色** = 印花/多色；**「默认」只用于手动没选颜色**，识图不得用它顶替认出来的色）
- 品类：现有 `PRESET_CATEGORIES`（连衣裙、T恤、衬衫…）
- 材质/尺码：**不识图**，只用人工芯片

映射：

1. **颜色**
   - 命中 9 色或同义词（大红→红、藏青→蓝、米白→白、卡其/khaki→卡其）→ 勾该芯片
   - 印花/碎花/撞色/多色 → 自定义芯片「花色」
   - 对不上 → 把模型词收成 **≤6 个汉字** 的自定义颜色（酒红、墨绿、驼色），在核对页作为已选芯片，店员可改回预设
   - 模型没给颜色 → 自定义「未识别色」（仍不要改成「默认」）  
     不要把 RGB 或「浅卡其偏黄」整句当颜色。
2. **品类**  
   同义词命中预设（裙子→连衣裙、tee→T恤）。对不上 → 模型短词当**一条自定义品类**（≤10 字），核对页已选中。
3. **名称**  
   自由文本，保存前截成 5～60 字。若短于 5 字，用「颜色+品类」拼（例：酒红 + 连衣裙 →「酒红连衣裙」）。禁止「未命名商品」。

服务端提示词必须带上完整芯片列表，并要求 **只输出 JSON**（`name`, `category`, `color`），由共享函数再映射一次。

---

## 识图供应商调研（2026-08-23）与本期选择

店里要的是：一张衣架/平铺图 → **名称 + 品类 + 颜色** 草稿。市面上分两类，**没有哪家公布过「杂款衣架实拍」的公开准确率**，下表是能力匹配，不是实验室分数。

| 类型               | 代表                                                          | 能直接给什么                                                       | 速度/价（公开标价，会变）                                        | 对本店                                                         |
| ------------------ | ------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| 传统商品分类       | 腾讯云「商品识别」DetectProduct                               | 品类名+置信度+框，例「男士西服套装」。**没有颜色、没有可编辑标题** | 约 2.5 元/千次；每月 1000 次免费；国内快                         | 只解决品类 1/3，还要再接视觉模型拼名称颜色，不划算             |
| 传统商品分类       | 阿里云 VIAPI ClassifyCommodity                                | 商品类目+置信度。服饰鞋包在支持列表。**无颜色/标题**               | 按量，国内                                                       | 同上                                                           |
| 传统打标/颜色      | 阿里云 通用打标、RecognizeImageColor                          | 物体标签；或 RGB 占比                                              | 打标约 0.0025 元/次                                              | RGB 对不上「卡其/酒红」芯片，单独不够                          |
| **服装专用结构化** | **智谱衣物识别** `clothes_recognition_agent`                  | 品类、颜色、材质、款式、领型等一串属性                             | 约 4 元/百万 tokens；国内                                        | **属性最贴服装**；名称仍要我们拼；材质我们规定不采用           |
| **通用视觉大模型** | **阿里云百炼 Qwen3-VL**（`qwen3-vl-plus` / 文档当前视觉型号） | 按我们的 JSON 出名称+品类+颜色；中文好                             | 视觉模型按 token，单张大约分到厘～几分；国内、和现网阿里云同区域 | **本期首选**：一张图同时三项、可约束芯片列表、延迟通常 1～3 秒 |
| 通用视觉大模型     | xAI Grok 4.6 图像理解                                         | 同样可出 JSON                                                      | 按 token；服务器在国内访问美国，延迟和付费（美元）不稳定         | 能力够，作备选 provider，不作 v1 默认                          |
| 通用视觉大模型     | 百度图像识别 / 看图识万物                                     | 通识标签、问答                                                     | 次数包；偏百科                                                   | 不按我们芯片出结构化字段，难用                                 |
| 以图搜款           | 谷歌 Product Recognizer、腾讯图片检索                         | 在**自建图库**里找相似款                                           | 要先建库                                                         | PRD 已排除；杂款店不适用                                       |

**本期拍板：** 服务端 `GarmentVisionProvider` 接口；**v1 实现阿里云百炼 Qwen 视觉**（`DASHSCOPE_API_KEY` 或百炼 `API_KEY`，实现时以百炼文档为准）。密钥无效/欠费走「立刻失败」文案。智谱衣物识别列为 v2 可插拔（若实测品类更准再换）。不要为了分类 API 再拼一套颜色识别。

实现前打开并按页面上的 **当前 model id** 接线，不要写死过期名字：  
https://help.aliyun.com/zh/model-studio/vision  
https://help.aliyun.com/zh/model-studio/models

---

## Global Constraints

- 金额分；库存只经 `StockMovement`；建档初始库存仍写 `in` 流水（现有 `createProduct`）
- 门店隔离：识图接口也走 JWT，只认当前店主已上传的图片路径，禁止任意 URL/路径穿越
- PowerShell 用 `;`
- Conventional Commits，中文正文；**仅在用户明确要求时才 commit**
- 无视觉密钥：**服务能启动**，识图接口返回 503 + 中文「识图暂未开通，请改用手动入库」
- 演示数据 `seedDemo` **不要**强制 3 张图（继续无图可灌）
- 手机新建档 UI **强制** 3 张图
- 2G 内存服务器：识图只发已压缩主图 JPEG（uploads 已是最长边 1280），不要原片

---

## Task 1: 共享预设 + 映射纯函数 + 单测

**Files:**

- Create: `packages/shared/src/catalog-presets.ts`（颜色/尺码/材质/品类常量、同义词、映射函数、标题规范化）
- Modify: `packages/shared/src/index.ts`（导出）
- Modify: `packages/shared/src/product.ts`（`CreateProductInput`/`UpdateProductInput`/`ProductSchema` 增加 `material`、`categoryName`；`images` 已有）
- Test: `packages/shared/src/catalog-presets.test.ts`（新文件）
- Test: `packages/shared/src/product.test.ts`（Create/Update 能带新字段）

**Interfaces:**

```ts
export const PRESET_COLORS = ["黑", "白", "灰", "红", "蓝", "绿", "黄", "粉", "卡其"] as const;
export const SYSTEM_COLORS = ["花色"] as const; // 印花/多色。手动未选色才用「默认」，识图禁止用默认顶替
export const PRESET_SIZES = ["S", "M", "L", "XL", "XXL", "均码"] as const;
export const PRESET_MATERIALS = [
  "默认",
  "纯棉",
  "雪纺" /* 其余保持 CreateProductScreen 现有顺序，默认插在最前 */,
] as const;
export const PRESET_CATEGORIES = [/* 从 CreateProductScreen 原样搬迁 */] as const;

export type GarmentVisionRaw = { name: string; category: string; color: string };
export type GarmentVisionMapped = {
  name: string; // 5–60
  category: string; // 芯片或短自定义
  color: string; // 预设 | 花色 | 自定义短词（不对不上时禁止填「默认」）
  colorIsPreset: boolean;
  categoryIsPreset: boolean;
};

export function mapGarmentVision(raw: GarmentVisionRaw): GarmentVisionMapped;
export function normalizeProductTitle(
  name: string,
  fallbackColor: string,
  fallbackCategory: string,
): string;
export function matchPresetCategory(raw: string): string | null; // 同义词命中则返回预设，否则 null
export function matchPresetColor(raw: string): { value: string; isPreset: boolean };
// 命中 9 色或花色 → isPreset true（花色视为系统芯片）；否则 value=短自定义 isPreset false
```

标题规则：trim；去掉非法空白；长度 <5 则 `fallbackColor`（若为默认则省略）+ `fallbackCategory`，仍 <5 则后面补「女装」之类到 5 字（测试锁死规则）；>60 截断。

- [ ] **Step 1:** 把 `CreateProductScreen.tsx` 里四组 PRESET 数组原样搬到 `catalog-presets.ts`，材质数组**最前插入「默认」**，不要丢现有自定义入口（自定义仍在 UI，不进常量）。

- [ ] **Step 2:** 实现 `matchPresetColor`：黑/白/灰/红/蓝/绿/黄/粉/卡其的常见说法（黑色、红色、藏青→蓝、米白→白、卡其/khaki→卡其）；印花/碎花/撞色/多色→花色；**其余截成 ≤6 字自定义，禁止返回「默认」。** 空 raw → `{ value: "未识别色", isPreset: false }`。

- [ ] **Step 3:** 实现 `matchPresetCategory`：至少覆盖 裙子→连衣裙、T 恤/tee/短袖T→T恤、衬衣→衬衫、卫衣衫→卫衣、牛子裤→牛仔裤。未命中返回 null（调用方改用自定义短词）。

- [ ] **Step 4:** 单测：颜色同义词、品类同义词、短标题补齐、超长截断、`酒红` 保持自定义且不是「默认」、空 raw →「未识别色」。

- [ ] **Step 5:** `CreateProductInput` 增加可选 `material`、`categoryName`（string max 40）。`UpdateProductInput` 同样，并补上已有缺口 **`images`**（`z.array(z.string().max(512)).max(9).optional()`）。

- [ ] **Step 6:** 运行  
      `pnpm --filter @cloth-scan/shared test`  
      Expected: PASS

---

## Task 2: Prisma 落材质/品类名；建档写入 images[]

**Files:**

- Modify: `apps/server/prisma/schema.prisma`（Product 增加 `material String?`、`categoryName String?`）
- Create: 新 migration 目录（`prisma migrate dev` 生成，不要手改旧 migration）
- Modify: `apps/server/src/products/products.service.ts`（create/update 写入新字段；`coverImage = images[0] ?? input.coverImage ?? null`）
- Test: `apps/server` 现有 products 测试（若有 create 用例则补 images/material）

**实现要点：**

- `createProduct`：`images: input.images ?? []`；若 `images.length > 0`，`coverImage = images[0]`，否则用 `input.coverImage`。
- `updateProduct`：若传入 `images`，同步 `coverImage = images[0] ?? null`。
- `seedDemo` 不改行为（无图仍可）。
- 手机强制 3 图，**服务端不强制 3 图**（避免演示数据/旧客户端失败）。

- [ ] **Step 1:** 改 schema，在 `apps/server` 跑  
      `pnpm --filter @cloth-scan/server prisma:migrate`  
      （按该包 `package.json` 脚本名；PowerShell 单条命令）。Expected: 新 migration 出现且 Client 生成成功。

- [ ] **Step 2:** 改 `createProduct`/`updateProduct` 写入 `material`、`categoryName`、`images`。

- [ ] **Step 3:**  
      `pnpm --filter @cloth-scan/server typecheck` ; `pnpm --filter @cloth-scan/server test`  
      Expected: PASS

---

## Task 3: 识图 API（店主、可选密钥）

**Files:**

- Modify: `apps/server/src/config/env.ts`（`DASHSCOPE_API_KEY` **optional**；可选 `GARMENT_VISION_MODEL`。不要变成启动必填）
- Modify: `apps/server/.env.example`（注释密钥行）
- Create: `packages/shared/src/garment-vision.ts`（请求/响应 Zod：`RecognizeGarmentInput` / `RecognizeGarmentResult`；错误码枚举 `vision_unavailable` | `quota` | `invalid_key` | `retry_exhausted` | `unsafe`）
- Create: `apps/server/src/products/garment-vision.service.ts`（路径校验、重试、错误分类、调用百炼）
- Modify: `apps/server/src/products/products.module.ts`（注册 provider）
- Modify: `apps/server/src/products/products.controller.ts`（新 POST，须写在 `:id` 路由之前）
- Test: `apps/server/src/products/garment-vision.service.spec.ts`（映射、路径、重试、fatal vs retryable；HTTP 一律 mock）

**API:**

`POST /api/v1/products/recognize-garment`  
`@Roles("owner")`  
Body: `{ imagePath: string }`  
`imagePath` 必须是本店上传返回的相对路径（与 `coverImage` 同形，如 `/uploads/xxx.jpg` 或服务端存的 filename）。**拒绝** `..`、绝对盘符、http(s) URL。

服务：在 `UPLOADS_DIR` 读文件 → JPEG/PNG base64 → **阿里云百炼 OpenAI 兼容接口**（实现前打开 https://help.aliyun.com/zh/model-studio/vision 抄当前视觉 model id，推荐 `qwen3-vl-plus` 若仍在架；不要发明名字）。

```
baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1   // 以文档为准
apiKey: process.env.DASHSCOPE_API_KEY
model: 文档上的当前 VL 型号
```

图片用 `data:image/jpeg;base64,...`（现网是 HTTP IP，**禁止**把 `/uploads` 公网 URL 丢给云端）。

提示词要求只输出 JSON：`{"name":"...","category":"...","color":"..."}`，并在 prompt 里贴上芯片列表。然后 `mapGarmentVision`。

**错误分类（单测锁死）：**

| 情况                                         | 行为                                                                                            | HTTP / code                                                   |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 未配密钥、401、invalid_api_key               | **不重试**                                                                                      | 503 `invalid_key`「识图暂未开通（密钥无效），请改用手动入库」 |
| 402、insufficient_quota、Arrearage、余额不足 | **不重试**                                                                                      | 503 `quota`「识图额度不足，请改用手动入库」                   |
| 内容安全拒绝                                 | **不重试**                                                                                      | 400 `unsafe`「这张图无法识别，请重拍或改用手动」              |
| 超时、网络、429、5xx                         | **重试最多 3 次**（0.8s、2s）仍失败 → 503 `retry_exhausted`「识别超时，请点重试或改用手动入库」 |

单次上游超时 12s abort；三次都算满则整次接口可到约 40s，App 遮罩一直转并更新「正在重试（n/3）」。服务端也可只做 1 次调用、由 App 重试——**推荐服务端重试网络类、App 再提供手动「重试」按钮**（按钮再打一次完整接口）。不要把 500 堆栈给 App。

响应成功：

```ts
{
  name: string;
  category: string;
  color: string;
  colorIsPreset: boolean;
  categoryIsPreset: boolean;
  source: "vision";
}
```

- [ ] **Step 1:** 路径白名单单测：`../etc/passwd`、`http://evil` 必须拒；合法 `/uploads/uuid.jpg` 才拼到 UPLOADS_DIR。

- [ ] **Step 2:** mock fetch：`{"name":"红色连衣裙","category":"裙子","color":"大红"}` → 品类连衣裙、颜色红。再测 `color:"酒红"` → 自定义酒红，**不是默认**。

- [ ] **Step 3:** mock 401 → 不重试；mock 两次 503 后 200 → 成功；mock 三次超时 → `retry_exhausted`。无 KEY → `invalid_key`。

- [ ] **Step 4:**  
      `pnpm --filter @cloth-scan/server typecheck` ; `pnpm --filter @cloth-scan/server test`  
      Expected: PASS

---

## Task 4: 建档 UI（核心）

**Files:**

- Modify: `apps/mobile/src/screens/CreateProductScreen.tsx`（重写布局与状态机，Preset 改为从 `@cloth-scan/shared` 导入）
- Modify: `apps/mobile/src/api.ts`（`recognizeGarment(imagePath: string)`）
- 可用新小组件文件（可选，避免单文件过大）：
  - `apps/mobile/src/screens/create-product/PhotoSlots.tsx`
  - `apps/mobile/src/screens/create-product/VisionReviewModal.tsx`
- 样式：优先复用 `apps/mobile/src/theme/tokens.ts` 的 `colors`/`font`（字号 ≥16、主色 `#2563eb`、大按钮）

**状态机：**

```
mode: "entry" | "manual" | "review"
// entry：第一屏（三图 + 非 AI + 双按钮）
// review：核对 Modal 打开（仍停在 entry 数据上）
// manual：完整页（含 AI 字段）+ 确认建档
```

- 初始：`material = "默认"`，`sizes = ["均码"]`，`colors = []`（手动保存时若 colors 空则当 `["默认"]`）。
- `photos: { front: string | null; back: string | null; detail: string | null }`，上传仍走现有 `uploadImage`。
- AI 入库：三图未满 → Alert「请拍满正面、反面、细节」；满了 → 调 `recognizeGarment(photos.front)`。
  - 请求中遮罩文案：「正在识别正面图…」；若服务端较慢可保持转圈（服务端已重试）。
  - 成功打开核对 Modal；自定义颜色/品类以**已选中芯片**出现，可改。
  - `invalid_key` / `quota` / `unsafe`：立刻红字对应文案 +「改用手动入库」，**不要自动再打三次**。
  - `retry_exhausted` 或网络失败：红字「识别超时」+ **重试** + 改用手动。点重试再调一次接口。
- Modal 内可改 name/category/color，确认后 `mode = "manual"` 并写入这三项。
- 完整页保存：`CreateProductInput`  
  `name` 用 `normalizeProductTitle`  
  `images: [front, back, detail]`（若用户多拍，本期只收这三格）  
  `coverImage: front`  
  `material`、`categoryName: category`  
  `skus: expandSkuMatrix({ colors: colors.length ? colors : ["默认"], sizes: sizes.length ? sizes : ["均码"], ... })`
- 禁止 `effName = "未命名商品"`。名称空且材质/品类也拼不出 5 字 → 红字拦住。
- 加载遮罩：`Modal` + `ActivityIndicator` +「正在识别正面图…」，`pointerEvents` 挡住误触。
- 底栏：entry 两个等宽大按钮；manual 左 30% 次按钮「AI 入库」/「重新识别」，右 70% 主按钮「确认建档」。主按钮在售价为空或图不满时 disable。

**同名：** 不拦截（微信也不要求标题唯一）。可选：不在本期做查重弹窗。

- [ ] **Step 1:** 抽出 `PhotoSlots`：三格标签「正面」「反面」「细节」，空态「拍照 / 相册」，有图可点更换。

- [ ] **Step 2:** 接 `recognizeGarment`；前端超时 ≥ 45s（覆盖服务端 3 次重试）；按错误码分支文案与重试按钮。

- [ ] **Step 3:** `VisionReviewModal`：名称输入 + 品类芯片 + 颜色芯片 + 取消/确认。

- [ ] **Step 4:** 接上提交 payload（3 图 + material + categoryName）。删掉「详细设置」折叠和「未命名商品」。

- [ ] **Step 5:**  
      `pnpm --filter @cloth-scan/mobile typecheck`  
      Expected: PASS

---

## Task 5: 编辑页能补三张图（避免建完无法改）

**Files:**

- Modify: `apps/mobile/src/screens/EditProductScreen.tsx`（三格图可换；名称必填 5～60；展示材质/品类，可改）
- Modify: `apps/server/src/products/products.service.ts`（已在 Task 2 支持 `images`/`material`/`categoryName`）

不在编辑页做 AI（本期只建档）。编辑页三格按 `images[0..2]` 对应正面/反面/细节，缺的显示空槽可补。

- [ ] **Step 1:** 编辑保存走 `updateProduct({ name, images, material, categoryName, skus })`。

- [ ] **Step 2:**  
      `pnpm --filter @cloth-scan/mobile typecheck` ; `pnpm --filter @cloth-scan/server typecheck`  
      Expected: PASS

---

## Task 6: 自检与回归

- [ ] `pnpm --filter @cloth-scan/shared test`
- [ ] `pnpm --filter @cloth-scan/server typecheck` ; `pnpm --filter @cloth-scan/server test`
- [ ] `pnpm --filter @cloth-scan/mobile typecheck`
- [ ] 手工：无 KEY 时点 AI 入库看到「识图暂未开通（密钥无效）」，手动入库仍能 3 图+均码+默认材质+售价建档
- [ ] 手工（有 KEY）：拍正面识别后核对页能改颜色；对不上的色以自定义芯片出现而不是「默认」；确认后完整页再改售价，保存成功，封面是正面图
- [ ] 收银扫码、打印吊牌、离线购物车不回归

**不要**改 `docs/design/微信直播带货接入方案.md`（店主要求方案先讨论再改文档；本文件即执行计划）。

---

## 环境

本地 `apps/server/.env` 增加可选：

```
# 阿里云百炼。不配则 AI 入库提示改手动
DASHSCOPE_API_KEY=
# 可选，实现时按百炼视觉文档填写当前 model id
# GARMENT_VISION_MODEL=qwen3-vl-plus
```

生产同样可选。密钥只放服务端。

---

## 工作量

约 2～3 人日。顺序不可跳：Task 1 → 2 → 3 → 4 → 5 → 6。
