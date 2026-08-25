# 点击「自动生成目录」不跳转到对应标题

## 现象

Milkdown / Crepe 可视化编辑视图中，点击笔记顶部的「自动生成目录」条目（如 `1. 本节内容`）时，页面没有任何反应，不会滚动到对应标题。

## 根因

TOC 区域中的锚点由 Core / `github-slugger` 生成，例如：

- `#1-本节内容`
- `#3-hello-algo-是什么`

而 Milkdown / Crepe 在渲染标题时生成的 DOM `id` 使用了自己的一套 slug 规则，两者不一致：

| 标题文本                 | TOC 锚点               | Milkdown 标题 id         |
| ------------------------ | ---------------------- | ------------------------ |
| `1. 本节内容`            | `#1-本节内容`          | `1.-本节内容`            |
| `3. hello-algo 是什么？` | `#3-hello-algo-是什么` | `3.-hello-algo-是什么？` |

`MilkdownMarkdownEditor.vue` 的 `handleClick` 原先通过 `querySelectorAll('[id]')` 精确匹配 `element.id === targetId`，因 Milkdown 的 id 与 TOC 锚点不一致而找不到目标，于是不滚动。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 将 `github-slugger` 提升为直接依赖（`package.json` + `pnpm-lock.yaml`），运行时用其 `slug()` 生成与 TOC 锚点一致的规范化 slug。
- 新增 `resolveHeadingTarget(targetId)`：
  - 先按 DOM `[id]` 精确匹配；
  - 未命中时遍历 `h1..h6`，用 `githubSlugger.slug(headingText)` 重新计算规范化 slug 再比对，命中即返回目标标题。
- `headingElementText`：取出标题文本并去掉行尾 `#`。

`src/renderer/src/markdown/MilkdownMarkdownEditor.test.ts`

- 新增用例「resolves TOC anchors even when Milkdown heading ids diverge from canonical slugs」：
  - 断言 TOC 锚点 `#1-本节内容` 与 Milkdown 标题 id `1.-本节内容` 确实不同，确保测试走的是兜底匹配路径；
  - 点击 TOC 条目后断言目标标题收到 `scrollIntoView({ block: 'start' })`。

## 验证

- `pnpm test`：15 个测试文件、79 项全部通过（新增 1 项）。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。

## 备注

- `pnpm install` 将 lock 文件收敛到当前 package.json，移除了 Milkdown 迁移后残留的旧依赖（`markdown-it`、`highlight.js`、`mermaid`、`turndown`、`markdown-it-task-lists`、`@tnotesjs/mindmap-core` 等），这些已不在 package.json 中。
