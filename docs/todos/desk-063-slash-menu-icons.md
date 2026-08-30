# desk-063：斜杠与块菜单图标统一

## 对应需求

- `todos/2026.08.29/0010`

## 状态

- 已完成（2026-08-29）

## 实现

- `src/renderer/src/markdown/slashMenu.ts` 集中维护 TNotes 图标 body，并由 `menuIconFor` 生成统一 `24 x 24`、`currentColor`、圆角线性 SVG。
- 容器、代码块、代码组、轮播、组件、Mermaid 和 Mindmap 各有稳定图形；同一 `kind` 的项目共享图标，避免菜单与块操作入口产生两套资源。
- SVG 使用 `aria-hidden="true"` 和 `focusable="false"`，菜单文字仍由 Crepe 行项目提供可访问名称；不读取网络资源，也不再使用 emoji 图 glyph。

## 验证

- `slashInsert.test.ts` 检查每个项目均有合法 SVG、装饰性无障碍属性、无 emoji，并校验图标 kind 映射覆盖全部菜单项。
- Playwright Electron 菜单截图确认亮色下图标尺寸、基线和 hover 状态稳定；暗色主题沿用 `currentColor`，无需额外资源请求。
