# 优化「新增笔记」弹窗 + 新增笔记位置配置 + select 箭头样式

## 目标

1. 新增笔记弹窗标题只保留「新增笔记」。
2. 输入框去掉「标题」标签，占位文案改为「请输入笔记标题」。
3. 移除「取消」按钮。
4. 在「创建」按钮左侧加一个下拉（顶部新增 / 末尾追加），默认读取配置。
5. 设置面板「常规」分组新增「新增笔记位置」配置，默认「顶部新增」。
6. 优化下拉（select）组件样式：箭头不再偏移/与边框重叠。

## 实现

- `src/shared/contracts.ts`：`AppSettings` 增加 `createNotePosition: 'top' | 'end'`。
- `src/main/settings.ts`：`settingsSchema` 增加 `createNotePosition`，默认 `'top'`。
- `src/renderer/src/App.vue`
  - 新增 `createRootPosition`，打开根节点新增时读 `store.settings.createNotePosition` 作为默认；根节点 placement 映射 `top → start`、`end → end`。
  - 弹窗标题改为「新增笔记」；输入框去掉「标题」标签与占位文案改为「请输入笔记标题」；删除「取消」按钮。
  - 弹窗 footer 左侧（根节点场景）加 `select`（顶部新增 / 末尾追加）。
  - 清理不再使用的 `createLocationLabel`。
  - 新增 `.dialog select` 样式（`appearance:none` + 自定义 SVG 箭头，`padding-right` 预留箭头空间）。
- `src/renderer/src/components/SettingsPanel.vue`
  - 「常规」分组新增「新增笔记位置」select（绑定 `draft.createNotePosition`）。
  - `groupDefaults.general` 增加 `createNotePosition: 'top'`。
  - `.settings-panel select` 用 `appearance:none` + 自定义 SVG 箭头，`padding-right` 预留，避免与边框重叠。
- 测试 mock 补齐 `createNotePosition`。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 仅根节点（从导航头「+」创建）显示「顶部新增 / 末尾追加」下拉；从 TOC 右键在分组/笔记下新建时沿用其 before/after/inside 位置，不显示该下拉。
- 下拉箭头为 `background-image` 内联 SVG，颜色用中性灰兼顾亮/暗主题。
