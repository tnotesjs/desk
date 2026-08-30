# desk-075：连续空行范围选中反馈

## 对应需求

- `todos/2026.08.29/0021`
- `desk-071` 的交互修正：继续禁止全宽横条，但恢复必要的范围选中反馈。

## 状态

- 处理中（2026-08-30）

## 设计约束

- standalone `<br />` 仍是无文字的 `raw-break` 原子节点，源码和行高保持不变。
- 范围选择中的每个空行只在行首绘制短占位，不使用 raw block 的整行边框、背景或阴影。
- 单行 NodeSelection、before/after boundary 与多行范围选择分别由各自状态负责，视觉不能重叠。

## 计划改动

- `rawBlockInteractions.ts`：范围选择重新为 `raw-break` 添加 `desk-raw-block--range-selected` 节点装饰。
- `MilkdownMarkdownEditor.vue`：为空行范围选中类增加行首短占位伪元素，同时保留空行表面透明。
- `rawBlockInteractions.test.ts`：验证一次范围选择可同时标记三个连续空行。
- `e2e-empty-break-deletion.mjs`：真实鼠标拖选并断言三个短占位的尺寸、颜色和截图。
