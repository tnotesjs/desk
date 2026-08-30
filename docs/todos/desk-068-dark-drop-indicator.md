# desk-068：暗色拖拽落点提示

## 对应需求

- `todos/2026.08.29/0015`

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - 覆盖 Crepe `.crepe-drop-cursor`：背景使用 `--accent-strong`，透明度固定为 1，并增加同色轻量外描边。
- `scripts/e2e-block-interactions.mjs`
  - 先建立真实 NodeSelection，再向不同段落派发 Milkdown 使用的 dragover 链路，捕获实际可见的 drop indicator。
  - 断言暗色背景色为 `rgb(141, 177, 255)`、opacity 为 `1`、线高至少 2px。

## 验证

- Electron 运行态通过：`dark drag indicator uses an opaque high-contrast accent line`。
- 截图：`scripts/shots/block-interactions/13-dark-drop-cursor.png`；亮蓝落点线在深色编辑器中清晰可见。
