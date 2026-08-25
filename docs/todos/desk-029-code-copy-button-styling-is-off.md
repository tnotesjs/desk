# 代码块复制按钮样式与官方默认不一致

## 现象

Milkdown / Crepe 可视化编辑器中，代码块的「Copy」复制按钮显示为蓝色胶囊，与官方默认的灰色带图标 + 「Copy」文字的观感不一致。

## 根因

Crepe 代码块工具按钮在 `@milkdown/crepe/theme/common/code-mirror.css` 中定义为：

```css
.milkdown .milkdown-code-block .tools .tools-button-group button {
  background: var(--crepe-color-secondary);
  color: var(--crepe-color-on-surface-variant);
  ...
}
```

`MilkdownMarkdownEditor.vue` 把 `--crepe-color-secondary` 映射为 `var(--accent)`（蓝色），因此复制按钮背景变成蓝色胶囊，偏离官方默认（灰底 + 图标 + 文字）。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 覆写 `.milkdown-code-block .tools .tools-button-group button`：
  - `background: var(--panel)`；
  - `color: var(--editor-text)`；
  - `border: 1px solid var(--border)`。
- `button:hover`：`background: var(--hover)`、`color: var(--text)`。
- `button svg`：`fill/color: currentColor`，让图标与文字色一致。

## 验证

- 探针确认该按钮为 `text="Copy"` 的 `.tools-button-group button`。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、80 项全部通过。

## 备注

- happy-dom 下 `getComputedStyle` 返回空，运行态 UI 复验仍需人工确认。
