# 提示消息改为右上角 toast，不再挤压内容

## 目标

应用内所有“占用页面空间”的提示消息改为右上角弹出 toast（非阻塞浮层），避免内容突然被挤压。

## 实现

- `src/renderer/src/stores/toast.ts`
  - 全局 toast 状态：`pushToast(message, kind)`（`kind: info | success | error`）、`dismissToast`、`useToasts`；默认 3.6s 自动消失。
- `src/renderer/src/components/ToastHost.vue`
  - 右上角固定浮层，`z-index: 2000`，堆叠展示，支持关闭按钮；按 `info / success / error` 显示不同边框/背景，配合 `TransitionGroup` 淡入淡出。
- `src/renderer/src/App.vue`
  - 渲染 `<ToastHost />`。
  - 移除顶部 `.global-banner`（status/error 横幅）。
  - `watch(store.status)` 追加 push success toast（保留原 3.6s 自动清除）。
  - 新增 `watch(store.error)`：push error toast 后清空 `store.error`。
- `src/renderer/src/components/SettingsPanel.vue`
  - 移除 `validationMessage/validationError/configMessage/configError` 内联 `<p class="validation">`。
  - `validateGitHub`、配置读写/导出/导入/恢复默认、token 状态读取等改为 `pushToast(..., 'success' | 'error')`。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- toast 为 `position: fixed`，不参与文档流，不会推挤设置面板或主界面内容。
- 设置面板是弹窗，toast 固定于应用右上角，z-index 高于弹窗，点击关闭按钮可手动关闭，否则自动消失。
