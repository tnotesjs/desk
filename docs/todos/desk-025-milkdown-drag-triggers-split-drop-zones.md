# Milkdown 内部拖拽触发了编辑器拆分放置区

## 现象

在 Milkdown / Crepe 可视化编辑器的正文中拖动行 / 块（Milkdown 内置的块排序拖拽）时，Desk 的「拆分编辑区域」拖放布局浮层（上方 / 下方 / 左侧 / 右侧）被触发，导致拖动行为异常。

## 根因

`src/renderer/src/editor-groups/EditorGroup.vue` 的标签拖拽拆分功能在 `.editor-group` 容器上监听了会冒泡的拖拽事件：

```html
@dragenter.prevent="dragOver = true" @dragover.prevent @drop="dropInGroup"
```

这些事件从编辑器内容（Milkdown 正文）一路冒泡到外层 `.editor-group`，于是无论拖的是标签还是编辑器内部的文本 / 块，都会把 `dragOver` 置为 `true`，进而渲染 `split-drop-zones` 浮层并拦截指针，破坏 Milkdown 自身的拖放。

## 修复

`src/renderer/src/editor-groups/EditorGroup.vue`

- 新增 `isTabDrag(event)`：通过 `event.dataTransfer.types` 是否包含 `text/x-tnotes-desk-tab` 判断本次拖拽是否为「标签拖拽」（`getData` 在 `dragenter`/`dragover` 阶段不可用，故用 `types` 判断）。
- `handleGroupDragEnter`：仅在拖标签时才置 `dragOver = true`。
- `handleGroupDragOver`：仅在拖标签时才 `preventDefault()`。
- `dropInGroup`：非标签拖拽直接返回，不处理。
- `dropSplit`：增加 `isTabDrag` 守卫，避免非标签拖拽被放置区吞掉。

效果：编辑器内部的 Milkdown 拖拽不再激活拆分浮层；标签拖拽拆分功能保持不变。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、78 项全部通过。

## 备注

- 无针对 EditorGroup 的既有测试；如需持久防回归，可为 `isTabDrag` / 拖放守卫补充组件级测试。
