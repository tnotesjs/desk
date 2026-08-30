# desk-056：Markdown 行内空格触发规则

## 对应需求

- `todos/2026.08.29/0003`（迁移自 `2026.08.28/0007`）

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/markdownInputRules.ts`
  - 在 EditorState 创建前通过 `inputRulesCtx` 移除 Milkdown 默认的斜体、粗体、删除线、行内代码和 Crepe 行内公式规则。
  - 替换为尾随空格才匹配的规则；触发空格被消费，不写入文档。
  - 支持 `*em*`、`_em_`、`**strong**`、`__strong__`、`~~strike~~`、`` `code` ``、`$math$`。
  - 所有替换规则均设为 `undoable: false`，全局 Backspace 的 `undoInputRule` 保持原样，标题/列表等其它块规则仍可一键撤回。
  - 默认公式 InputRule 未从 Crepe 公共入口导出；按 Milkdown 7.22.1 的稳定 regexp 精确识别，避免引用私有包路径。

## 测试与交互记录

- `markdownInputRules.test.ts` 覆盖“闭合符输入后仍为源码 → 空格转换并消费 → `undoInputRule` 返回 false → 删除直接删内容”，并覆盖全部分隔符、行内公式，以及 Enter 分段但不触发转换。
- happy-dom 的 KaTeX 需在模块导入前声明 standards mode；测试用 `vi.hoisted` 固定 `document.compatMode`。
- Electron E2E 已直接键入并验证：`*abc*` 在闭合后保持字面量，Space 转斜体且不留下空格，Backspace 得到斜体 `ab` 而不恢复星号；`**bold**` + Enter 保持源码；行内代码与公式仅在 Space 后转换。

## 复现与结果

```bash
pnpm exec vitest run src/renderer/src/markdown/markdownInputRules.test.ts
pnpm exec electron-vite build && node scripts/e2e-markdown-input.mjs
```

结果纳入全仓 162/162 单测和 13/13 Electron 交互断言，全部通过。
