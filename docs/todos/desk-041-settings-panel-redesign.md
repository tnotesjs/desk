# 设置面板重排

## 目标

设置面板原先分区混杂、行内排版不一（三列网格 / 复选框行 / 卡片开关 / 弹层按钮混杂），显得乱。重新整理为清晰的卡片化布局，保持所有设置绑定与功能不变。

## 实现

`src/renderer/src/components/SettingsPanel.vue`

- 每个分区改为卡片（`.settings-section`：`border + radius + background: var(--panel)` + 统一间距）。
- 分区标题改为上下结构（`.section-heading`：标题 + 副标题，`flex-direction: column`，左对齐）。
- 统一字段网格：`.field-grid.cols-3`（外观与编辑、标签与导航、外部工具）与 `.field-grid.cols-2`（GitHub 配置）。
- 统一字段：`.field`（标签在上、控件在下），输入 / 下拉框统一高度与圆角。
- 行内项统一为 `.settings-row` + `.switch-field`（复选框 + 文字），自动保存「延迟」用 `.input-with-unit`（输入框 + 单位）。
- 卡片开关改为 `.card-toggle`（标签自动换行 / 跟随活动标签）。
- 快捷键入口改为 `.entry-row`（文字 + `⌘K` 提示）。
- 外部工具里的「空闲自动推送」与图片区的「GitHub 图床配置」分别收进 `.sub-block` / `.knowledge-git-setting` 子块，带 `.sub-heading` 小标题。
- 图片区上传目标 `.target-choice` 与 Token 操作 `.token-actions`、验证按钮 `.btn-ghost` 统一样式。
- 面板宽度收窄为 `720px`，悬浮层有投影，输入聚焦有 accent 光晕。

说明：新增了一个追加的 `<style scoped>` 块来定义新布局（Vue 允许多 style 块），旧样式块保留作为基础（背景 / 边框 / 快捷键弹层等）并提供兜底，未删除历史类名以避免回归。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 所有设置项绑定（`draft.*`、`autoPush*`、`token`、`clearToken` 等）均已保留，功能不变。
- 属于视觉重排，需运行态人工确认各分区排版、亮/暗主题下卡片与输入框对比度、以及快捷清单弹层样式是否正常。
