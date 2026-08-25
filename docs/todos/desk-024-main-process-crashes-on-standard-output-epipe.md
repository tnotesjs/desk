# 主进程因标准输出 EPIPE 崩溃

## 现象

Electron 主进程抛出 `Uncaught Exception: Error: write EPIPE`，弹出「A JavaScript error occurred in the main process」对话框。

## 根因

`src/main/log.ts` 的 `deskLog` 会向 `process.stdout` 写日志（`console.log(line)`）。当托管 stdout 的父进程 / 终端已退出、或应用在无控制台环境运行且输出管道被关闭时，写入会触发 `EPIPE`。该异常未被捕获，冒泡到顶层导致主进程崩溃。

堆栈：

```
write EPIPE
  at afterWriteDispatched (node:internal/stream_base_commons...)
  at Socket._writeGeneric ...
  at Writable.write ...
  at console.value ...
  at console.log ...
  at deskLog (.../out/main/index.js:19:11)
```

## 修复

`src/main/log.ts`

- 新增 `isClosedStreamError`：识别 `EPIPE`、`ERR_STREAM_DESTROYED`、`ERR_STREAM_WRITE_AFTER_END` 等「流已关闭」类错误。
- `writeConsoleLine`：向 stdout / stderr 写入前先检查 `destroyed`，写入失败时仅对「流已关闭」类错误静默吞掉，其余错误仍抛出。
- `guardConsoleStream`：为 stdout / stderr 各挂一个 `error` 监听，把异步派发的「流已关闭」错误吞掉，避免未被捕获；非流关闭错误仍打 `console.error` 以便定位真实故障。
- 移除对 `console.log` 的直接调用，统一走 `writeConsoleLine`。

## 验证

- `pnpm typecheck`：通过。
- `pnpm lint`：通过。
- `pnpm test`：15 个测试文件、78 项全部通过。
- 开发模式热更新后控制台无报错。

## 备注

- 该崩溃多为环境性偶发（父进程/终端退出导致 stdout 断开），重启通常可复现的会消失；本修复从源头避免此类崩溃再次发生。
