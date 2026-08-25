# 目录行新增批量折叠/展开图标

## 目标

在「目录」行右侧、统计数字（如 319）左侧加一个图标按钮，点击后对目录树做批量折叠/展开。图标参考 core 资源目录 `vitepress/assets/icons/icon__fold.svg`（三条横线 + 左侧折叠三角的 “fold all” 图标）。

## 实现

- `src/renderer/src/components/NavigatorSidebar.vue`
  - 把「目录」标题从单个 `<button>` 改为 `<div class="section-heading toc-heading">`，内部包含：
    - `.section-toggle` 按钮（箭头 + 「目录」文字，`flex: 1`，点击折叠/展开整个目录区）。
    - `.toc-batch-toggle` 按钮（复刻 core 的 `icon__fold.svg`，改为内联 SVG 且 `fill="currentColor"`，颜色由 `var(--muted)` / hover `var(--text)` 控制，天然适配亮/暗主题）。
    - 计数 `em`。
    - 批量按钮用 `<UiTooltip label="折叠/展开全部">` 包裹，提供与 Git 操作按钮一致的悬停提示（替代原生 `title`）。
  - 新增 `tocListRef` 模板引用指向 `TocNodeList`，`toggleTocBatch()` 调用其暴露的 `toggleAllCollapsed()`。
- `src/renderer/src/components/TocNodeList.vue`
  - 新增 `collectBranchIds(nodes)` 收集所有「有子节点」的 id。
  - 新增 `toggleAllCollapsed()`：若当前所有分支均已折叠则展开全部，否则折叠全部。
  - `defineExpose({ toggleAllCollapsed })` 暴露给父级调用。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、86 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check .`：通过。

## 备注

- 图标颜色、按钮 hover 与折叠/展开行为属于运行态表现，需在界面人工确认：目录行计数左侧的 fold 图标在亮/暗主题下都清晰可点；点击可整棵目录树折叠/展开，再次点击反向。
- 之所以不把折叠集合 `provide` 到导航头，是为了避免 `TocNodeList` 的聚焦自动展开逻辑（基于 `inheritedCollapsed` 判断）被跳过；改为通过 `defineExpose` 暴露方法，保持原行为不变。
