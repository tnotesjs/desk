# 知识库列表项简化：仅图标 + 标题，行高对齐目录项

## 目标

左侧知识库列表项只显示「图标 + 标题」；标题为去掉 `TNotes.` 前缀的部分（如 `TNotes.javascript` → `javascript`）；行高与目录项（`.toc-row`）一致。

## 实现

- `src/renderer/src/components/KnowledgeSidebar.vue`
  - 项模板去掉副标题 `<small>{{ item.name }}</small>` 与右侧计数/落后徽标（`.knowledge-state` 区块）。
  - 标题用 `item.displayName`（主进程 `handle.name.replace(/^TNotes\./, '')` 已去掉前缀）。
  - `.knowledge-item` 行高对齐 `.toc-row`：`min-height: 28px; padding: 2px 5px`。
  - 图标缩小为 `20x20`；标题字号 `11px`，单行省略。
  - 清理 `.knowledge-copy small`、`.knowledge-badge`、`.knowledge-state` 等相关死 CSS。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 知识库个数 / 变更数不再在列表展示；如需保留，可后续用其它方式呈现。
- 右键菜单仍可用（`showContextMenu` 保留）。
