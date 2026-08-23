import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

import { deskLog } from './log'
import { previewManager } from './preview'
import { deleteRecovery, loadRecoveries, writeRecovery } from './recovery'
import { loadWorkspaceSession, saveWorkspaceSession } from './session'
import { loadSettings, saveSettings } from './settings'
import { webContentsManager } from './webContentsManager'
import { workspaceManager } from './workspaceManager'
import { IPC_CHANNELS } from '../shared/contracts'

import type { WorkspaceError } from '@tnotesjs/core/workspace'
import type {
  AppSettings,
  AttachmentWriteLocalRequest,
  AttachmentReadTextRequest,
  DeskError,
  DeskResult,
  NoteCreateRequest,
  NoteRenameRequest,
  NoteSaveRequest,
  NoteUpdateConfigRequest,
  RecoveryDeleteRequest,
  RecoveryWriteRequest,
  TocCreateGroupRequest,
  TocDeleteRequest,
  TocEntryRefDto,
  TocMoveRequest,
  TocRenameGroupRequest,
  WorkspaceSession
} from '../shared/contracts'

const iconSchema = z
  .object({
    src: z.string().optional(),
    svg: z.string().optional()
  })
  .nullable()

const noteTabSchema = z.object({
  id: z.string().min(1),
  type: z.literal('note'),
  knowledgeBaseId: z.string().min(1),
  knowledgeBaseName: z.string(),
  noteUuid: z.string().min(1),
  title: z.string(),
  icon: iconSchema,
  viewMode: z.enum(['visual', 'source'])
})

const webTabSchema = z.object({
  id: z.string().min(1),
  type: z.literal('web'),
  url: z.string().min(1),
  title: z.string()
})

const editorTabSchema = z.discriminatedUnion('type', [noteTabSchema, webTabSchema])

const editorLayoutSchema: z.ZodType<WorkspaceSession['layout']> = z.lazy(() =>
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('group'),
      id: z.string().min(1),
      tabs: z.array(editorTabSchema),
      activeTabId: z.string().nullable()
    }),
    z.object({
      type: z.literal('split'),
      id: z.string().min(1),
      direction: z.enum(['horizontal', 'vertical']),
      ratio: z.number().min(0.15).max(0.85),
      first: editorLayoutSchema,
      second: editorLayoutSchema
    })
  ])
)

const workspaceSessionSchema = z.object({
  version: z.literal(1),
  selectedKnowledgeBaseId: z.string().nullable(),
  layout: editorLayoutSchema,
  activeGroupId: z.string().min(1),
  knowledgeSidebarWidth: z.number().min(48).max(520),
  navigatorSidebarWidth: z.number().min(160).max(700),
  knowledgeSidebarCollapsed: z.boolean(),
  navigatorSidebarCollapsed: z.boolean(),
  expandedTocNodes: z.record(z.string(), z.array(z.string()))
})

const webBoundsSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().positive(),
  height: z.number().positive()
})

const entryRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('note'), noteUuid: z.string().min(1) }),
  z.object({
    type: z.literal('folder'),
    folderPath: z.array(z.string().min(1)).min(1)
  }),
  z.object({
    type: z.literal('line'),
    tocLineIndex: z.number().int().nonnegative()
  })
])

const placementSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('root'),
    placement: z.enum(['start', 'end']).optional()
  }),
  z.object({
    type: z.literal('note'),
    targetNoteUuid: z.string().min(1),
    placement: z.enum(['before', 'after', 'inside'])
  }),
  z.object({
    type: z.literal('folder'),
    folderPath: z.array(z.string().min(1)).min(1),
    placement: z.enum(['before', 'after', 'inside'])
  })
])

const noteSaveSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  content: z.string(),
  expectedRevision: z.string().min(1),
  prettier: z.boolean().optional()
})

const noteCreateSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  title: z.string().min(1),
  placement: placementSchema.optional(),
  expectedSnapshotRevision: z.string().min(1).optional()
})

const noteRenameSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  title: z.string().min(1),
  expectedRevision: z.string().min(1)
})

const noteUpdateConfigSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  expectedRevision: z.string().min(1),
  updates: z
    .object({
      done: z.boolean().optional(),
      description: z.string().optional(),
      enableDiscussions: z.boolean().optional()
    })
    .refine((value) => Object.keys(value).length > 0, '没有可更新字段')
})

const recoveryWriteSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  title: z.string(),
  content: z.string(),
  revision: z.string().min(1)
})

const recoveryDeleteSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1)
})

const attachmentWriteLocalSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  fileName: z.string().min(1).max(240),
  data: z.instanceof(Uint8Array).refine((data) => data.byteLength <= 25 * 1024 * 1024, {
    message: '图片不能超过 25 MB'
  })
})

const attachmentReadTextSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  noteUuid: z.string().min(1),
  path: z.string().min(1).max(1024)
})

const tocMoveSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  source: entryRefSchema,
  target: entryRefSchema,
  placement: z.enum(['before', 'after', 'inside']),
  expectedSnapshotRevision: z.string().min(1)
})

const tocCreateGroupSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  title: z.string().min(1),
  placement: placementSchema.optional(),
  expectedSnapshotRevision: z.string().min(1)
})

const tocRenameGroupSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  folderPath: z.array(z.string().min(1)).min(1),
  title: z.string().min(1),
  expectedSnapshotRevision: z.string().min(1)
})

const tocDeleteSchema = z.object({
  knowledgeBaseId: z.string().min(1),
  entry: entryRefSchema,
  expectedSnapshotRevision: z.string().min(1)
})

function assertSender(event: IpcMainInvokeEvent, getWindow: () => BrowserWindow | null): void {
  const window = getWindow()
  if (!window || event.sender.id !== window.webContents.id) {
    throw new Error('拒绝来自未知页面的 IPC 请求')
  }
}

