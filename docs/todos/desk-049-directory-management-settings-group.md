# 设置面板新增「目录管理」分组

## 目标

设置面板新增「目录管理」分组，并把「新增笔记位置」移入该组；分组包含：

1. 是否显示笔记编号（笔记标题前 4 个数字）。
2. 是否显示已完成 / 未完成状态标识（icon）。
3. 可配置已完成 / 未完成 emoji，默认 ✅ / ⏰，支持留空不显示；仅在开启状态标识时显示。
4. 变更区域默认是否折叠（默认折叠）。

## 实现

- `src/shared/contracts.ts` / `src/main/settings.ts`
  - `AppSettings` 新增 `toc: { showNoteIndex, showNoteStatus, doneEmoji, undoneEmoji, changesCollapsedByDefault }`，默认 `{ true, true, '✅', '⏰', true }`。
- `src/renderer/src/components/SettingsPanel.vue`
  - 左侧导航新增「目录管理」分组（含图标），分区含：
    - 新增笔记位置（从常规组移入，`field-grid cols-3`，标签在上避免换行）。
    - 显示笔记编号、显示完成状态标识（开关）。
    - 已完成 / 未完成 emoji：始终展示，使用 `EmojiInput`；未勾选「显示完成状态标识」时置灰并禁用。
    - 变更区域默认折叠（开关）。
  - `groupDefaults.toc` 增加对应默认值。
- `src/renderer/src/components/EmojiInput.vue`（新增）
  - 文本输入框（可输入任意单个字符，用 `Array.from` + `length` 校验并裁剪到单个字符）+ 右侧 `▾` 弹出 emoji 选择面板。
  - 支持留空（删除内容即为「不显示」）；`disabled` 时整体置灰、禁止交互。
- `src/renderer/src/components/TocNodeList.vue`
  - 引入 `useWorkspaceStore`，按 `toc.showNoteIndex` 决定是否隐藏 `.note-index`。
  - 按 `toc.showNoteStatus` 决定是否隐藏 `done-toggle`；状态图标用 `doneEmoji` / `undoneEmoji`（可留空）。
- `src/renderer/src/components/NavigatorSidebar.vue`
  - `changesExpanded` 初值改为 `!(store.settings?.toc?.changesCollapsedByDefault ?? true)`（默认折叠）。
  - 笔记文件变更项按 `toc.showNoteIndex` 决定是否展示编号。
- 测试：mock AppSettings 补 `toc`；`TocNodeList.test.ts` 增加 Pinia 初始化。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 隐藏状态标识会同时隐藏 TOC 行的勾选按钮；完成/未完成仍可通过 TOC 行右键菜单切换。
- 「变更」默认折叠只在会话初始生效（按配置初始化 `changesExpanded`），运行中改配置不影响当前会话。
