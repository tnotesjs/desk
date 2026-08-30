# desk-070：连续空行可逐条删除

## 对应需求

- `todos/2026.08.29/0017`
- `desk-067` 的运行态补充修复。

## 状态

- 已完成（2026-08-29）

## 根因

- `raw-break` 虽然已经渲染为空行，但仍被 `immutableRawBlockPlugin` 纳入不可删除签名，因此 ProseMirror 删除事务会被静默拒绝。
- 空节点没有文本内容，不能只依赖普通文本删除命令；整块 NodeSelection 需要明确接管删除键。

## 模块与改动

- `src/renderer/src/editor/markdown/rawBlockProjection.ts`
  - `rawBlockSignatures` 排除 `raw-break`，允许用户删除该视觉空行；其它不透明 raw card 继续保持不可变保护。
- `src/renderer/src/markdown/rawBlockInteractions.ts`
  - 新增选中态空行删除：`Delete` / `Backspace` 仅移除当前 `raw-break`，并把文本光标落到相邻可编辑位置。
  - 块前/块后的 boundary 删除继续复用原有原子块事务。
- `rawBlockInteractions.test.ts`
  - 用 `<br>`、`<br/>`、`<br />` 三种连续写法验证选中第二条后只保留第一和第三条。
- `rawBlockProjection.test.ts`、`MilkdownMarkdownEditor.test.ts`
  - 覆盖删除事务、source reconciliation、组件 `change` 事件中的两个剩余 `<br />`。
- `scripts/e2e-empty-break-deletion.mjs`
  - 使用隔离知识库和关闭自动保存的独立 profile，真实点击三条中的中间空行、按 `Delete`、保存并读取磁盘文件。
  - 截图保存在 `scripts/shots/empty-break-deletion/`。

## 验证结果

- 初始 DOM：3 个独立、无文字的 `raw-break`。
- 删除后 DOM：2 个；`before` / `after` 相邻正文不变。
- 保存后 README：精确包含 2 个 `<br />`。
- 原有 `e2e-block-interactions.mjs` 全部场景继续通过。
- 空行的后续去块化视觉修复见 `desk-071`：范围选择不再显示全宽横条，单独选择仅显示行首光标。
