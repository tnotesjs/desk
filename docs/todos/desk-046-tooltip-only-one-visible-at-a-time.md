# 修复：同一时刻出现两个按钮提示

## 现象

第二列顶部「⋯」「+」两个按钮同时显示各自的 tooltip（“更多笔记操作”“添加笔记”）。

## 根因

`UiTooltip.vue` 用 `.ui-tooltip-host:hover` 与 `.ui-tooltip-host:focus-within` 触发提示。鼠标点击「⋯」后按钮仍持有焦点，`:focus-within` 使其提示常驻；鼠标再悬停「+」时又触发「+」的提示，于是同屏出现两处。

## 修复

- `src/renderer/src/components/UiTooltip.vue`：把 `:focus-within` 改为 `:has(:focus-visible)`，即只在 hover 或**键盘**焦点时显示。
  - 鼠标点击获得的焦点不属于 `:focus-visible`，因此点击后又悬停其它按钮不会再残留旧提示。
  - 键盘 Tab 聚焦按钮仍能看到提示（`Chromium / Electron` 支持 `:has()`）。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 极端情况：键盘聚焦 A + 鼠标悬停 B 时仍可能出现两处提示；属较少见交互，如后续需要，可再加“聚焦时抑制 hover 提示”的逻辑。
