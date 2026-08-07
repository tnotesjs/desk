import { BrowserWindow } from 'electron'

/** Main + DevTools console bridge for debugging. */
export function deskLog(scope: string, message: string, detail?: unknown): void {
  const line =
    detail === undefined
      ? `[${scope}] ${message}`
      : `[${scope}] ${message} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`

  console.log(line)

  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('desk:log', line)
    } catch {
      // window may be closing
    }
  }
}
