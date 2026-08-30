# desk-075：连续空行范围选中反馈

## 对应需求

- `todos/2026.08.29/0021`
- `desk-071` 的交互修正：继续禁止全宽横条，但恢复必要的范围选中反馈。

## 状态

- 已完成（2026-08-30）

## 设计约束

- standalone `<br />` 仍是无文字的 `raw-break` 原子节点，源码和行高保持不变。
- 范围选择中的每个空行只在行首绘制短占位，不使用 raw block 的整行边框、背景或阴影。
- 单行 NodeSelection、before/after boundary 与多行范围选择分别由各自状态负责，视觉不能重叠。

## 模块改动

- `src/renderer/src/markdown/rawBlockInteractions.ts`
  - 范围选择重新为 `raw-break` 添加 `desk-raw-block--range-selected` 节点装饰。
  - 增加 raw-break 专用 pointer-range 插件：记录按下锚点，通过 `elementFromPoint` 跟踪拖到的空行，并为首尾之间的所有 raw-break 建立范围。
  - 拖选期间不绘制单行 selection/boundary cursor；`Delete` / `Backspace` 删除整个连续范围，新文档事务或 Selection 清理临时状态。
- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - raw-break 恢复 `user-select: text`，但仍保持空内容、透明表面和标准行高。
  - 空行范围类只用 `::before` 绘制 8px × 1.2em 的行首短占位；只读模式不绘制。
- `src/renderer/src/markdown/rawBlockInteractions.test.ts`
  - 验证非空 TextSelection 同时为 3 个连续 raw-break 添加范围装饰。
- `scripts/e2e-empty-break-deletion.mjs`
  - 用真实鼠标从第 1 条空行拖到第 3 条，断言三个短占位均存在，宽度 7–9px、高度 16–24px，同时没有全宽背景、边框或阴影。

## 验证

- `rawBlockInteractions.test.ts` 9 项通过；与 `MilkdownMarkdownEditor.test.ts` 合跑 21 项通过。
- Electron E2E 全部通过：连续空行渲染、鼠标范围拖选、单光标、只读零光标、删除和保存。
- 目视截图：`scripts/shots/empty-break-deletion/02-three-empty-lines-range-selected.png`，三个短竖条逐行显示，未出现全宽横条。
- 全仓门禁通过：lint、28 个测试文件 / 184 项测试、typecheck、build、Prettier。
