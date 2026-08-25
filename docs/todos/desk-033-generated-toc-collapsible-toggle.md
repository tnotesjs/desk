# 自动生成目录支持折叠切换

## 需求

在 Milkdown / Crepe 可视化编辑视图中，「自动生成目录」（`<!-- region:toc -->` 区域）应支持折叠 / 展开切换显示与隐藏。

## 实现

`src/renderer/src/editor/markdown/rawBlockProjection.ts`

- `renderGeneratedTocNode` 由返回 `<ul>` 改为返回外层容器：
  - `div.desk-generated-toc`（不可编辑原子块，`contentEditable = false`）
  - `button.desk-generated-toc__toggle`（折叠开关），含图标 `__toggle-icon` 和标签 `__toggle-label`
  - `ul.desk-generated-toc__list`（目录列表）
- 点击 toggle 时 `event.stopPropagation()`，切换 `is-collapsed` class，并同步 `aria-expanded` / `aria-label`。

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 去掉 TOC 外层容器背景（此前用户要求移除背景）。
- 更新 `.desk-generated-toc` 相关样式：
  - `__toggle`：inline-flex，浅色文字，hover 加深，三角形图标随折叠旋转；
  - `.is-collapsed .desk-generated-toc__list`：`display: none`；
  - `__list` / `__list ul`：统一 `1.4em` 左侧缩进。
- 保留 `.desk-generated-toc.ProseMirror-selectednode` 选中态 outline。

## 验证

- 新增用例「renders a collapsible toggle for the generated TOC」：
  - 断言容器包含 toggle 与 list；
  - 点击 toggle 后容器带 `is-collapsed`、`aria-expanded=false`、`aria-label=展开目录`。
- `pnpm test`：15 个测试文件、81 项全部通过（新增 1 项）。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。

## 备注

- 折叠为纯前端 UI 状态，不改变 Markdown 源码，也不会触发保存 / 不可变保护。
