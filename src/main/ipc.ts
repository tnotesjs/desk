import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'

import { deskLog } from './log'
import { loadSettings, saveSettings } from './settings'
import { workspaceManager } from './workspaceManager'
import { IPC_CHANNELS } from '../shared/contracts'

import type { WorkspaceError } from '@tnotesjs/core/workspace'
import type {
  AppSettings,
  DeskError,
  DeskResult,
  NoteCreateRequest,
  NoteRenameRequest,
  NoteSaveRequest,
  NoteUpdateConfigRequest,
  TocCreateGroupRequest,
  TocDeleteRequest,
  TocEntryRefDto,
  TocMoveRequest,
  TocRenameGroupRequest
} from '../shared/contracts'

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
  handle(IPC_CHANNELS.bootstrap, getWindow, noInputSchema, () => ({
    workspace: workspaceManager.getOverview(),
    settings: loadSettings()
  }))

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
    return workspaceManager.setWorkspace(result.filePaths[0])
  })

  handle(IPC_CHANNELS.workspaceSet, getWindow, z.string().min(1).nullable(), (workspacePath) =>
    workspaceManager.setWorkspace(workspacePath)
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
    for (const channel of Object.values(IPC_CHANNELS)) {
      ipcMain.removeHandler(channel)
    }
  }
}
