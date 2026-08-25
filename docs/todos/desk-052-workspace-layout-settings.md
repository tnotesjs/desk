# 设置面板：工作区列布局（知识库-目录-内容 / 内容-目录-知识库）

## 目标

设置面板支持两种工作区列布局：

1. 知识库 - 目录 - 内容（默认选中）。
2. 内容 - 目录 - 知识库。

用两个骨架图（wireframe）让用户点选。

## 实现

- `src/shared/contracts.ts` / `src/main/settings.ts`
  - `AppSettings` 新增 `workspaceLayout: 'kb-dir-content' | 'content-dir-kb'`，默认 `'kb-dir-content'`。
- `src/renderer/src/components/SettingsPanel.vue`
  - 「常规」分组新增 `.layout-picker`：两个 `.layout-option`，各含内联 SVG 骨架 + 文案，点击设置 `draft.workspaceLayout`；选中态高亮。
- `src/renderer/src/App.vue`
  - `workspaceColumns` 按 `workspaceLayout` 输出两种列模板（反向时 `1fr 6px dir 6px kb`）。
  - 新增 `workspaceAreas`：正向 `"i1 i2 i3 i4 i5"`，反向 `"i5 i4 i3 i2 i1"`。
  - 五个子元素（知识库 / 手柄 / 目录 / 手柄 / 编辑器）分别指定 `grid-area: i1..i5`，配合 `grid-template-areas` 重排。
  - 两个拖拽手柄仍分别 resize 知识库宽度（`i2`）与目录宽度（`i4`），在两种布局下边界位置均正确。
  - 反向布局（content-dir-kb）时，被调整列位于手柄右侧，`onResizeMove` 的 `delta` 取反（乘以 -1），使「向左拖动=增加宽度」符合直觉。
- 测试 mock 的 `AppSettings` 补 `workspaceLayout`。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 切换布局后立即生效，宽度限幅与拖动逻辑在两种布局下均可用。
- 骨架仅示意列顺序；默认布局 1。
