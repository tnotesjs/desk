import { z } from 'zod'

import { previewManager } from '../preview'
import { webContentsManager } from '../webContentsManager'
import { workspaceManager } from '../workspaceManager'
import { IPC_CHANNELS } from '../../shared/contracts'
import { webBoundsSchema } from './schemas'
import { handle, noInputSchema, type GetWindow } from './shared'

export function registerWeb(getWindow: GetWindow): () => void {
  handle(
    IPC_CHANNELS.webCreate,
    getWindow,
    z.object({ tabId: z.string().min(1), url: z.string().min(1) }),
    ({ tabId, url }) => webContentsManager.create(tabId, url)
  )
  handle(
    IPC_CHANNELS.webLayout,
    getWindow,
    z.object({
      tabId: z.string().min(1),
      visible: z.boolean(),
      bounds: webBoundsSchema.optional()
    }),
    ({ tabId, visible, bounds }) => webContentsManager.layout(tabId, visible, bounds)
  )
  handle(IPC_CHANNELS.webHideAll, getWindow, noInputSchema, () => webContentsManager.hideAll())
  handle(IPC_CHANNELS.webClose, getWindow, z.string().min(1), (tabId) =>
    webContentsManager.close(tabId)
  )
  handle(
    IPC_CHANNELS.webNavigate,
    getWindow,
    z.object({ tabId: z.string().min(1), url: z.string().min(1) }),
    ({ tabId, url }) => webContentsManager.navigate(tabId, url)
  )
  handle(IPC_CHANNELS.webGoBack, getWindow, z.string().min(1), (tabId) =>
    webContentsManager.goBack(tabId)
  )
  handle(IPC_CHANNELS.webGoForward, getWindow, z.string().min(1), (tabId) =>
    webContentsManager.goForward(tabId)
  )
  handle(IPC_CHANNELS.webReload, getWindow, z.string().min(1), (tabId) =>
    webContentsManager.reload(tabId)
  )
  handle(IPC_CHANNELS.webStop, getWindow, z.string().min(1), (tabId) =>
    webContentsManager.stop(tabId)
  )
  handle(IPC_CHANNELS.webOpenExternal, getWindow, z.string().min(1), (url) =>
    webContentsManager.openExternal(url)
  )
  handle(IPC_CHANNELS.webClearBrowsingData, getWindow, noInputSchema, () =>
    webContentsManager.clearBrowsingData()
  )
  handle(
    IPC_CHANNELS.previewStart,
    getWindow,
    z.object({
      knowledgeBaseId: z.string().min(1),
      noteDirName: z.string().min(1).optional()
    }),
    ({ knowledgeBaseId, noteDirName }) => {
      const location = workspaceManager.getLocation(knowledgeBaseId)
      return previewManager.start(knowledgeBaseId, location.name, location.rootPath, noteDirName)
    }
  )
  handle(IPC_CHANNELS.previewStop, getWindow, z.string().min(1), (knowledgeBaseId) =>
    previewManager.stop(knowledgeBaseId)
  )
  handle(IPC_CHANNELS.previewList, getWindow, noInputSchema, () => previewManager.list())

  const offWebState = webContentsManager.onStateChanged((state) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.webStateChanged, state)
    }
  })
  const offWebOpenRequested = webContentsManager.onOpenRequested((event) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.webOpenRequested, event)
    }
  })
  const offPreviewChanged = previewManager.onChanged((state) => {
    const window = getWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send(IPC_CHANNELS.previewChanged, state)
    }
  })

  return () => {
    offWebState()
    offWebOpenRequested()
    offPreviewChanged()
  }
}
