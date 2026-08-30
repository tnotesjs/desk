# desk-060：块级组件前后光标与边界删除

## 对应需求

- `todos/2026.08.29/0007`
- 交互优化1：块前/块后光标及 Delete/Backspace 整块删除。

## 状态

- 已完成（2026-08-29）

## 设计与改动

- 使用原生 NodeSelection 作为稳定的原子选择基础，并在插件状态中附加 `before/after` 边界语义；这样复制、撤销和节点映射仍由 ProseMirror 管理。
- `rawBlockInteractions.ts`：
  - 相邻正文边界使用普通方向键进入块前/块后。
  - 边界之间及正文之间可继续用方向键跨越。
  - 块前 Delete、块后 Backspace 删除完整 node transaction。
  - decoration 绘制零布局高度的可见 caret，同时取消边界状态下的整块高亮。
  - NodeView 顶部/底部各有一条不改变文档尺寸的鼠标命中区。
- `MilkdownMarkdownEditor.vue`：为可见 raw NodeView 安装/清理边界鼠标控件并补齐样式。

## 验证记录

- `rawBlockInteractions.test.ts` 增至 5 项：块前 ArrowDown → before + Delete、块后 ArrowUp → after + Backspace 均删除完整 atom；0005 的 Shift 选择继续通过。
- `scripts/e2e-block-interactions.mjs`：
  - 点击 NodeView 顶部命中区，确认 before caret，Delete 后 atom 消失，Meta+Z 恢复。
  - 点击底部命中区，确认 after caret，Backspace 后 atom 消失，Meta+Z 恢复。
- 已直接查看两张新鲜运行态截图，caret 位于块外边界且未撑高/推移正文：
  - `scripts/shots/block-interactions/06-block-caret-before.png`
  - `scripts/shots/block-interactions/07-block-caret-after.png`

```bash
pnpm exec vitest run src/renderer/src/markdown/rawBlockInteractions.test.ts
pnpm build
node scripts/e2e-block-interactions.mjs
```
