# 变更列表按「笔记文件 / 笔记配置 / 其它文件」二级分组

## 目标

变更（Git changes）列表下增加二级折叠分组，按文件路径分为三类：

- 笔记文件：每个笔记目录下的 `README.md`（`notes/<note-dir>/README.md`）。
- 笔记配置：知识库根目录的 `TOC.md` / `sidebar.json` / `.tnotes.json`，以及每个笔记目录下的 `.tnotes.json`。
- 其它文件：不属于以上两类的剩余文件（如 `package.json`、`pnpm-lock.yaml`、笔记目录内的资源文件等）。

## 实现

`src/renderer/src/components/NavigatorSidebar.vue`

- 新增 `changeCategory.ts`，导出 `classifyChangePath(path)` 纯函数，按路径归一化（兼容 Windows 反斜杠）后返回 `noteFile` / `configFile` / `otherFile`。
- 新增 `noteFileChanges` / `configFileChanges` / `otherFileChanges` 三个计算属性，基于 `gitState.changes` 调用分类函数分组。
- 新增 `noteFileExpanded` / `configFileExpanded` / `otherFileExpanded` 三个 `ref`，各自控制二级分组折叠。
- 在「变更」展开区（`changesExpanded`）内，用三个 `.change-group-toggle` 分组头（复用统一的 `.chevron`，展开朝下/收起朝右）包裹各自列表；列表用 `v-show` 包裹以保留状态。
- 分组仅在对应分组有内容时展示（`v-if`）；「笔记文件」项保留 `noteUuid` 存在时的标题/索引展示与点击打开，配置与其它文件仅展示路径、不可打开为笔记。
- 空态提示（busy / error / 非 Git / 工作区干净）逻辑保持不变。
- 变更项的状态标记（如 `M`）移到每行右侧（`.change-item__status`），与分组右侧计数徽标右边缘对齐；左侧只保留文件名/路径（`.change-item__label`，`flex: 1`）。
- 状态标记改用与计数徽标相同的盒模型（`min-width: 18px` + `padding: 1px 5px` + `text-align: center`），使 `M` 与数字在水平方向中心对齐。
- 分级采用阶梯式对齐：一级「变更」文案在 `28px`；二级分组头 `.change-group-toggle` 左内边距 `22px`，使箭头**图形**起点（盒内约有 6px 居中留白）对齐一级文案起点，二级文案在 `45px`；三级变更项 `.change-item` 左内边距 `45px`，使项文案起点对齐所属分组头文案起点。
- 二级分组文案为“笔记文件 / 笔记配置 / 其它文件”（不带“变更/”前缀，含对应的 `aria-label`）。

`src/renderer/src/components/changeCategory.test.ts`

- 为 `classifyChangePath` 覆盖三类边界与 Windows 路径归一化。

## 验证

- `pnpm lint`：通过。
- `pnpm test`：16 个测试文件、86 项全部通过。
- `pnpm typecheck`：通过。
- `pnpm exec prettier --check`：通过。

## 备注

- 分组折叠交互与图标垂直/水平对齐沿用此前统一的 `.chevron` / `.section-toggle` 约定，需运行态人工确认视觉效果与点击热区。
- 分类只依据路径，不再依赖 `GitFileChangeDto.noteUuid`。需要注意：笔记正文若名为 `<标题>.md`（而非 `README.md`），会归入「其它文件」；知识库根目录的 `README.md` 因不在笔记目录下，也会归入「其它文件」。若这些需要单独处理，可在 `classifyChangePath` 中补充规则。
- 阶梯式缩进依赖一级箭头盒 `18px` + 一级文案起点 `28px` 的计算；若后续调整顶层箭头盒宽度或间距，需同步核对二级/三级缩进值。状态标记与数字的水平中心对齐、分级缩进是否与预期一致，需运行态确认。
