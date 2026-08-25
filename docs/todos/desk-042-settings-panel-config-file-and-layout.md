# 设置面板改为左右布局 + 配置文件（.tn-desk-config.json）

## 目标

把设置面板从「整页滚动分区」改为类似 VSCode 的体验：左侧分组列表（配图标），右侧渲染选中分组；支持全屏 / 非全屏；支持直接编辑配置文件（JSON）、导出/导入、非法值自动回退默认配置。

## 配置文件名

定名 `.tn-desk-config.json`，保存在 Electron `userData` 目录。迁移逻辑：优先读 `.tn-desk-config.json`，不存在则读旧 `settings.v1.json` 并迁移写入新文件，最后兜底旧 `settings.json` 的黑名单。

## 持久化（主进程）

- `src/main/settings.ts`
  - 配置文件路径改为 `.tn-desk-config.json`，保留旧文件迁移。
  - 新增 `resetSettings()`（写回默认配置）、`readSettingsFile()`（返回当前配置 JSON 文本）、`importSettings(content)`（读入并校验）、`writeSettingsRaw(json)`（解析 + 校验后写盘，非法抛错）。
- `src/main/ipc.ts`
  - 新增 `settings.export`（save dialog 导出）、`settings.import`（open dialog 读入并应用）、`settings.reset`、`settings.readRaw`、`settings.writeRaw`。
- `src/shared/contracts.ts` / `src/preload/index.ts`
  - 新增对应 channels 与 `settings.*` API。
- `src/renderer/src/stores/workspace.ts`
  - 新增 `applySettings`：raw 配置写盘后同步状态与编辑器配置（不重复落盘）。

## 设置面板 UI

`src/renderer/src/components/SettingsPanel.vue`

- 左侧 `.settings-nav`：常规 / 标签与导航 / 外部工具 / 图片与图床 / 配置文件 / 快捷键，各配内联 SVG 图标。
- 右侧 `.settings-content`：按 `activeGroup` 用 `v-if` / `v-else-if` 渲染对应分组（复用原表单字段）。
- 标题栏新增全屏按钮：`.settings-panel.fullscreen` 铺满窗口；非全屏为居中弹窗。
- 「配置文件」分组：`.config-editor` JSON 编辑区 + 「保存并校验」「导出配置」「导入配置」「恢复默认」。`保存并校验` 对非法值自动调用 `reset` 回退默认配置并提示。
- 「快捷键」改为内联分组列表，移除旧快捷键弹层。
- 「配置文件」分组的 4 个操作按钮改为右上角 `⋮` 下拉菜单（`<details>` 实现），项内点击后自动收起。
- 「配置文件」编辑器默认撑满设置面板剩余高度：`.config-section` 改为 flex 列布局并 `height: 100%`，`.config-editor` 用 `flex: 1; min-height: 0` 填充，并去掉 `resize`（不再允许拖拽）。

### 后续细节调整

- 修复「全屏」按钮无反应：面板补 `:class="{ fullscreen }"`，点击后 `.settings-panel.fullscreen` 生效。
- 非全屏下面板高度固定为 `min(720px, calc(100% - 44px))`，不再随内容突变。
- 每个配置分组（常规/标签与导航/外部工具/图片与图床）右上角加「重置」按钮，`resetGroup(id)` 将该分组字段恢复到默认值。
- 精简标题栏为单行：左侧小字「TNotes Desk 设置」，右侧「全屏 + 关闭」按钮；移除原「Desk 设置 / 编辑与集成」两行标题。
- 移除底部「取消 / 保存设置」按钮与底部 Token 说明；改为配置修改后自动生效：
  - `watch(draft, deep)` 防抖 400ms 调用 `applyDraft` → `store.updateSettings`。
  - Token 通过 `@change="applyToken"` 在字段失焦 / 勾选时应用。
- Token 说明保留在该字段下方（`tokenHint`），不再放到底部。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check .`：通过。

## 备注

- 配置文件写盘前会经 zod schema 归一化（缺省字段补默认值）；顶层解析失败时通过「保存并校验」自动回退默认配置。
- 导入失败不会覆盖当前配置（仅提示错误）；导出、导入走系统文件对话框。
- 左右布局、全屏、配置编辑器、图标与颜色、自动生效与分组重置均属运行态表现，需在界面人工确认。
