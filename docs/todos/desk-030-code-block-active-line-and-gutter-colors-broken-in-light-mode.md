# 亮色模式下代码块当前行高亮不明显、行号列背景错误

## 现象

亮色主题下，Milkdown / Crepe 可视化编辑器里的代码块：

- 当前行（`cm-activeLine` / `cm-activeLineGutter`）高亮背景太淡，几乎看不出。
- 行号列（`cm-gutters`）背景色与代码正文区不一致（偏深）。

官方默认效果中，行号列与正文同色，当前行为清晰的浅蓝横条。

## 根因

Crepe 代码块的 CodeMirror 样式（`@milkdown/crepe/theme/common/code-mirror.css`）只定义了：

```css
.milkdown .milkdown-code-block .cm-gutters {
  background: var(--crepe-color-surface);
}
```

未对 `.cm-activeLine` / `.cm-activeLineGutter` 提供配色。Desk 将 `--crepe-color-surface` 映射为 `var(--panel)`，在亮色下 `--panel` 与正文实际背景色（`--editor-bg`）不同，导致行号列与正文颜色不一致；当前行高亮则沿用 CodeMirror 基础默认值，过于淡。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

对齐源码编辑器 `MarkdownSourceEditor.vue` 的 CodeMirror 主题做法，新增：

- `.cm-editor`：`background: var(--editor-bg)`、`color: var(--editor-text)`。
- `.cm-gutters`：`background: var(--editor-bg)`、`color: var(--muted)`、`border-right: 1px solid var(--border)`。
- `.cm-activeLine` / `.cm-activeLineGutter`：
  `background: color-mix(in srgb, var(--hover) 62%, transparent)`。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、80 项全部通过。

## 备注

- happy-dom 下无法读取 CodeMirror 计算后的颜色，亮色模式下的行号列与当前行高亮效果需运行态人工确认。
