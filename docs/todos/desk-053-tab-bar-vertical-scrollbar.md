# 修复 tab 容器出现纵向滚动条

## 现象

切换标签换行（wrap）模式后，tab 容器出现纵向滚动条；tab 容器本应像 VSCode 一样只靠换行增高，永远不出现纵向滚动条。

## 根因

`EditorGroup.vue` 的 `.tabs-bar` 设置了 `max-height: 140px; overflow-y: auto`；wrap 模式下标签换行超过 140px 便出现纵向滚动条。

## 修复

- `src/renderer/src/editor-groups/EditorGroup.vue`
  - `.tabs-bar` 移除 `max-height`，`overflow-y` 固定为 `hidden`。
  - 移除冗余的 `.tabs-bar:not(.wrap) { overflow-y: hidden }` 规则。
  - 标签 wrap 时整个 tab 条自然增高，编辑器内容区相应缩小；不再出现纵向滚动条。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、87 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 非 wrap 模式仍保留横向滚动（`.tabs-bar:not(.wrap) .regular-row`），不涉及纵向。
