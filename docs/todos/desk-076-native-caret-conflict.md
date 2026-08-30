# desk-076：Crepe 虚拟光标与浏览器原生 caret 冲突

## 对应需求

- `todos/2026.08.29/0020` 第三轮修复。
- 用户现场反例：亮色模式的连续 `<br />` 区域首尾同时出现两根相隔多行的蓝色光标。

## 状态

- 已完成（2026-08-30）

## 根因证据

- Crepe 默认启用 cursor feature，根节点带 `.virtual-cursor-enabled`。上游样式会把浏览器原生 caret 隐藏，改由 `.prosemirror-virtual-cursor` 绘制可见光标。
- Desk 原有 scoped 规则 `.milkdown-markdown-editor :deep(.ProseMirror)` 无条件写入 `caret-color: var(--accent-strong)`，其优先级高于上游透明规则，也覆盖 `.ProseMirror-hideselection`。
- raw-break 使用 NodeSelection/Decoration 绘制 Desk 光标时，DOM Selection 可仍停留在上一个文本/空行位置。浏览器原生 caret 被重新启用后，它与当前 Desk 光标同时可见，形成用户截图中的两根光标。
- desk-074 只把 raw-break 光标从 NodeView 伪元素迁移到唯一 Selection widget，消除了残留 NodeView 类的绘制权，但没有统计或关闭浏览器原生 caret，因此隔离脚本当时出现了假阴性。

## 模块改动

### `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 删除 `.ProseMirror` 上无条件的 `caret-color`。
- 仅当编辑器可编辑、未启用 `.virtual-cursor-enabled` 且没有 `.ProseMirror-hideselection` 时，允许浏览器原生 caret 使用 accent。
- 虚拟光标开启或 ProseMirror 隐藏 DOM Selection 时显式设置 `caret-color: transparent`，由虚拟光标或 Desk selection/boundary widget 唯一负责可见反馈。

### `scripts/e2e-actual-break-carets.mjs`

- 读取根节点 `virtualCursorEnabled` 与计算后的 `caretColor`，把非透明浏览器 caret 纳入 `paintedCaretImplementations` 计数。
- 同时记录 DOM Selection、raw-break 类、Selection/Boundary widget、Milkdown virtual cursor、gap cursor 和 drop cursor，避免只数 DOM widget 再次漏报。
- 浅色主题覆盖真实 `0041. new` 的首→末空行点击与源码→可视化切换；当前用户笔记的空行数从历史 5 个变成了 1 个，因此脚本只读地动态发现数量，不写回或恢复用户文件。
- 暗色扫描覆盖每个现存空行的上/中/下边界及 0/40/160/520ms 延迟，要求原生 caret 始终透明且总可见光标实现数为 1。

### `scripts/e2e-block-interactions.mjs`

- 原“根节点 caret 为 accent”的断言纠正为：根节点浏览器 caret 透明，虚拟光标可见且 2px 左边框为 accent。

### `docs/todos/desk-069-dark-editor-caret.md`

- 更正历史说明：暗色模式可见的是 Crepe 虚拟光标，不是应该被隐藏的浏览器原生 caret。

## 验证

- 真实笔记（当前 1 个 raw-break）：浅色点击、源码→可视化切换、暗色多位置/多延迟扫描均为 1 个可见光标实现，`ANOMALIES: 0`。
- 隔离 3 空行夹具：拖选后单击中间空行仅显示 1 个 Desk selection cursor；只读视图为 0 个光标。
- 块交互 Electron E2E 17 项通过，其中暗色光标断言确认虚拟光标为 accent、浏览器原生 caret 为透明。
- 全仓门禁通过：lint、28 个测试文件 / 184 项测试、typecheck、build、Prettier。
