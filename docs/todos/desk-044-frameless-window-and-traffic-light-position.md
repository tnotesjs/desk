# 无边框窗口 + macOS 交通灯下移

## 目标

把桌面窗口改为无边框（隐藏原生标题栏），并让 macOS 交通灯下移到与自定义 42px 标题栏垂直居中，避免原生交通灯与自定义标题栏并存、内容挤压。

## 实现

- `src/main/index.ts`：BrowserWindow 增加 macOS 专用配置
  - `titleBarStyle: 'hidden'`：隐藏原生标题栏，内容全幅到顶。
  - `trafficLightPosition: { x: 12, y: 15 }`：把交通灯下移，对齐自定义标题栏垂直中心。
  - 非 macOS 保持现有边框（应用暂无 Windows/Linux 自定义窗口控制按钮，避免 `frame: false` 导致无法关闭/最小化）。
- `src/renderer/src/App.vue`：自定义 `.titlebar`（42px，`-webkit-app-region: drag`）与 `.traffic-space`（左侧 58px 预留交通灯区域）此前已就绪，无需改动。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 属运行态窗口行为，需在 macOS 上人工确认：窗口无原生边框、交通灯位于标题栏左侧并垂直居中、标题栏可拖动、右上角设置/其它按钮可点击。
- 若交通灯垂直位置仍偏 1~2px，可微调 `trafficLightPosition.y`。
- Windows / Linux 若也要无边框，需要先补充自定义窗口控制按钮（最小化/最大化/关闭），再改为 `frame: false`。
