# desk-055：Markdown 块级快捷输入

## 对应需求

- `todos/2026.08.29/0002`（迁移自 `2026.08.28/0006`）

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/markdownInputRules.ts`
  - `findEnterBlockShortcut` 维护严格、大小写不敏感的整行触发映射。
  - 容器触发仅由 Enter 处理；Mermaid/Mindmap 同时支持 Enter 和 InputRule 空格触发。
  - 只接受根级 paragraph；有前导空格、列表项、额外标题或不完整 `:::` 均不转换。
  - 转换结果直接引用 0001 的同一个 `SlashMenuItem.insert`，避免菜单与快捷输入产生两份 snippet。
  - 图表空格规则插在 Milkdown 通用代码围栏规则之前，避免先变成普通 code block。
  - raw 转换事务携带源码编辑请求；统一走 0001 的“等待 NodeView → 打开编辑源码 → 聚焦”交互。
- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - 注册块级快捷插件，并复用 `openRawSourceEditorAt`。

## 测试与交互记录

- `markdownInputRules.test.ts` 穷举 13 组触发映射及大写输入，并覆盖严格匹配/前缀冲突、`:::code`、图表 Space/Enter 双入口、前导空格和列表保护。
- Electron E2E 已验证 `:::TIP` + Enter 和 ` ```mmd ` + Space；两者均写入 0001 的 canonical source、自动打开源码编辑器并把光标放在源码首位。
- E2E 同时确认 `::: tip` + Enter 保持普通段落，图表简写不会先被 Milkdown 通用 code fence 规则吃掉。

## 复现与结果

```bash
pnpm exec vitest run src/renderer/src/markdown/markdownInputRules.test.ts
pnpm exec electron-vite build && node scripts/e2e-markdown-input.mjs
```

结果纳入全仓 162/162 单测和 13/13 Electron 交互断言，全部通过。
