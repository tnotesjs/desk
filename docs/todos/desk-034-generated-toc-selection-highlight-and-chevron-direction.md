# 自动生成目录：点击出现选中高亮、折叠箭头方向相反

## 现象

可视化视图下点击自动生成的目录区域会自动出现一圈高亮（蓝色描边）；同时目录的折叠箭头方向与习惯相反：展开时箭头朝右、收起时箭头朝下。

## 根因

- 高亮：`deskRawBlock` 节点定义为 `atom: true, selectable: true`，点击目录会整块选中，命中 `.desk-generated-toc.ProseMirror-selectednode` 的 `outline`；ProseMirror 自带的 `.ProseMirror-selectednode { outline: 2px solid #8cf }` 也会叠加。
- 箭头：`.desk-generated-toc__toggle-icon` 默认用 `border-left` 画成右向三角（展开态朝右），收起时 `rotate(90deg)` 变成朝下，正好与「展开朝下、收起朝右」相反。

初版只去掉了 `outline`，但点击目录仍会出现一块蓝底背景。经排查，这是节点被选中后浏览器绘制在 `contenteditable=false` 原子块上的**原生 `::selection` 高亮**，`outline: none` 无法覆盖。

## 修复

`src/renderer/src/markdown/MilkdownMarkdownEditor.vue`

- 目录选中态去掉描边：
  - `.desk-generated-toc.ProseMirror-selectednode { outline: none; box-shadow: none; }`
- 翻转箭头方向：
  - `.desk-generated-toc__toggle-icon` 改为默认下向三角（`border-top` 着色）。
  - `.desk-generated-toc.is-collapsed .desk-generated-toc__toggle-icon` 改为 `transform: rotate(-90deg)`，让收起态朝右。
- 目录 / 标题 / 源码卡片的 `::selection` 与子孙 `::selection` 设为透明背景，消除原生蓝底残影。

`src/renderer/src/editor/markdown/rawBlockProjection.ts`

- `deskRawBlock` 节点 `selectable: true` → `false`：从根本上阻止「点击/方向键」自动创建 NodeSelection，从而不产生选中态、不绘制原生高亮。程序化的 `setNodeSelection`（如 Milkdown block handle 拖拽）不受影响，仍可对块进行操作。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、81 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 高亮与箭头方向均属浏览器渲染表现，happy-dom 无法计算渲染后的 outline / transform / 原生 `::selection`，需运行态人工确认：点击目录不再出现描边或蓝底；展开态箭头朝下、收起态箭头朝右。
- `selectable: false` 同时会让其它保护性原子（源码卡片、生成标题）在点击时不再产生选中高亮，属于一致的行为改进；如需删除这类块，仍可在源码视图编辑或通过块拖拽选中。
