# desk-069：暗色编辑光标可见性

## 对应需求

- `todos/2026.08.29/0016`

## 状态

- 已完成；2026-08-30 按 desk-076 纠正实现说明

## 模块与改动

- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - `--prosemirror-virtual-cursor-color` 在编辑器主题根和 ProseMirror 节点上同步设置，覆盖虚拟光标插件默认暗色。
  - Crepe 启用虚拟光标时，`.ProseMirror` 的浏览器原生 caret 必须保持透明；可见的普通文本光标由 `.prosemirror-virtual-cursor` 使用 `--accent-strong` 绘制。
  - 只有未启用虚拟光标且没有 `ProseMirror-hideselection` 时，浏览器原生 caret 才使用 `--accent-strong`。原始块 selection/boundary cursor 继续使用同一 accent token。
- `scripts/e2e-block-interactions.mjs`
  - 暗色主题聚焦真实段落，分别断言根节点原生 caret 透明，以及可见虚拟光标的 2px 左边框为 accent；保留运行态截图。

## 验证

- Electron 计算样式：根 `.ProseMirror` 原生 caret 为透明；虚拟光标边框为 `rgb(141, 177, 255)` / `#8db1ff`，与编辑器背景不同。
- 截图：`scripts/shots/block-interactions/12-dark-caret.png`，虚拟光标在深色背景上直接可见。
- 原说明把“可见光标”错误归因给根节点原生 caret，这会覆盖 Crepe 的去重保护并导致双光标；根因与回归见 `desk-076-native-caret-conflict.md`。
