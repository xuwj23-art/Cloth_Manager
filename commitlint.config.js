export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // 项目使用中文 commit subject（计划约定 + 历史提交均为中文）。
    // subject-case 对非英文开头（如 "ESLint..."、"新增..."）会误报，
    // 关闭该规则；type/scope/subject-empty 等仍强制 Conventional Commits 结构。
    "subject-case": [0],
  },
};
