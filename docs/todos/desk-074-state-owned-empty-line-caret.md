# desk-074：空行光标改为 Selection 单一状态源

## 对应需求

- `todos/2026.08.29/0020` 二次修复。
- 真实复现笔记：`playground/TNotes.docs/notes/0041. new/README.md`。

## 状态

- 未解决；第二轮方案已被 2026-08-30 用户现场反例推翻，当前作为失败尝试保留用于追溯。
- 最新现象：亮色模式真实笔记 `0041. new` 中，连续 `<br />` 区域首尾同时出现两根相隔多行的蓝色光标。

## 现场证据

- 笔记源码包含 5 个 standalone `<br />`，可视化中投影为 5 个连续 `raw-break` 原子。
- 新启动 Electron 对每个空行的顶部、中部、底部逐点点击时，ProseMirror 状态始终只有一个 NodeSelection；边界命中时也只有一个 boundary Decoration。
- 原实现的可见空行光标不是 Decoration，而是 `.desk-raw-block--empty-line.ProseMirror-selectednode::before`。也就是说，NodeView 上任何残留的命令式选中类都有独立绘制光标的能力；这与用户截图中不同空行同时出现光标一致。
- 电脑控制能够读取默认开发实例和真实笔记，但点击动作返回 `Sky Computer Use native pipe closed before response`。因此未声称电脑控制完成点击验收，后续用 Electron CDP 对同一真实文件做运行态点击和 DOM 检查。

## 模块改动

### `rawBlockInteractions.ts`

- `selectedRawBlockDecorations` 在当前 NodeSelection 为 `raw-break` 且不处于 boundary 状态时，生成唯一 `desk-raw-selection-cursor` widget。
- widget 的 key 带当前 `selection.from`，每次 Selection 事务由 DecorationSet 原子替换，文档中不会同时保留多个普通空行光标。
- boundary 状态优先，只生成原有的 `desk-raw-boundary-cursor`，不会与普通 selection widget 并存。

### `MilkdownMarkdownEditor.vue`

- 删除 `.ProseMirror-selectednode::before` 的光标绘制规则；选中类仅保留节点选中语义，不再拥有视觉光标。
- 为 `desk-raw-selection-cursor` 增加 1px、20px 高的主题色光标样式。
- raw selection/boundary widget 存在时统一隐藏 Milkdown 虚拟光标；只读模式同时隐藏这两类 widget。

### 测试与运行态脚本

- `rawBlockInteractions.test.ts`：连续 3 个空行间移动 NodeSelection 时，DOM 永远只有一个 selection cursor，且不混入 boundary cursor。
- `e2e-empty-break-deletion.mjs`：验证唯一 selection widget、只读零光标、逐条删除和保存源码数量。
- `e2e-actual-break-carets.mjs`：直接加载真实 `0041. new`，覆盖 5 个空行 × 10 个纵向点击点 × 4 个观察延迟，以及源码→可视化生命周期；暗色模式共 200 组均只有一个光标实现。
- 同一脚本主动制造 3 个残留 `.ProseMirror-selectednode` 类，仍只绘制当前 Selection 对应的一根 widget，防止旧问题因 NodeView 生命周期再次出现。

## 验证结果

- 定向单测：`rawBlockInteractions.test.ts`、`MilkdownMarkdownEditor.test.ts` 共 20 项通过。
- 隔离 Electron：空行唯一光标、只读零光标、删除与保存全部通过。
- 真实笔记 Electron：200 组暗色点击采样重复数为 0；注入 3 个残留选中类后可见光标仍为 1。
- 暗色截图：`scripts/shots/actual-break-carets/stale-nodeview-classes-single-caret.png`。
- 全仓门禁：lint、28 个测试文件 / 183 项测试、typecheck、build、Prettier 全部通过。

## 结论修正（2026-08-30）

- 上述验证均来自新启动、隔离 profile 的 Electron，且主要按单次点击和源码→可视化切换采样；它没有覆盖用户当前实例中能稳定出现的生命周期状态。
- 用户最新截图证明 Decoration widget 迁移仍未消除第二个可见绘制源，因此“Selection 单一状态源”只描述了插件状态，不等于页面实际只有一个光标。
- 后续修复必须同时检查 `.desk-raw-selection-cursor`、`.desk-raw-boundary-cursor`、`.prosemirror-virtual-cursor`、原生 caret、`.ProseMirror-selectednode` 以及编辑器重挂载后的残留 DOM；未在相同场景复现并验证前，本记录不得恢复为已完成。
