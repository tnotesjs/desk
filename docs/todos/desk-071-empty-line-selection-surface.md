# desk-071：空行选中态去块化

## 对应需求

- `todos/2026.08.29/0018`
- `desk-067`、`desk-070` 的运行态视觉补充。

## 状态

- 已完成（2026-08-29）；范围反馈于 2026-08-30 由 desk-075 精细化

## 原因与设计

- standalone `<br />` 需要在编辑器文档中保留独立节点，否则连续空行会坍缩，且无法逐条选择、删除和还原原始源码。
- 节点本身没有文字内容；用户看到的整行横条来自通用 raw block 选中装饰，并不是空行里的实际内容。
- 空行继续占用一个标准行高作为真实换行，视觉上取消块卡片表面；单独节点选中只在行首显示窄光标，跨块范围选中不再绘制整行背景。desk-075 后续恢复了必要反馈，但只绘制短行首占位。

## 模块与改动

- `src/renderer/src/markdown/rawBlockInteractions.ts`
  - 本项最初让范围选中装饰跳过 `raw-break`，其它块级组件继续显示块选中态；desk-075 将 raw-break 重新纳入范围语义，并由专用 CSS 收窄为短标记。
- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - 为 `raw-break` 的节点选中、范围选中和边界选中覆盖通用卡片边框、背景与阴影。
  - 单独 NodeSelection 使用行首光标标记，不再绘制全宽横条；最终宽度经 `desk-073` 收窄为 1px。
- `rawBlockInteractions.test.ts`
  - 验证同一文本范围中的普通 raw component 仍有块选中装饰，而 `raw-break` 不再获得该装饰。
- `scripts/e2e-empty-break-deletion.mjs`
  - 运行态断言空行始终透明、无边框/阴影且保留标准行高；单独选中仅出现行首标记。

## 验证结果

- 范围选择同一区域时，普通 raw component 仍显示块选中反馈，`raw-break` 不再获得全宽范围装饰。
- 2026-08-30 最终状态：raw-break 范围选中会得到 8px 短行首占位，但仍无全宽边框、背景或阴影；详见 `desk-075-consecutive-empty-line-range-selection.md`。
- 暗色运行态下三条空行的文本均为空，边框为 `0px`、背景透明、阴影为 `none`，高度均处于一个标准行高范围。
- 单独选择中间空行后只有一个行首标记；`Delete` 后 DOM 与磁盘均从三条精确变为两条。双光标后续修复见 `desk-073`。
- 运行态截图：`scripts/shots/empty-break-deletion/01-three-empty-lines.png`、`02-middle-line-selected.png`、`03-middle-line-deleted.png`。
