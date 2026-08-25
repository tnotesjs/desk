# 可视化视图：选中文本后的格式工具栏对比度过低

## 现象

可视化视图下选中内容后弹出的格式工具栏（milkdown-toolbar，含 B/I/删除线 等按钮）图标发暗，在暗色主题下几乎看不清。

## 根因

- Crepe 工具栏按钮图标默认使用 `color/fill: var(--crepe-color-outline)`，而 desk 把 `--crepe-color-outline` 映射成 `var(--border)`（暗色下 `#292f39`），叠在工具栏背景 `var(--panel)`（`#191e25`）上，图标近乎不可见。
- desk 未定义 `--crepe-shadow-1` / `--crepe-shadow-2`，工具栏（及 block-edit / image-block 等弹层）因此没有投影，浮层与背景边界不明显。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 在 `.milkdown` 变量块补充 `--crepe-shadow-1` / `--crepe-shadow-2`，使悬浮弹层有投影。
- 覆盖 `.milkdown .milkdown-toolbar`：
  - `background: var(--raised)`、`border: 1px solid var(--border)`、`box-shadow: var(--crepe-shadow-1)`，让工具栏与正文背景区分开。
  - `.toolbar-item svg`：idle `var(--editor-text)`（亮色可读），hover `var(--text)`，active `var(--accent-strong)`。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 属运行态表现，需在界面人工确认：选中文本后工具栏图标清晰可见；亮/暗主题下均正常；hover / active 状态反馈明显。
- 其它 Crepe 弹层（block-edit 菜单、link-tooltip、image-block 菜单）若存在类似低对比，可复用同一思路覆盖；本次仅聚焦用户反馈的格式工具栏。
