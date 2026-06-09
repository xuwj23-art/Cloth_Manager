// Metro 配置（pnpm monorepo 支持）：让 Metro 能解析根目录的 workspace 包与依赖。
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 监听整个 workspace，以便 @cloth-scan/shared 改动能热更新
config.watchFolders = [workspaceRoot];

// 同时从本包与根目录解析 node_modules（pnpm 结构）
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
// 使用扁平化(hoisted)的 node_modules 时，保留向上查找以便解析根目录依赖
config.resolver.disableHierarchicalLookup = false;

module.exports = config;
