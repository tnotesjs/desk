# TNotes Desk

TNotes 的本地优先桌面客户端，使用 Electron、Vue 3、TypeScript 和 CodeMirror 6 构建。

## 首版能力

- 选择一个父目录并扫描其直接子目录中的 `TNotes.*` 知识库；配置异常的知识库仍会显示诊断信息
- 三栏导航：知识库、当前知识库的目录与 Git 变更、可拆分的编辑区域
- 笔记标签支持可视化编辑和 Markdown 源码编辑；标题、目录和笔记编号规则复用 `@tnotesjs/core`
- 支持 GFM、任务列表、表格、代码高亮、KaTeX、Mermaid、思维导图，以及 TNotes 的特殊组件语法
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

当前开发阶段的 `@tnotesjs/core` 通过 `link:../core` 引用同级目录。Core 发布后会在 Desk 发布前锁定为对应的正式版本。

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

GitHub Actions 会在提交和 Pull Request 上执行静态检查、测试与构建；推送 `v*` 标签时会分别构建 macOS、Windows、Linux 安装包并生成 GitHub Release。

## Repository

[github.com/tnotesjs/desk](https://github.com/tnotesjs/desk)
