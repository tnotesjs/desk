# 知识库/目录列表可拖拽调整宽度 + 知识库最小宽度 compact

## 目标

1. 知识库列表与目录列表容器支持横向拖拽调整宽度。
2. 给出合理最小 / 最大 / 默认宽度。
3. 知识库列表到达最小宽度时只渲染 icon：头部只留一个更新 icon，底部只留一个「更换」按钮文案。

## 实现

- `src/renderer/src/stores/editor.ts`
  - 导出列宽常量：`KNOWLEDGE_SIDEBAR_MIN=52 / DEFAULT=218 / MAX=380 / COMPACT=104`，`NAVIGATOR_SIDEBAR_MIN=200 / DEFAULT=292 / MAX=480`。
  - 新增 `clampSidebarWidth(value, min, max)`；宽度 refs 改用默认常量。
- `src/renderer/src/App.vue`
  - `workspaceColumns` 改为 `knowledgeWidth 6px navigatorWidth 6px minmax(0,1fr)`，加入两个 `.resize-handle` 分隔列。
  - 新增 `startResize` / `onResizeMove` / `onResizeEnd`，拖动时用 `clampSidebarWidth` 更新宽度，结束调用 `persistSession` 持久化。
  - 手柄样式：`cursor: col-resize`，hover / 拖拽时显示 accent；`body.is-resizing` 禁用文本选择。
- `src/renderer/src/components/KnowledgeSidebar.vue`
  - 读取 `editor.knowledgeSidebarWidth`，`compact = width <= KNOWLEDGE_SIDEBAR_COMPACT (104)`。
  - compact 时：头部只显示刷新 icon（隐藏「工作区/知识库」标题并居中），知识库项只显示图标（隐藏标题），底部只显示「更换」按钮（隐藏路径）。
  - 补充 `.knowledge-sidebar.compact` 布局样式。
- 头部删除「工作区」字样，只保留「知识库」；`.eyebrow` 样式清理。

## 宽度阈值说明

- 由 header 左右内边距（26px）+「知识库」14px(≈42px) + 刷新按钮(28px) + 最小间距，得出需 ≥104px 才不换行；故 `KNOWLEDGE_SIDEBAR_COMPACT = 104`。低于 104 进入 compact（只渲染 icon）。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 默认宽度沿用原 218 / 292；知识库最小 52（compact 图标栏），目录最小 200。
- 宽度写入 `WorkspaceSession`，随会话持久化，重启恢复。
- 属运行态交互，需在界面确认拖动手柄可用、限宽生效、知识库 compact 只显示图标。
