# 代码块语言切换下拉选项透明看不清

## 现象

在 Milkdown / Crepe 可视化编辑器里点开代码块的语言切换下拉，弹出的语言选项列表（Python、C、Java…）文字与背景均为透明 / 几乎不可见。

## 根因

Crepe 代码块的语言下拉由 `codeBlockComponent`（`@milkdown/crepe/theme/common/code-mirror.css`）渲染：

- `.milkdown-code-block .language-picker`
- `.language-picker .list-wrapper`（`background: var(--crepe-color-surface-low)`）
- `.language-list-item`（未显式设置 `color`，依赖继承）
- `.search-box input`（`color: var(--crepe-color-on-surface)`）

`MilkdownMarkdownEditor.vue` 只在 `.milkdown :deep(.milkdown)` 里设置了 `--crepe-color-*` 变量，但**未给 `.milkdown` 根设置 `color`**。正文的 `color` 单独设在 `.ProseMirror` 上，而 `.language-picker` 位于 `.milkdown-code-block` 内、不属于 `.ProseMirror` 后代，因此继承不到正确的前景色，回退为浏览器默认文字色，在暗色半透明背景下显得透明。同时 `.list-wrapper` 背景取 `--crepe-color-surface-low`（Desk 映射为 `--hover` = `rgba(255,255,255,0.045)`），过于淡，进一步降低了可读性。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 给 `.milkdown` 根元素补充 `color: var(--editor-text)`，让所有位于 `.milkdown` 内但不在 `.ProseMirror` 里的元素（含语言下拉）继承正确前景色。
- 为 `.milkdown-code-block` 的语言下拉相关类补充明确样式：
  - `.language-picker` / `.list-wrapper` / `.language-list-item`：`color: var(--editor-text)`；
  - `.list-wrapper`：`background: var(--panel)`（可读底色）；
  - `.language-list-item:hover`：`background: var(--hover)`；
  - `.search-box input`：`color: var(--editor-text)`。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、80 项全部通过。
- 运行态需在 Desk 中打开代码块语言下拉确认：文字与背景应恢复可读。

## 备注

- 列表项颜色在 happy-dom 中无法通过 `getComputedStyle` 验证（返回空字符串），故运行态 UI 复验仍需人工确认。
