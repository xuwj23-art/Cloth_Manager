# 服装进销存 —— 后端生产镜像（pnpm monorepo）
# 构建上下文为仓库根目录：docker build -f apps/server/Dockerfile .
FROM node:20-bookworm-slim

# 把基础镜像(Debian)的 apt 源换成阿里云镜像，国内构建更快更稳；再装 Prisma 需要的 openssl
RUN sed -i 's@//deb.debian.org@//mirrors.aliyun.com@g; s@//security.debian.org@//mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || true; \
    sed -i 's@//deb.debian.org@//mirrors.aliyun.com@g; s@//security.debian.org@//mirrors.aliyun.com@g' /etc/apt/sources.list 2>/dev/null || true; \
    apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 用 corepack 固定 pnpm 版本，与本地/锁文件一致
RUN corepack enable && corepack prepare pnpm@10.34.1 --activate

WORKDIR /app

# 国内服务器走 npm 镜像，安装依赖更快（如需官方源，构建时传 --build-arg NPM_REGISTRY=https://registry.npmjs.org）
ARG NPM_REGISTRY=https://registry.npmmirror.com
RUN pnpm config set registry "$NPM_REGISTRY"

# 先只拷贝清单文件安装依赖：源码改动不再使依赖层缓存失效，
# 2G 内存服务器每次部署可省去 3~8 分钟的全量 pnpm install。
# mobile 的 package.json 也要拷（frozen-lockfile 校验需要全部 workspace 清单）。
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/server/package.json apps/server/
COPY apps/mobile/package.json apps/mobile/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@cloth-scan/server..."

# 拷贝其余源码（node_modules / .git 等由 .dockerignore 排除）
COPY . .

# 构建共享包 -> 生成 Prisma Client -> 编译后端
RUN pnpm --filter "@cloth-scan/shared" build \
  && pnpm --filter "@cloth-scan/server" exec prisma generate \
  && pnpm --filter "@cloth-scan/server" build

WORKDIR /app/apps/server
EXPOSE 3000

# 启动时先执行数据库迁移（幂等），再启动服务
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
