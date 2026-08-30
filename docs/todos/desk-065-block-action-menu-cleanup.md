# desk-065：精简块操作菜单

## 对应需求

- `todos/2026.08.29/0012`

## 状态

- 已完成（2026-08-29）

## 模块与改动

- `src/renderer/src/markdown/BlockActionMenu.vue`
  - `BlockAction` 收窄为 `delete | copy | cut | add-below`。
  - 删除“缩进”“复制链接”“全宽显示”三行 UI、禁用说明和分组。
- `src/renderer/src/markdown/MilkdownMarkdownEditor.vue`
  - 删除块全宽状态、切换分支和 `.desk-raw-block--full-width` 样式。
  - 块菜单动作分派只保留四个真实可用操作。
- `scripts/e2e-block-interactions.mjs`
  - 运行态确认三项菜单不存在；复制、剪切、删除撤销和在下方添加继续可用。

## 验证

- `rg` 确认产品代码无 `fullWidth`、`full-width`、缩进和复制链接残留逻辑。
- Electron E2E：`short click opens a viewport-safe menu; removed actions stay absent and canonical copy works` 通过。
