# 代码块失焦后当前行仍高亮

## 现象

光标离开代码块（甚至离开编辑器）后，代码块内上次停留的行仍然保持高亮。

## 根因

CodeMirror 的 `highlightActiveLine` / `highlightActiveLineGutter`（由 `basicSetup` 提供）默认在编辑器失焦后仍保留 activeLine 高亮。`MilkdownMarkdownEditor.vue` 中 `.cm-activeLine` / `.cm-activeLineGutter` 的样式选择器未限定 `.cm-focused`，因此失焦后高亮不消失。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- `.cm-activeLine` / `.cm-activeLineGutter` 选择器增加 `.cm-editor.cm-focused` 限定：
  - `.milkdown-code-block .cm-editor.cm-focused .cm-activeLine`
  - `.milkdown-code-block .cm-editor.cm-focused .cm-activeLineGutter`
- 失焦后 CodeMirror 移除 `cm-focused` 类，高亮背景不再生效，当前行恢复无高亮。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、80 项全部通过。

## 备注

- 运行态需人工确认：光标离开代码块后，当前行高亮消失；再次聚焦代码块时恢复高亮。
