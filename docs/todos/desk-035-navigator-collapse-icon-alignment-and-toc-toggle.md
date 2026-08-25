# 第二列导航：变更图标未垂直居中、目录图标位置不对且不可点击折叠

## 现象

第二列（文章 / 目录导航树）里：

- 「变更」分组行的折叠图标没有垂直居中，视觉上偏高或偏低。
- 「目录」分组的图标位置不对，且点击整行不会折叠 / 展开目录列表。

## 根因

- 折叠图标使用文本字形 `⌄` / `›`，这两个字形本身的基线 / 视觉中心不一致，在不同状态（展开 / 收起）下相对行高偏移，难以靠父容器 `align-items: center` 对齐。
- 「目录」行的 `<span>⌄</span>` 是静态图标，且 `.section-heading` 是一个 `<div>`，没有绑定任何点击事件，也没有展开状态，因此整行不可点击切换。

## 修复

`src/renderer/src/components/NavigatorSidebar.vue`

- 用统一的内联 SVG chevron 替换文本字形：`.chevron` 默认朝下（展开），`.collapse` 时 `transform: rotate(-90deg)` 朝右（收起）。
- 让「变更」折叠按钮使用 `inline-flex` + `align-items/justify-content: center`，固定 `18px x 18px`，保证图标在行内垂直居中。
- 把「目录」标题从 `div.section-heading.static` 改为可点击的 `button.section-heading.toc-heading`，绑定 `tocExpanded`，并用 `v-show="tocExpanded"` 包裹目录列表，支持整行点击折叠/展开。
- 为 `button.section-heading` 补 `font-family: inherit; appearance: none; cursor: pointer`，确保按钮呈现与原有标题一致。
- 两处 chevron 统一使用 `18px` 宽槽位（`.chevron { width: 18px; height: 12px }`），避免「变更」路径（12px 图形居在 18px 按钮里）与「目录」（12px 直接贴边）产生 3px 水平错位，保证图标与后续文字均对齐。
- 把「变更」的点击热区从仅限箭头按钮改为整行：新增 `.section-toggle` 按钮包裹箭头 + 「变更」文字 + 上游 behind 徽标，`flex: 1` + `align-self: stretch` 撑满整行，直到数量徽标（`em`）左侧；数量徽标与右侧 Git 操作按钮仍保持独立可点。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、81 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 图标对齐与点击交互属于运行态表现，`happy-dom` 无法计算 SVG 渲染位置，需人工确认：变更/目录图标在水平、垂直方向上相对一致；点击目录整行、点击变更「箭头+文字」区域均可折叠/展开，箭头随状态朝下（展开）/ 朝右（收起）；「变更」的数量徽标与右侧 Git 按钮不被折叠交互吞掉。
- 现在 `变更` 与 `目录` 两个分组使用同一套 chevron 样式与交互约定，后续新增分组可直接复用。