function toDeskError(error: unknown): DeskError {
  const diagnosticId = randomUUID()
  if (error instanceof z.ZodError) {
    return {
      code: 'INVALID_REQUEST',
      message: '请求参数无效',
      diagnosticId,
      details: { issues: error.issues }
    }
  }

  const workspaceError = error as Partial<WorkspaceError>
  const code = typeof workspaceError?.code === 'string' ? workspaceError.code : 'INTERNAL_ERROR'
  const message = error instanceof Error ? error.message : '发生了无法识别的内部错误'
  deskLog('ipc:error', diagnosticId, { code, message })
  return {
    code,
    message,
    diagnosticId,
    details:
      workspaceError?.details && typeof workspaceError.details === 'object'
        ? workspaceError.details
        : undefined
  }
}

function handle<TInput, TOutput>(
  channel: string,
  getWindow: () => BrowserWindow | null,
  schema: z.ZodType<TInput>,
  operation: (input: TInput) => Promise<TOutput> | TOutput
): void {
  ipcMain.handle(channel, async (event, rawInput): Promise<DeskResult<TOutput>> => {
    try {
      assertSender(event, getWindow)
      const input = schema.parse(rawInput)
      return { ok: true, value: await operation(input) }
    } catch (error) {
      return { ok: false, error: toDeskError(error) }
    }
  })
}

const noInputSchema = z.undefined()

export function registerIpc(getWindow: () => BrowserWindow | null): () => void {
  handle(IPC_CHANNELS.bootstrap, getWindow, noInputSchema, async () => {
    const workspace = workspaceManager.getOverview()
    return {
      workspace,
      settings: loadSettings(),
      session: await loadWorkspaceSession(workspace.path),
      recoveries: await loadRecoveries(workspace.path)
    }
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
  handle(IPC_CHANNELS.knowledgeBaseRead, getWindow, z.string().min(1), (knowledgeBaseId) =>
    workspaceManager.getDetail(knowledgeBaseId)
  )
  handle(IPC_CHANNELS.settingsUpdate, getWindow, z.record(z.string(), z.unknown()), (input) => {
    const settings = saveSettings(input as Partial<AppSettings>)
    return settings
  })

  handle(
    IPC_CHANNELS.noteRead,
    getWindow,
    z.object({
      knowledgeBaseId: z.string().min(1),
      noteUuid: z.string().min(1)
    }),
    ({ knowledgeBaseId, noteUuid }) => workspaceManager.readNote(knowledgeBaseId, noteUuid)
  )
  handle(IPC_CHANNELS.noteSave, getWindow, noteSaveSchema, (input) =>
    workspaceManager.saveNote(input as NoteSaveRequest)
  )
  handle(IPC_CHANNELS.noteCreate, getWindow, noteCreateSchema, (input) =>
    workspaceManager.createNote(input as NoteCreateRequest)
  )
  handle(IPC_CHANNELS.noteRename, getWindow, noteRenameSchema, (input) =>
    workspaceManager.renameNote(input as NoteRenameRequest)
  )
  handle(IPC_CHANNELS.noteUpdateConfig, getWindow, noteUpdateConfigSchema, (input) =>
    workspaceManager.updateNoteConfig(input as NoteUpdateConfigRequest)
  )
  handle(IPC_CHANNELS.attachmentWriteLocal, getWindow, attachmentWriteLocalSchema, (input) =>
    workspaceManager.writeLocalAttachment(input as AttachmentWriteLocalRequest)
  )
  handle(IPC_CHANNELS.attachmentReadText, getWindow, attachmentReadTextSchema, (input) =>
    workspaceManager.readNoteTextAsset(input as AttachmentReadTextRequest)
  )

  handle(IPC_CHANNELS.tocMove, getWindow, tocMoveSchema, (input) =>
    workspaceManager.moveToc(input as TocMoveRequest)
  )
  handle(IPC_CHANNELS.tocCreateGroup, getWindow, tocCreateGroupSchema, (input) =>
    workspaceManager.createTocGroup(input as TocCreateGroupRequest)
  )
  handle(IPC_CHANNELS.tocRenameGroup, getWindow, tocRenameGroupSchema, (input) =>
    workspaceManager.renameTocGroup(input as TocRenameGroupRequest)
  )
  handle(
    IPC_CHANNELS.tocPreviewDelete,
    getWindow,
    z.object({
      knowledgeBaseId: z.string().min(1),
      entry: entryRefSchema
    }),
    ({ knowledgeBaseId, entry }) =>
      workspaceManager.previewDelete(knowledgeBaseId, entry as TocEntryRefDto)
  )
  handle(IPC_CHANNELS.tocDelete, getWindow, tocDeleteSchema, (input) =>
    workspaceManager.deleteToc(input as TocDeleteRequest)
  )

  handle(IPC_CHANNELS.sessionRead, getWindow, noInputSchema, () =>
    loadWorkspaceSession(workspaceManager.getOverview().path)
  )
  handle(IPC_CHANNELS.sessionSave, getWindow, workspaceSessionSchema, (session) =>
    saveWorkspaceSession(workspaceManager.getOverview().path, session)
  )
  handle(IPC_CHANNELS.recoveryWrite, getWindow, recoveryWriteSchema, (request) =>
    writeRecovery(workspaceManager.getOverview().path, request as RecoveryWriteRequest)
  )
  handle(IPC_CHANNELS.recoveryDelete, getWindow, recoveryDeleteSchema, (request) =>
    deleteRecovery(workspaceManager.getOverview().path, request as RecoveryDeleteRequest)
  )

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
    offChanged()
    offExternalChanged()
    offWebState()
    offWebOpenRequested()
    offPreviewChanged()
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}
