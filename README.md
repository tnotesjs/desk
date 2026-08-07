# TNotes Desk

TNotes 多知识库桌面客户端（Electron + Vue 3 + TypeScript）。

## 功能（首版）

- 手动选择工作区，扫描 `TNotes.*` 知识库
- 三栏：知识库列表 / TOC / 笔记（code 模式，Monaco）
- 左栏 Git 状态（clean / 改动数 / ahead·behind）与单库 Pull、Push
- 配置页：知识库黑名单（黑名单内不进入列表）
- preview 模式：单库 `tn:dev` + iframe 预览当前笔记
- 记住最近一次工作区；支持切换
- 读写 `notes/<笔记目录>/README.md`

## 开发

```bash
pnpm install
pnpm dev
```

启动后选择工作区（例如 `/Users/huyouda/tnotesjs`）即可。

> 若在 Cursor / VS Code 集成终端里直接跑 Electron 异常，`pnpm dev` 已通过 `env -u ELECTRON_RUN_AS_NODE` 规避该问题。

## Repo

https://github.com/tnotesjs/desk
