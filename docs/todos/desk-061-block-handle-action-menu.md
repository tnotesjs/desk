# desk-061：六点手柄点击菜单与“在下方添加”二级菜单

## 对应需求

- `todos/2026.08.29/0008`
- 交互优化2：六点短按菜单、拖拽并存及“在下方添加”二级菜单。

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `blockActionMenu.ts`
  - 监听六点 grip 的 pointer 序列，以 5px 阈值区分短按与拖动。
  - 不阻止默认事件，原生 Milkdown dragstart/ghost/drop 链路保持不变。
  - 仅对可见 `deskRawBlock` 打开菜单。
- `BlockActionMenu.vue`
  - 实现删除、复制、剪切、全宽显示和“在下方添加”。
  - raw 根级块不支持合法缩进、没有稳定标题锚点，两项显示 disabled 和原因。
  - 支持 Escape、上下方向键、右方向打开子菜单、焦点和鼠标 hover。
- `MilkdownMarkdownEditor.vue`
  - 用 ProseMirror 完整 node transaction 删除；复制/剪切使用 canonical `attrs.source`。
  - 全宽仅切换 NodeView presentation class/style，不写入 Markdown。
  - “在下方添加”调用 Crepe 当前 handle 的原生 plus 动作，因此二级菜单就是同一 SlashProvider、同一菜单清单、同一 0004 视口约束。
  - 点击外部关闭，卸载时完整清理监听器。

## 验证记录

- `blockActionMenu.test.ts`：短按调用一次；移动 10px 超过阈值后不打开菜单。
- `scripts/e2e-block-interactions.mjs`：
  - 六点短按菜单整体位于 viewport 安全边界；缩进和复制链接为 disabled。
  - 全宽 class/宽度变化可见；复制得到 exact canonical `<B id="selection-e2e" />`。
  - hover “在下方添加”时主菜单保留、真实 `.milkdown-slash-menu` 打开；选择“提示块”后在块后插入 canonical source。
  - 剪切复制 exact source、删除整块，Meta+Z 恢复。
  - 测试前保存并在 finally 恢复系统剪贴板，隔离知识库不触碰真实笔记。
- 已直接查看：
  - `scripts/shots/block-interactions/08-block-action-menu.png`
  - `scripts/shots/block-interactions/09-add-below-submenu.png`

```bash
pnpm exec vitest run src/renderer/src/markdown/blockActionMenu.test.ts
pnpm build
node scripts/e2e-block-interactions.mjs
```
