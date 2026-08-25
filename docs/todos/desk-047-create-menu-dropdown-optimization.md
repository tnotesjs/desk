# 优化「⋯」下拉菜单：去 icon、去详情、缩小字号

## 目标

第二列顶部「⋯」菜单优化：

1. 移除菜单项图标。
2. 移除菜单项内联的说明小字与悬停 tooltip（语义简单，无需说明）。
3. 菜单项字号缩小到 `10px`。

## 实现

- `src/renderer/src/components/NavigatorSidebar.vue`
  - `create-menu` 菜单项去掉 `<svg>` 图标与 `<span><strong>…</strong><small>…</small></span>`，改为纯文本 `<button>`。
  - `.create-menu button` 设 `font-size: 10px`。
  - 清理 `.create-menu svg / span / strong / small` 相关死 CSS。
  - 把 `.header-actions.open :deep(.ui-tooltip-popover)` 缩窄为 `.header-actions.open > .ui-tooltip-host :deep(.ui-tooltip-popover)`，避免打开菜单时把所有 tooltip（含菜单项自身详情）都隐藏。

说明：实现过程中曾尝试用 `UiTooltip placement="right"` 展示详情，后按反馈去掉；已回退 `UiTooltip` 到仅 `top / bottom`。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 菜单项无图标、无说明，纯文字小字号；菜单打开时只隐藏触发器（⋯ / +）自身的提示。
- 需运行态确认：下拉菜单为纯文字、字号合适。
