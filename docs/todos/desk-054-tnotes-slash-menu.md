# desk-054：扩展 TNotes 斜杠菜单

## 对应需求

- `todos/2026.08.29/0001`（迁移自 `2026.08.28/0005`）

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/slashMenu.ts`
  - 维护独立的 14 项插入清单，不读取 `TNOTES_COMPONENTS`。
  - 每项包含稳定 `id`、展示名、搜索别名、类型和唯一 canonical insert。
  - `id` 用作 Crepe/Vue 菜单 key，避免多个容器或组件复用 `kind` 导致筛选重绘错行。
  - Crepe 没有独立 keywords 字段：内部 label 用不可见分隔符携带别名和查询空格 padding，DOM observer 只呈现展示名。这样 `/ mmd ` 也按 trim 后的 `mmd` 搜索，但菜单不会漏出 `merma` 一类元数据。
- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - 通过 `Crepe.Feature.BlockEdit.buildMenu` 追加 TNotes 组。
  - raw 容器、组件和图表先投影成 `deskRawBlock`，插入后自动打开内联源码编辑器。
  - 普通代码块先清理 `/query`，再创建语言为 `js` 的 Crepe code block；不能复用工具栏“保留段落内容”的路径。
  - 容器、组件、图表统一使用源码编辑器；高度按源码行数在 132–320px 内自适应，短 snippet 不再占用大块空白。
- `src/renderer/src/editor/markdown/rawBlockProjection.ts`
  - immutable 保护允许新增 raw atom。
  - 带专用源码编辑器的 `raw-container`、`raw-component`、`raw-diagram` 允许提交源码修改；其它不透明块继续字节锁定。
- `src/renderer/src/editor/markdown/diagramRenderer.ts`
  - 新插入的空 Mermaid/Mindmap 不再显示解析错误或空白大画布，改为“输入源码后显示预览”的平静占位态。
- `scripts/e2e-markdown-input.mjs`
  - 每次创建 OS 临时 workspace、profile、知识库和笔记，结束后删除；不会保存到 playground 或用户笔记。
  - 直接启动当前 `out/main/index.js`，驱动真实 Electron DOM、键盘和 CodeMirror，不读取历史截图。

## 测试与交互记录

- `slashInsert.test.ts` 覆盖 13 种 raw 项的投影插入、组件/图表 marker、唯一菜单 key，以及“别名可搜索但界面只显示展示名”。
- `diagramRenderer.test.ts` 覆盖空 Mermaid/Mindmap 占位态。
- Electron E2E 共 13 组交互场景，覆盖非空段落/前导空格/列表限制、带首尾空格的 `/ mmd ` 别名筛选、干净菜单文案、精确 canonical source、源码首位聚焦、紧凑高度、组件编辑回写、`code` 多结果和普通代码块不残留 `/query`；最后点击真实“保存”并从临时笔记磁盘文件反查容器、图表和已编辑组件源码。
- 交互截图（均由本轮当前构建生成，目录已被 gitignore）：
  - `scripts/shots/markdown-input/01-slash-alias-search.png`
  - `scripts/shots/markdown-input/02-slash-tip-source-editor.png`
  - `scripts/shots/markdown-input/03-inline-results.png`
- Computer Use 能读取 Desk 窗口状态，但本机 native pipe 在点击时关闭；本轮按 `docs/handoff-2026-08-27.md` 的运行态方案改用 Playwright Electron 完成同一真实 UI 测试。此限制不影响应用功能。
- 曾执行旧 `scripts/e2e-mindmap.mjs --slash` 产生的 TIP 已精确移除，并确认 `playground/TNotes.docs` 工作树干净；该会写真实 playground 的临时分支已从脚本移除。

## 后续 Agent 复现

```bash
pnpm exec electron-vite build
node scripts/e2e-markdown-input.mjs
```

结果：13/13 运行态交互断言通过。

全仓门禁：

```bash
pnpm lint && pnpm test && pnpm typecheck && pnpm build && pnpm exec prettier --check .
```

结果：lint 通过；24 个测试文件、162 个测试通过；Node/Web 类型检查、生产构建、Prettier 均通过。
