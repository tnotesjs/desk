# 变更列表：非笔记文件也支持 IDE 打开 / 文件管理器显示

## 目标

「变更」二级分组中，除「笔记文件」外的「笔记配置」「其它文件」项也需支持右键菜单：在 IDE 中打开、在文件管理器中显示。此前只有笔记文件有右键菜单（基于 `noteUuid`）。

## 实现

- `src/shared/contracts.ts`
  - 新增 `IPC_CHANNELS.ideShowFileMenu = 'ide:show-file-menu'`。
  - `ide` API 新增 `showFileMenu(knowledgeBaseId, path): Promise<DeskResult<void>>`。
- `src/preload/index.ts`
  - 新增 `showFileMenu`，转发 `{ knowledgeBaseId, path }`。
- `src/main/ipc.ts`
  - 新增 `ideShowFileMenu` handler：取知识库根路径 `workspaceManager.getLocation(knowledgeBaseId).rootPath`，用 `path.resolve` 结合相对路径得出绝对路径，并校验其位于知识库内（防越界），随后调用 `showIdeContextMenu(window, targetPath)` 复用「在 IDE 打开 / 在文件管理器显示」菜单。
- `src/renderer/src/components/NavigatorSidebar.vue`
  - 新增 `showFilePathMenu(path)`，调用 `window.desk.ide.showFileMenu`。
  - 「笔记配置」「其它文件」条目去掉 `:disabled="true"`（禁用按钮在 Chromium 不触发 contextmenu），加 `@contextmenu.prevent="showFilePathMenu(change.path)"`；左键维持不打开笔记。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、86 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 右键菜单弹出与 IDE / 文件管理器操作属于运行态表现，需在界面人工确认：配置/其它文件右键出现「在 VSCode / Cursor 中打开」「在文件管理器中显示」，且能对目标文件生效。
- 对已删除（status = deleted）的变更文件，绝对路径解析不会因文件不存在而报错，但打开/显示操作可能无实际效果；如需对删除文件做特殊处理可再补充。
