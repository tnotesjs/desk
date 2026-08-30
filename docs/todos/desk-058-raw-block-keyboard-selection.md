# desk-058：块级原子组件的键盘选中态

## 对应需求

- `todos/2026.08.29/0005`
- BUG2：从相邻文本使用 Shift + 方向键无法整块选中组件。

## 状态

- 已完成（2026-08-29）

## 根因

`deskRawBlock` 虽然是 atom 且 NodeView 实现了 `selectNode`，schema 却声明了 `selectable: false`。这使 ProseMirror 无法创建 NodeSelection，也让 Milkdown 块拖拽依赖的选择语义失效。

## 模块与改动

- `rawBlockProjection.ts`：将可见 raw atom 改为可选择节点。
- `rawBlockInteractions.ts`：
  - 光标在顶层文本块末尾时，Shift + ↓ 选择紧邻的下方 raw atom。
  - 光标在顶层文本块开头时，Shift + ↑ 选择紧邻的上方 raw atom。
  - 不介入列表/表格嵌套文本，也不劫持 raw block 内部 CodeMirror。
  - 文本范围跨越 raw atom 时增加节点 decoration，提供明确的整块反馈。
- `MilkdownMarkdownEditor.vue`：注册 selection 插件。

## 验证记录

- `rawBlockInteractions.test.ts`：正向/反向相邻选择与非边界不劫持共 3 项通过。
- `rawBlockProjection.test.ts` 全部通过，投影与源码保真未回归。
- `scripts/e2e-block-interactions.mjs` 在隔离 Electron 知识库中验证：
  - 上一段末尾 Shift + ↓ 后 raw node 获得 `ProseMirror-selectednode`。
  - 下一段开头 Shift + ↑ 得到同一原生 NodeSelection。
  - 鼠标点击 atom 也得到相同选择语义。
- 截图：`scripts/shots/block-interactions/04-block-selected-down.png`。

```bash
pnpm exec vitest run src/renderer/src/markdown/rawBlockInteractions.test.ts src/renderer/src/editor/markdown/rawBlockProjection.test.ts
pnpm build
node scripts/e2e-block-interactions.mjs
```
