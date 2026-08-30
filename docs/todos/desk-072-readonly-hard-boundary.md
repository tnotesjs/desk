# desk-072：只读视图硬只读

## 对应需求

- `todos/2026.08.29/0019`

## 状态

- 已完成（2026-08-29）

## 根因与风险面

- Crepe `setReadonly` 通过 `editable: () => false` 阻止浏览器原生编辑，但不会自动清除 NodeSelection、自定义 boundary 光标或外部 NodeView UI。
- ProseMirror 的只读 DOM 仍允许插件和自定义控件直接 `dispatch` 文档事务，因此只靠 `contenteditable=false` 不是完整的不可修改保证。

## 模块与改动

- `src/renderer/src/markdown/readonlyGuard.ts`
  - 新增事务级只读防线：只读时拒绝全部 `docChanged` 事务，仅放行明确作用域内的外部内容同步。
- `MilkdownMarkdownEditor.vue`
  - 进入只读时清理 raw selection、关闭菜单、失焦，并通知内联块源码编辑器关闭且放弃未提交预览。
  - 隐藏虚拟/gap/boundary/drop 光标、Milkdown 编辑浮层、块操作入口与内联源码编辑器。
  - 图片上传入口和所有公开命令继续执行显式只读检查。
- `rawBlockInteractions.ts`
  - 只读 EditorView 不再响应 raw boundary 指针或键盘删除/导航处理。

## 验证结果

- 单元测试覆盖事务级拒绝、选择事务放行、外部同步放行、公开命令拦截、raw-break 边界删除拦截，以及切入只读时关闭内联 CodeMirror。
- Electron 运行态确认 `contenteditable=false`、编辑器失焦、原生/虚拟/gap/boundary/drop 可见光标数量为零。
- 只读状态依次尝试 `Delete`、`Backspace`、文本输入和直接触发隐藏的编辑按钮；DOM 仍有三条 `<br />`，切回源码视图后原文与组件源码均不变。
