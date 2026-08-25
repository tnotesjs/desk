import { BrowserWindow } from 'electron'

/**
 * A closed stdout/stderr must never take down the main process. This commonly
 * happens when the process was launched from a terminal or parent that has since
 * exited, or when the app runs without a console at all.
 */
function isClosedStreamError(cause: unknown): boolean {
  return (
    cause instanceof Error &&
    ('code' in cause
      ? cause.code === 'EPIPE' ||
        cause.code === 'ERR_STREAM_DESTROYED' ||
        cause.code === 'ERR_STREAM_WRITE_AFTER_END'
      : /EPIPE|ERR_STREAM_DESTROYED|ERR_STREAM_WRITE_AFTER_END/.test(cause.message))
  )
}

function writeConsoleLine(line: string): void {
  for (const stream of [process.stdout, process.stderr]) {
    if (stream.destroyed) continue
    try {
      stream.write(`${line}\n`)
    } catch (cause) {
      // A stream may fail between the destroyed check and the write (e.g. the
      // reader closed concurrently). Ignore closed-stream errors only.
      if (!isClosedStreamError(cause)) throw cause
    }
  }
}

function guardConsoleStream(stream: NodeJS.WriteStream): void {
  stream.on('error', (cause) => {
    // A closed stdout/stderr emits an async 'error' that would otherwise crash
    // the main process. Non-closed errors are still surfaced so real faults are
    // not silently hidden.
    if (!isClosedStreamError(cause)) console.error(`[desk] ${String(cause)}`)
  })
}

/** Main + DevTools console bridge for debugging. */
export function deskLog(scope: string, message: string, detail?: unknown): void {
  const line =
    detail === undefined
      ? `[${scope}] ${message}`
      : `[${scope}] ${message} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`

  writeConsoleLine(line)

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('desk:log', line)
    } catch {
      // window may be closing
    }
  }
}

guardConsoleStream(process.stdout)
guardConsoleStream(process.stderr)
