# Desk 开发上下文（给 Agent 的交接文档）

> 本文件是跨设备交接时的「上下文快照」，由上一轮对话压缩而成。新 Agent 请先读本文件 + [docs/development-status.md](./docs/development-status.md)，再动手。

## 项目快照

- 定位：TNotes 本地优先桌面客户端（Electron + Vue 3 + TypeScript）。
- 编辑器：`@milkdown/crepe`（可视化）+ 独立 CodeMirror 6 源码编辑器。
- Core：依赖 NPM 发布的 `@tnotesjs/core@0.6.0`，不同级 Core 源码。
- 当前 Git：本地 `main` 领先 `origin/main` 1 个 commit（`a287484 update`），**尚未 push**。
- 验证门禁：`pnpm lint && pnpm test && pnpm typecheck && pnpm build && pnpm exec prettier --check .`
- Node 22 / pnpm 11（本机可能是 Node 24，但现有检查均通过）。

## 已完成的关键决策

- 可视化编辑器**迁移到 Milkdown/Crepe**；旧 CodeMirror 伪可视化实现（`visualBlocks.ts`、`visualExtension.ts`、`specialBlocks.ts`、`slashCommands.ts`、`MarkdownEditor.vue`）已删除。
- 为「单机、本地文件优先」重新收窄定位：不做协同 / AI / 后端。**不需要** `plugin-collab`、`yjs`、`plugin-diff`、`plugin-streaming`。
- Markdown 继续作为磁盘 canonical 格式；源码视图保留独立 CodeMirror。
- 自定义语法（frontmatter、容器、组件、引用定义、生成标题/目录、HTML、含 HTML 表格）通过 `rawBlockProjection.ts` 投影为**不可编辑原子块**映射到 Milkdown，由 `sourcePreservation.ts` 保证未编辑块字节级零 diff。
- 参考 `docs/development-status.md` 的「仓库提交约定」：Core 联动改动按 Core 发布 → Desk 锁版本 → Desk 独立验证的顺序。

## 已完成且提交的问题修复（desk-001 ~ desk-027）

详见 `docs/development-status.md`。绝大多数「可视化编辑体验」类问题已通过 Milkdown 迁移 + 原子块投影 + 源码保护层解决。早期 bug 清单（desk-001 ~ desk-022）是迁移前的 CodeMirror 伪可视化阶段排查记录的，迁移后大部分不再适用。

## 本次交接前刚完成的工作（已提交）

这些是在迁移完成后、新一轮 UI 打磨阶段完成的，均已提交进 `a287484`：

完整 bug / 功能记录已随工程保存至 [docs/todos/](./docs/todos/)（desk-023 ~ desk-033），逐个查看：

- **desk-023** 自动生成标题 / 目录渲染为源码卡片 → 改为渲染成真 H1 / 目录。
- **desk-024** 主进程 `console.log` EPIPE 崩溃 → `src/main/log.ts` 加固（忽略流关闭类错误）。
- **desk-025** Milkdown 拖拽误触发拆分浮层 → `EditorGroup.vue` 用 `isTabDrag` 判别。
- **desk-026** TOC 点击不定位 → `MilkdownMarkdownEditor.vue` 用 `github-slugger` 按标题文本兜底匹配。
- **desk-027** 引用定义渲染成源码卡片 → `raw-reference-definition` 块标为 hidden。
- **desk-028** 代码块语言下拉透明 → `.milkdown` 根补 `color` + code-block 浮层配色。
- **desk-029** 复制按钮成蓝色胶囊 → 覆盖 `.tools-button-group button` 为面板灰。
- **desk-030** 亮色模式当前行 / 行号列颜色错 → 对齐源码编辑器 `cm-gutters` / `cm-activeLine`。
- **desk-031** 代码块语言常驻、复制 hover、外框 hover → code-block 交互显隐调整。
- **desk-032** 代码块失焦后当前行仍高亮 → 加 `.cm-editor.cm-focused`（见下方「未解决」）。
- **desk-033** 自动生成目录支持折叠 → `renderGeneratedTocNode` 加折叠开关（容器 + toggle + list）。

## ⚠️ 尚未真正解决的问题（下一 Agent 首要关注）

### 1. 代码块「聚焦才高亮」未根治（重要）

- 现象：光标不在代码块时，多个代码块仍同时高亮首行。
- 根因（已从 `@codemirror/view` 源码确认）：`highlightActiveLine()` **不检查 `view.hasFocus`**，无条件给当前 selection 行（默认第 1 行）加 `cm-activeLine` 装饰。Crepe 通过 `basicSetup` 引入了该插件。
- 当前尝试：`MilkdownMarkdownEditor.vue` 用 `.cm-editor:focus-within .cm-activeLine` 控制背景。**但它不可靠**——happy-dom 测不出 `:focus-within`，且嵌套 CodeMirror 的 `cm-focused` / `hasFocus` 初始即 true，跟真实用户点击不联动。
- **建议**：改用真正由 ProseMirror 文档状态驱动的方式——当 milkdown 的 selection 落在 `code_block` 节点内时才高亮，或用 `ViewPlugin` 基于 `view.hasFocus` 动态增删 `cm-activeLine` 装饰，而不是纯 CSS。需要先实测确认。

### 2. 其它已知限制（来自 development-status）

- TNotes 特殊组件 / 容器仅源码保真卡片，Mermaid / 思维导图按代码块呈现，无专用可视化编辑。
- H2 折叠、复杂粘贴、移动端布局、部分光标细节待打磨。
- 安装包未签名 / 公证，Windows / Linux 未经真实设备验收。
- GitHub 图床需用户配置凭据；且与「本地文件优先」定位冲突，后续可考虑移除网络上传改为纯本地 assets。

## 下一步建议优先级

1. 根治代码块「聚焦才高亮」（见上）。
2. 与 VitePress 发布效果一致性：评估 Mermaid / MarkMap / Swiper / Container 的专用 NodeView 与预览（按需，不必全做）。
3. 图片改为纯本地写入 assets（当前有 GitHub 图床逻辑，与本地优先定位不符）。
4. 补齐 `desk-001 ~ desk-022` 在 Milkdown 新架构下的回归验证，确认哪些仍可复现。

## 重要环境说明

- 测试知识库：`desk/playground` 下 `TNotes.algorithms`（36 篇）、`TNotes.docs`（40 篇），共 76 篇；`TNotes.python`、`TNotes.javascript` 等可能在 playground 中可视测试。
- 运行态 UI 验证需本机「Computer Use / node_repl」能力，且解锁屏幕。若不可用，UI 类改动只能靠用户人工确认。
- 本机 Dev 服务器：`pnpm dev`（Electron 窗口，vite 5173）。
