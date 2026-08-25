# TNotes Desk

TNotes 的本地优先桌面客户端，使用 Electron、Vue 3、TypeScript、Milkdown / Crepe 和 CodeMirror 6 构建。

> Desk 当前处于开发预览阶段，功能和交互仍会持续调整。当前完成度、已知限制和提交约定见[开发进度说明](./docs/development-status.md)。

## 当前开发版本能力

- 选择一个父目录并扫描其直接子目录中的 `TNotes.*` 知识库；配置异常的知识库仍会显示诊断信息
- 三栏导航：知识库、当前知识库的目录与 Git 变更、可拆分的编辑区域
- 笔记标签支持 Milkdown / Crepe 可视化编辑、只读和 CodeMirror Markdown 源码三种视图；标题、目录和笔记编号规则复用 `@tnotesjs/core`
- 可视化编辑支持传统 Markdown、GFM、任务列表、表格、代码块和 KaTeX；TNotes 特殊组件以只读原子卡片保留，Mermaid 和思维导图暂按代码块编辑，专用交互后续迭代
- 未编辑内容保存时保持字节级不变；编辑普通块时只更新目标块，避免 Git 中出现整篇格式化 diff
- 网页标签与笔记标签相互独立，可访问普通网页，也可启动 `pnpm tn:dev` 后打开本地站点
- 全文搜索使用后台 Worker 和持久化增量索引
- Git 状态、ahead/behind、变更分组、拉取、提交推送、空闲自动推送和冲突 IDE 引导
- 图片默认保存至当前笔记的 `assets`；可选 GitHub 图床，上传失败自动回退到本地
- 支持 VS Code / Cursor 快捷入口；设置和会话保存在本机，GitHub Token 通过系统安全存储加密

`TOC.md` 是目录结构的唯一真相源。Desk 在目录变更时同步 `TOC.md` 和 `sidebar.json`，不会改写知识库根目录的 `README.md`。

## 安全边界

- Renderer 开启沙箱与上下文隔离，不启用 Node 集成
- 所有文件操作都在主进程校验路径，网页标签使用独立的持久化 Session
- 删除笔记是不可恢复的永久删除，执行前会明确列出未被 Git 跟踪的资源
- Desk 不维护独立历史；历史回溯由知识库自身的 Git 仓库负责

## 本地开发

需要 Node.js 22 和 pnpm 11。

```bash
pnpm install
pnpm dev
```

Desk 使用已发布的 `@tnotesjs/core@0.6.0`，不依赖同级 Core 源码目录，可以单独克隆、安装和构建。

完整校验：

```bash
pnpm lint
pnpm test
pnpm typecheck
pnpm build
```

构建安装包：

```bash
pnpm build:mac
pnpm build:win
pnpm build:linux
```

GitHub Actions 会在提交和 Pull Request 上执行静态检查、测试与构建。项目当前不创建版本标签或 GitHub Release；安装包发布、签名和多平台发布验收会在正式开发完成后处理。

## Repository

[github.com/tnotesjs/desk](https://github.com/tnotesjs/desk)
