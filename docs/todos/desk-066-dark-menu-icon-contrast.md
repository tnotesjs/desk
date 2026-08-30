# desk-066：暗色菜单图标对比度

## 对应需求

- `todos/2026.08.29/0013`

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - 工具栏、块手柄和 Crepe 菜单 SVG 显式继承 `--editor-text`。
  - hover/active 图标切换到 `--accent-strong`。
  - `.desk-tnotes-icon` 强制 `fill: none`、`stroke: currentColor`，保持线性图标一致。
- `src/renderer/src/markdown/BlockActionMenu.vue`
  - 动作 SVG 使用 `currentColor` 和主题 `--text`，避免路径内置颜色在暗色面板失去对比度。
- `src/renderer/src/markdown/slashMenu.ts`
  - TNotes 图标继续由统一的 24×24 线性 SVG 工厂生成，不引入 emoji/位图。

## 验证

- Electron 暗色运行态读取计算样式：块菜单背景 `rgb(25, 30, 37)`，图标前景 `rgb(229, 233, 239)`。
- 斜杠菜单全部可见 SVG 的 color/fill/stroke 均与面板背景区分。
- 截图：`scripts/shots/block-interactions/10-dark-action-menu.png`、`11-dark-slash-menu.png`。
