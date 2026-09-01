import { ipcMain, type BrowserWindow } from 'electron'

import { IPC_CHANNELS } from '../shared/contracts'
import { registerGit } from './ipc/git'
import { registerNotes } from './ipc/notes'
import { registerRecovery } from './ipc/recovery'
import { registerSettings } from './ipc/settings'
import { registerUpdate } from './ipc/update'
import { registerWeb } from './ipc/web'
import { registerWorkspace } from './ipc/workspace'

export function registerIpc(getWindow: () => BrowserWindow | null): () => void {
  const offWorkspace = registerWorkspace(getWindow)
  registerSettings(getWindow)
  const offGit = registerGit(getWindow)
  registerNotes(getWindow)
  registerRecovery(getWindow)
  const offWeb = registerWeb(getWindow)
  const offUpdate = registerUpdate(getWindow)

  return () => {
    offWorkspace()
    offWeb()
    offGit()
    offUpdate()
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}
