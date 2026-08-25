# 目录分组去掉双击重命名，点击只切换折叠

## 目标

目录树中的分组不再支持双击弹「重命名分组」；点击分组就是切换展开 / 折叠。重命名仍可通过分组行的 `⋮` 菜单中的「重命名」主动触发。

## 实现

- `src/renderer/src/components/TocNodeList.vue`
  - 移除分组行 `node-label.group` 按钮上的 `@dblclick.stop="emit('requestRename', node)"`。
- `src/renderer/src/components/TocNodeList.test.ts`
  - 新增测试：双击分组不会 `requestRename`。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 笔记行的双击行为（`selectPermanent`，常驻打开）保持不变；笔记/分组的重命名均可从 `⋮` 菜单触发。
- 双击分组现在等效于快速触发两次单击（折叠→展开，净效果不变），不会弹出重命名。
