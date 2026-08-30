# desk-077：raw-break 空行插入点与键盘连续范围

## 对应需求

- `todos/2026.08.29/0022`
- `0021` / `desk-075` 的键盘交互补全。

## 状态

- 处理中（2026-08-30）

## 现场证据

- 普通空段落显示 Crepe 的“输入 / 插入内容”占位，standalone `<br />` 的 raw-break NodeSelection 只有独立 selection widget，缺少输入语义。
- Computer Use 在用户当前 Desk 窗口实测：从下方空段落第一次 `Shift+↑` 后可访问选区含两个对象占位；第二次 `Shift+↑` 选区消失，无法继续扩展。
- `rawBlockInteractions.ts` 当前 Shift 分支只接受空 `TextSelection`，随后直接切换为 `NodeSelection`；该模型没有保留最初的 anchor/head，因此下一次 Shift 不能判断扩展或收缩方向。

## 设计方向

- 用一个带 anchor/head 的显式 raw-break 键盘范围状态持续记录选择边界，视觉仍由 DecorationSet 唯一派生。
- raw-break 单行插入点改为节点 Decoration 类直接在该行内绘制 caret 与占位，不再把 selection widget 插到节点前方。
- Desk 插件层先完成行为；只有确认 ProseMirror 事务或 Crepe block-handle 无法承载时才 fork Milkdown，避免无必要地维护上游分叉。
