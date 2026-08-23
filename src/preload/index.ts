import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS } from '../shared/contracts'

import type {
  AppSettings,
  BootstrapPayload,
  DeletePreviewDto,
  DeskApi,
  DeskResult,
  ExternalNoteChangeEvent,
  KnowledgeBaseDetail,
  NoteCreateRequest,
  NoteDocumentDto,
  NoteMutationDto,
  NoteRenameRequest,
  NoteSaveRequest,
  NoteUpdateConfigRequest,
  TocCreateGroupRequest,
  TocDeleteRequest,
  TocEntryRefDto,
  TocMoveRequest,
  TocRenameGroupRequest,
  WorkspaceOverview
} from '../shared/contracts'

function invoke<T>(channel: string, input?: unknown): Promise<DeskResult<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<DeskResult<T>>
}

const api: DeskApi = {
  bootstrap: () => invoke<BootstrapPayload>(IPC_CHANNELS.bootstrap),
  workspace: {
    choose: () => invoke<WorkspaceOverview>(IPC_CHANNELS.workspaceChoose),
    set: (path) => invoke<WorkspaceOverview>(IPC_CHANNELS.workspaceSet, path),
    refresh: () => invoke<WorkspaceOverview>(IPC_CHANNELS.workspaceRefresh),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, overview: WorkspaceOverview): void =>
        callback(overview)
      ipcRenderer.on(IPC_CHANNELS.workspaceChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceChanged, listener)
    }
  },
  settings: {
    update: (next) => invoke<AppSettings>(IPC_CHANNELS.settingsUpdate, next)
  },
  knowledgeBases: {
    read: (knowledgeBaseId) =>
      invoke<KnowledgeBaseDetail>(IPC_CHANNELS.knowledgeBaseRead, knowledgeBaseId)
  },
  notes: {
    read: (knowledgeBaseId, noteUuid) =>
      invoke<NoteDocumentDto>(IPC_CHANNELS.noteRead, {
        knowledgeBaseId,
        noteUuid
      }),
    save: (request: NoteSaveRequest) => invoke<NoteMutationDto>(IPC_CHANNELS.noteSave, request),
    create: (request: NoteCreateRequest) =>
      invoke<NoteMutationDto>(IPC_CHANNELS.noteCreate, request),
    rename: (request: NoteRenameRequest) =>
      invoke<NoteMutationDto>(IPC_CHANNELS.noteRename, request),
    updateConfig: (request: NoteUpdateConfigRequest) =>
      invoke<NoteMutationDto>(IPC_CHANNELS.noteUpdateConfig, request),
    onExternalChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ExternalNoteChangeEvent
      ): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.noteExternalChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.noteExternalChanged, listener)
    }
  },
  toc: {
    move: (request: TocMoveRequest) => invoke<KnowledgeBaseDetail>(IPC_CHANNELS.tocMove, request),
    createGroup: (request: TocCreateGroupRequest) =>
      invoke<KnowledgeBaseDetail>(IPC_CHANNELS.tocCreateGroup, request),
    renameGroup: (request: TocRenameGroupRequest) =>
      invoke<KnowledgeBaseDetail>(IPC_CHANNELS.tocRenameGroup, request),
    previewDelete: (knowledgeBaseId, entry: TocEntryRefDto) =>
      invoke<DeletePreviewDto>(IPC_CHANNELS.tocPreviewDelete, {
        knowledgeBaseId,
        entry
      }),
    delete: (request: TocDeleteRequest) =>
      invoke<KnowledgeBaseDetail>(IPC_CHANNELS.tocDelete, request)
  },
  onLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, line: string): void => callback(line)
    ipcRenderer.on(IPC_CHANNELS.log, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.log, listener)
  }
}

contextBridge.exposeInMainWorld('desk', api)
