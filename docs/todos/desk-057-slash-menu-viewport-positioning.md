# desk-057：斜杠菜单视口避让与稳定定位

## 对应需求

- `todos/2026.08.29/0004`
- BUG1：触发行靠近编辑区顶部或底部时，长菜单溢出可视区域。

## 状态

- 已完成（2026-08-29）

## 根因

Crepe 的 SlashProvider 默认只使用 Floating UI 的 `flip + offset`。当菜单本身高于触发行任一侧的剩余空间时，`flip` 只能换边，不能限制菜单高度，也不会把最终坐标约束到 Desk 编辑器的可见区域。

## 模块与改动

- `src/renderer/src/markdown/slashMenu.ts`
  - 新增统一的菜单展示控制器，普通 `/`、侧边 `+` 以及后续“在下方添加”均复用同一策略。
  - 纵向边界取编辑器宿主可见矩形与浏览器 viewport 的交集；横向允许窄编辑区借用应用窗口空间，但不越出窗口。四周保留 8px 安全距离。
  - 高度不足时仅缩小 `.menu-groups` 并让内容内部滚动，tab/header 始终保留。
  - 对 Crepe 完成定位后的实际 DOM 做二次测量并校正坐标；保存 provider 原始坐标，窗口放大或滚动后可恢复，不累计偏移。
  - 监听菜单显示、内容变化、编辑区滚动和窗口缩放。
- `MilkdownMarkdownEditor.vue`
  - 安装/卸载统一展示控制器。

## 验证记录

- `slashInsert.test.ts` 增加纯几何断言，覆盖菜单过高、顶部/底部和横向越界的校正量。
- `scripts/e2e-block-interactions.mjs` 使用隔离临时知识库和 Electron 运行态验证：
  - 靠近编辑器顶部打开 `/`，菜单四边均在应用可见边界内。
  - 靠近编辑器底部打开 `/`，菜单自动换向/校正且不越出底边。
  - 窗口缩至 820×430 后，菜单正文高度小于 420px、内部滚动，菜单整体仍小于编辑区可见高度。
- 截图：`scripts/shots/block-interactions/01-menu-top.png`、`02-menu-bottom.png`、`03-menu-small-window.png`。

```bash
pnpm exec vitest run src/renderer/src/editor/markdown/slashInsert.test.ts
pnpm build
node scripts/e2e-block-interactions.mjs
```
