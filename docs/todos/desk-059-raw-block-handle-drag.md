# desk-059：块级组件侧边手柄拖拽排序

## 对应需求

- `todos/2026.08.29/0006`
- BUG3：六点手柄出现但无法拖动 raw block。

## 状态

- 已完成（2026-08-29）

## 根因与改动

- Milkdown 的 BlockProvider 在手柄 `mousedown` 时只会为 `NodeSelection.isSelectable(node)` 为真的节点创建拖动 slice。
- Desk 在 desk-034 中将全部 `deskRawBlock` 设为 `selectable: false`，因此 raw block 手柄可以显示，但拖动开始时没有选择、slice 和 `view.dragging`。
- `rawBlockProjection.ts` 现已恢复 atom 的原生可选择语义；0005 的键盘选择与本项的拖动共享同一个正确前提。
- `EditorGroup.vue` 已由 desk-025 通过专用 MIME 区分标签拖拽，本项无需再修改外层分屏逻辑。

## 验证记录

- `scripts/e2e-block-interactions.mjs` 在隔离 Electron 知识库中：
  - 鼠标悬停 raw component，确认可见手柄并以第二个六点 `.operation-item` 为起点。
  - 使用真实 `mouse.down → 16 步移动 → mouse.up` 将组件拖过下一段。
  - 断言 DOM 顺序已改变、ProseMirror `data-dragging="false"`，没有残留拖动状态。
  - 保存后读取临时磁盘 README，组件源码位置跟随 UI 且 exact source 只出现一次。
- 截图：`scripts/shots/block-interactions/05-block-dragged.png`。

```bash
pnpm build
node scripts/e2e-block-interactions.mjs
```
