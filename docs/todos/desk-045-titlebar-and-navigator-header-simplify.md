# 界面简化：删除标题栏品牌/路径与导航头，搜索框上移

## 目标

按截图标注做界面精简：

1. 删除标题栏左侧「TNotes Desk」品牌。
2. 删除标题栏中间的 workspace 路径。
3. 只删除第二列顶部「文章 / 知识库名」标题；其右侧「⋯」「+」两个按钮保留。
4. 把「搜索标题和正文」搜索框移动到第 3 项位置（即第二列最顶部）。

## 实现

- `src/renderer/src/App.vue`
  - 删除 `.brand`（TNotes Desk）与 `.workspace-name`（路径）。
  - `.titlebar-actions` 增加 `margin-left: auto` 靠右。
  - 清理 `.brand` / `.workspace-name` / `.brand-mark` 相关死 CSS（保留欢迎页 `.welcome-mark`）。
- `src/renderer/src/components/NavigatorSidebar.vue`
  - 删除 `.navigator-title`（文章 / 知识库名），保留 `.header-actions`（⋯ / +）与 `create-menu` 下拉。
  - 新增 `.navigator-top` 行：搜索框（flex:1）+ 两个按钮，置于 `aside` 顶部。
  - 保留 `createMenuOpen` / `createMenu` / `closeCreateMenu` / `chooseHeaderAction` / `previewLabel`，并清理 `.navigator-title` 相关死 CSS。
  - 保留 `togglePreview` / `revealKnowledgeBase` / `showKnowledgeBaseMenu`（仍被预览反馈与诊断区使用）。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 「⋯」菜单（新建分组 / 站点预览 / 使用 IDE 打开 / 打开知识库目录）与「+」（添加笔记）均保留，仅移除「文章 / 知识库名」标题。
- 属运行态 UI 变化，需在界面人工确认标题栏与第二列新布局。
