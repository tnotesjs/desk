import { shell } from 'electron'

import { RELEASES_PAGE, updateManager } from '../updateManager'
import { IPC_CHANNELS } from '../../shared/contracts'
import { handle, noInputSchema, type GetWindow } from './shared'

export function registerUpdate(getWindow: GetWindow): () => void {
  handle(IPC_CHANNELS.updateStatus, getWindow, noInputSchema, () => updateManager.getStatus())
  handle(IPC_CHANNELS.updateCheck, getWindow, noInputSchema, () => updateManager.check())
  handle(IPC_CHANNELS.updateOpenRelease, getWindow, noInputSchema, async () => {
    await shell.openExternal(updateManager.getStatus().releaseUrl ?? RELEASES_PAGE)
  })

  const offChanged = updateManager.onChanged((status) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.updateChanged, status)
    }
  })

  return () => {
    offChanged()
  }
}
