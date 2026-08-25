# 代码块语言选择、复制按钮、外边框的显示时机调整

## 需求

1. 语言选择按钮【常驻显示】。
2. 复制按钮【hover 显示】。
3. 外边框【hover 显示】。

## 现状（Crepe 官方 `code-mirror.css`）

- `.tools .language-button`：默认 `opacity: 0`，`.milkdown-code-block:hover .language-button { opacity: 1 }` — 目前 hover 才显示。
- `.tools .tools-button-group button`：默认 `opacity: 0`，`:hover` 显示 — 符合需求的第 2 点。
- `.milkdown-code-block`：官方无常驻边框，仅 `.selected` 有 outline；Desk 上一轮为其添加了常驻 `border`。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- `.milkdown-code-block`：`border: 1px solid transparent` + `transition: border-color`，hover 时 `border-color: var(--border)`（外边框 hover 显示，默认无边框避免布局跳动）。
- `.tools .language-button`：`opacity: 1`（语言选择常驻显示）。
- `.tools .tools-button-group button`：保持官方 hover 显示策略，未改动（复制按钮 hover 显示）。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、80 项全部通过。

## 备注

- 运行态需人工确认：语言按钮常驻、复制按钮 hover 才出现、代码块外边框 hover 才显示。
