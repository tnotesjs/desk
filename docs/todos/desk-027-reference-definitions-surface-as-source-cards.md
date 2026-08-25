# 引用式链接的引用定义被渲染成可见源码卡片

## 现象

在 Milkdown / Crepe 可视化编辑视图中，使用引用式链接的段落（如 `[hello 算法 github 仓库][1]`）本应显示为可点击链接，但页面底部出现一张「链接定义 [1]: https://github.com/krahets/hello-algo」的源码卡片，引用定义（元数据）作为可见内容暴露。

## 根因

笔记源码中的引用定义，例如：

```md
- [hello 算法 github 仓库][1]
- [hello 算法在线阅读][2]

[1]: https://github.com/krahets/hello-algo
[2]: https://www.hello-algo.com/
```

旧可视化会把 `[1]: ...` 这类定义用 `referenceDefinitions()` 抽取出来单独传给 markdown-it 解析，不渲染为正文。

Milkdown 版在 `rawBlockProjection.ts` 中把 `raw-reference-definition` 块投影为 `deskRawBlock` 原子，但 `hidden` 判定仅使用 `isRegionComment(block)`，未把引用定义视为隐藏。于是该原子以「标签 + 源码预览」卡片（`hidden: false`）渲染，露出了引用定义源码。

## 修复

`src/renderer/src/editor/markdown/rawBlockProjection.ts`

- `projectRawBlocksForMilkdown` 中 `hidden` 判定改为：`isRegionComment(block) || block.kind === 'raw-reference-definition'`。
- 引用定义因此渲染为 `.desk-raw-block--hidden`（`display: none`），不再显示源码；同时作为原子节点保留 `immutableRawBlockPlugin` 无损保护，序列化时仍通过 `toMarkdown` 还原原始字节。

`src/renderer/src/editor/markdown/rawBlockProjection.test.ts`

- 更新「keeps reference definitions available for resolution」用例，断言 marker `hidden: true`。

`src/renderer/src/markdown/MilkdownMarkdownEditor.test.ts`

- 新增「renders reference-style links as links and hides the definition atom」用例：
  - 断言 `[1]`/`[2]` 引用式链接渲染为带正确 `href` 与文本的 `<a>`；
  - 断言可见 raw block 为 0、隐藏 raw block 为 1。

## 验证

- 探针渲染结果：`links=[hello 算法 github 仓库 -> https://github.com/krahets/hello-algo, hello 算法在线阅读 -> https://www.hello-algo.com/]`，`visibleRawBlocks=0`，`hiddenRawBlocks=1`。
- `pnpm test`：15 个测试文件、80 项全部通过（新增 1 项）。
- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm build`：通过。
