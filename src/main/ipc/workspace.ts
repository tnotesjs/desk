import { dialog, shell } from 'electron'
import { z } from 'zod'

import { previewManager } from '../preview'
import { loadRecoveries } from '../recovery'
import { loadWorkspaceSession, saveWorkspaceSession } from '../session'
import { loadSettings } from '../settings'
import { searchManager } from '../searchManager'
import { webContentsManager } from '../webContentsManager'
import { workspaceManager } from '../workspaceManager'
import { IPC_CHANNELS } from '../../shared/contracts'
import { workspaceSessionSchema } from './schemas'
import { handle, noInputSchema, type GetWindow } from './shared'

export function registerWorkspace(getWindow: GetWindow): () => void {
  handle(IPC_CHANNELS.bootstrap, getWindow, noInputSchema, async () => {
    const workspace = workspaceManager.getOverview()
    return {
      workspace,
      settings: loadSettings(),
      platform:
        process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux',
      session: await loadWorkspaceSession(workspace.path),
      recoveries: await loadRecoveries(workspace.path)
    }
  })
  handle(IPC_CHANNELS.windowClose, getWindow, noInputSchema, () => {
    const window = getWindow()
    if (!window || window.isDestroyed()) return
    setImmediate(() => {
      if (!window.isDestroyed()) window.close()
    })
  })

  handle(IPC_CHANNELS.workspaceChoose, getWindow, noInputSchema, async () => {
    const parent = getWindow()
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory', 'createDirectory']
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return workspaceManager.getOverview()
    }
    await previewManager.stopAll()
    webContentsManager.closeAll()
    const overview = await workspaceManager.setWorkspace(result.filePaths[0])
    return overview
  })

  handle(
    IPC_CHANNELS.workspaceSet,
    getWindow,
    z.string().min(1).nullable(),
    async (workspacePath) => {
      await previewManager.stopAll()
      webContentsManager.closeAll()
      return workspaceManager.setWorkspace(workspacePath)
    }
  )
  handle(IPC_CHANNELS.workspaceRefresh, getWindow, noInputSchema, () => workspaceManager.refresh())
  handle(
    IPC_CHANNELS.workspaceRevealKnowledgeBase,
    getWindow,
    z.string().min(1),
    async (knowledgeBaseId) => {
      const error = await shell.openPath(workspaceManager.getLocation(knowledgeBaseId).rootPath)
      if (error) throw new Error(error)
    }
  )
  handle(IPC_CHANNELS.knowledgeBaseRead, getWindow, z.string().min(1), (knowledgeBaseId) =>
    workspaceManager.getDetail(knowledgeBaseId)
  )
  handle(
    IPC_CHANNELS.searchQuery,
    getWindow,
    z.object({
      query: z.string().max(500),
      knowledgeBaseId: z.string().min(1).nullable(),
      limit: z.number().int().min(1).max(100).optional()
    }),
    (request) => searchManager.search(request)
  )
  handle(IPC_CHANNELS.sessionRead, getWindow, noInputSchema, () =>
    loadWorkspaceSession(workspaceManager.getOverview().path)
  )
  handle(IPC_CHANNELS.sessionSave, getWindow, workspaceSessionSchema, (session) =>
    saveWorkspaceSession(workspaceManager.getOverview().path, session)
  )

  const offChanged = workspaceManager.onChanged((overview) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.workspaceChanged, overview)
    }
  })
  const offExternalChanged = workspaceManager.onNoteExternalChanged((event) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.noteExternalChanged, event)
    }
  })

  return () => {
    offChanged()
    offExternalChanged()
  }
}
