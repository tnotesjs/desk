# Desk 开发上下文（给 Agent 的交接文档）

> 本文件是跨设备交接时的「上下文快照」，由上一轮对话压缩而成。新 Agent 请先读本文件 + [docs/development-status.md](./docs/development-status.md)，再动手。
>
> ⚠️ **当前交接快照见 [docs/handoff-2026-08-27.md](./docs/handoff-2026-08-27.md)**（比 development-status 更新）：含本轮完成的容器/图表渲染与编辑、canonical 规范、**已根因定位+修复验证的 mindmap 居中问题（非 zoomToFit 时序，是 canvas 元素 CSS 尺寸未钉回宿主）**、computer-use 不可用但已有 **Playwright Electron 运行态自测替代（§8 runbook）**、关键文件与下一步顺序。

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
- **desk-032** 代码块失焦后当前行仍高亮 → 加 `.cm-editor:focus-within .cm-activeLine`（见下方「已解决」）。
- **desk-033** 自动生成目录支持折叠 → `renderGeneratedTocNode` 加折叠开关（容器 + toggle + list）。

## ⚠️ 尚未真正解决的问题（下一 Agent 首要关注）

### 1. 代码块「聚焦才高亮」——已解决（真机 Playwright E2E 实测，详见 handoff §5.3）

- 原症状：光标不在代码块时，多个代码块仍同时高亮首行。
- 现状：`.cm-editor:focus-within .cm-activeLine`（`MilkdownMarkdownEditor.vue` 1171–1186 行）已在真机正确切换——**未聚焦=透明、聚焦=可见**。本会话 Playwright E2E 实测确认：未聚焦时 `.cm-activeLine` 背景 `rgba(0,0,0,0)`（DOM 有装饰但不可见、无害）；点击进入代码块后 `:focus-within`=true、背景变可见色。
- 结论：**可见症状已解决**。唯一注意点：该行为**只能在真机验证**（happy-dom 测不出 `:focus-within`），用 §8 的 Playwright E2E 覆盖；旧疑虑「嵌套 CM `hasFocus` 初始为 true」在真实浏览器不成立。

### 2. 其它已知限制（来自 development-status）

- TNotes 特殊组件 / 容器仅源码保真卡片，Mermaid / 思维导图按代码块呈现，无专用可视化编辑。
- H2 折叠、复杂粘贴、移动端布局、部分光标细节待打磨。
- 安装包未签名 / 公证，Windows / Linux 未经真实设备验收。
- GitHub 图床需用户配置凭据；且与「本地文件优先」定位冲突，后续可考虑移除网络上传改为纯本地 assets。

## 下一步建议优先级

> 最新优先级以 `docs/handoff-2026-08-27.md` §6 为准；此处开发侧待办。

1. 修 mindmap 居中（handoff §5.1，已根因定位+修复验证；`@tnotesjs/mindmap-core` 发版）。
2. 完成 markmap 真实渲染（markmap-lib / markmap-view）。
3. 阶段 3：组件抽取复用——core 拆纯 Vue 渲染层（props 驱动）+ VitePress 薄适配层。
4. 补齐 `desk-001 ~ desk-022` 在 Milkdown 新架构下的回归验证（可用 Playwright E2E 固化）。
5. 图片改为纯本地写入 assets（当前有 GitHub 图床逻辑，与本地优先定位不符）。

## 重要环境说明

- 测试知识库：`desk/playground` 下 `TNotes.algorithms`（36 篇）、`TNotes.docs`（40 篇），共 76 篇；`TNotes.python`、`TNotes.javascript` 等可能在 playground 中可视测试。
- 运行态 UI 验证：**优先用 `docs/handoff-2026-08-27.md` §8 的 Playwright Electron E2E**（CDP 驱动 + 截图像素断言，无需 Computer Use / 屏幕录制权限）；若需真外设/系统级交互才回落 computer-use。
- 本机 Dev 服务器：`pnpm dev`（Electron 窗口，vite 5173）。
