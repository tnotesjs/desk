# 自动生成标题与自动生成目录在可视化视图渲染为源码卡片

## 现象

在 Milkdown / Crepe 可视化编辑视图中，笔记顶部的「自动生成标题」和「自动生成目录」没有被渲染成真正的 H1 标题与目录列表，而是以「源码卡片」的形式展示：

- 「自动生成标题」卡片里露出原始 Markdown：`# [0013. TNotes.algorithms](https://…)`
- 「自动生成目录」卡片里露出原始注释：`<!-- region:toc -->`

这与重构前（CodeMirror 伪可视化 + markdown-it）的视觉不一致，用户看到的标题和目录区域呈现异常。

## 根因

迁移到 Milkdown 后，`rawBlockProjection.ts` 为了保护 Core 会再次生成的标题与 TOC 区域（避免用户输入在 Core 重新生成时静默丢失），把这两类块投影成了 `deskRawBlock` 原子块。

但该原子块的 `toDOM` 对**所有**投影块统一渲染成「标签 + 源码预览」的卡片样式，没有为 `raw-generated-title` / `raw-generated-toc` 提供语义化渲染分支，因此标题和目录被折叠成了源码卡片。

## 修复

`src/renderer/src/editor/markdown/rawBlockProjection.ts`

- 为 `raw-generated-title` 增加 `renderGeneratedTitleNode`：解析源码中的 ATX H1 与内联链接，渲染为真正的 `<h1>` 标题元素，链接保留可点击。
- 为 `raw-generated-toc` 增加 `renderGeneratedTocNode`：解析源码中的 `- [标题](#锚点)` 列表缩进，递归渲染为嵌套目录 `<ul>` / `<a>`。
- 保持两者 `contentEditable = false`，仍是不可编辑原子块，`immutableRawBlockPlugin` 的无损保护不受影响。

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 新增 `.desk-generated-title`、`.desk-generated-toc` 及 `__link` 的样式，使其对齐现有编辑器视觉，不再显示为源码卡片。

## 验证

- `pnpm test`：15 个测试文件、78 项全部通过，含 rawBlockProjection / sourcePreservation / MilkdownMarkdownEditor 相关用例。
- `pnpm typecheck`：通过。
- 开发模式热更新后控制台无报错。

## 待确认

- 目录标题为纯 H1 展示，链接指向仓库地址；TOC 链接仍为页内锚点，需在运行态实际点击确认锚点跳转与阅读视图下的样式一致性。
