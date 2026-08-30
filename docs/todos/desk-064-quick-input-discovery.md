# desk-064：快速输入提示与设置快捷键清单

## 对应需求

- `todos/2026.08.29/0011`

## 状态

- 已完成（2026-08-29）

## 实现

- `TN_NOTES_SLASH_ITEMS` 为每个 TNotes slash 项提供唯一首选 `/快捷词`；搜索别名继续保留在 Crepe 内部 label，但展示层只显示名称与首选快捷词。
- `MARKDOWN_BLOCK_SHORTCUTS`、`MARKDOWN_INLINE_SHORTCUTS` 从输入规则模块导出，设置面板直接复用它们，列出容器/图表的 Enter 或 Space 触发和行内格式闭合后 Space 触发。
- 设置面板的快捷键行允许长别名换行，避免窄窗口中快捷词挤压或溢出。

## 验证

- `slashInsert.test.ts` 校验每个菜单项快捷词唯一、格式合法且写入 searchable label；`SettingsPanel.test.ts` 挂载真实设置面板，逐项检查 slash、块级和行内清单均被渲染。
- `markdownInputRules.test.ts` 覆盖触发规则与共享 insert；`e2e-markdown-input.mjs` 实测 `/mmd`、别名搜索、`:::TIP`、Mermaid 围栏别名以及行内 Space 行为。
