# desk-069：暗色编辑光标可见性

## 对应需求

- `todos/2026.08.29/0016`

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - `.ProseMirror` 的 `caret-color` 使用 `--accent-strong`。
  - `--prosemirror-virtual-cursor-color` 在编辑器主题根和 ProseMirror 节点上同步设置，覆盖虚拟光标插件默认暗色。
  - 原始块 boundary cursor 继续使用同一 accent token，普通文本与原子块边界的视觉语言一致。
- `scripts/e2e-block-interactions.mjs`
  - 暗色主题聚焦真实段落，读取 caret 计算色与背景；保留运行态截图。

## 验证

- Electron 计算样式：caret 为 `rgb(141, 177, 255)` / `#8db1ff`，与编辑器背景不同。
- 截图：`scripts/shots/block-interactions/12-dark-caret.png`，光标在深色背景上直接可见。
