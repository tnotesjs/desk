# desk-067：独立 HTML break 渲染为空行

## 对应需求

- `todos/2026.08.29/0014`

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/editor/markdown/rawBlockProjection.ts`
  - 投影类型增加 `raw-break`；`STANDALONE_BREAK` 只匹配独占一行的 `<br>` 变体。
  - `renderDeskRawBlockElement` 为其创建无文本、无标签的空节点，同时保留 base64 `data-source`。
- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - `.desk-raw-block--empty-line` 仅提供一行高度，移除卡片边框、背景、padding 和源码提示。
- `rawBlockProjection.test.ts` / `e2e-block-interactions.mjs`
  - 覆盖投影分类、DOM 空内容、无 label、source reconciliation 与真实 Electron 渲染。

## 边界

- 只处理 standalone HTML break；Markdown 表格单元格、段内 HTML 中的 `<br>` 保持原解析路径。
- 磁盘 canonical 未改变，保存仍恢复用户原始 `<br />` 写法。
- 删除交互的后续修复见 `desk-070`：连续多个空行现在可逐条选中、删除并保存。
