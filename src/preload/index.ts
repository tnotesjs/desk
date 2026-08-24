import { contextBridge, ipcRenderer } from 'electron'

import { IPC_CHANNELS } from '../shared/contracts'

import type {
  AppSettings,
  AttachmentWriteLocalRequest,
  AttachmentWriteLocalResult,
  AttachmentReadTextRequest,
  ImageSettingsValidateResult,
  ImageTokenStatus,
  ImageUploadResult,
  GitOperationResult,
  GitRepositoryStateDto,
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
  PreviewStartResult,
  PreviewStateDto,
  RecoveryDeleteRequest,
  RecoveryWriteRequest,
  SearchResultDto,
  TabShortcutCommand,
  TocCreateGroupRequest,
  TocDeleteRequest,
  TocEntryRefDto,
  TocMoveRequest,
  TocRenameGroupRequest,
  WebOpenRequestedEvent,
  WebTabState,
  WorkspaceSession,
  WorkspaceOverview
} from '../shared/contracts'

function invoke<T>(channel: string, input?: unknown): Promise<DeskResult<T>> {
  return ipcRenderer.invoke(channel, input) as Promise<DeskResult<T>>
}

const api: DeskApi = {
  bootstrap: () => invoke<BootstrapPayload>(IPC_CHANNELS.bootstrap),
  app: {
    closeWindow: () => invoke<void>(IPC_CHANNELS.windowClose),
    onTabShortcut: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, command: TabShortcutCommand): void =>
        callback(command)
      ipcRenderer.on(IPC_CHANNELS.tabShortcut, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.tabShortcut, listener)
    }
  },
  workspace: {
    choose: () => invoke<WorkspaceOverview>(IPC_CHANNELS.workspaceChoose),
    set: (path) => invoke<WorkspaceOverview>(IPC_CHANNELS.workspaceSet, path),
    refresh: () => invoke<WorkspaceOverview>(IPC_CHANNELS.workspaceRefresh),
    revealKnowledgeBase: (knowledgeBaseId) =>
      invoke<void>(IPC_CHANNELS.workspaceRevealKnowledgeBase, knowledgeBaseId),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, overview: WorkspaceOverview): void =>
        callback(overview)
      ipcRenderer.on(IPC_CHANNELS.workspaceChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceChanged, listener)
    }
  },
  settings: {
    update: (next) => invoke<AppSettings>(IPC_CHANNELS.settingsUpdate, next),
    imageTokenStatus: () => invoke<ImageTokenStatus>(IPC_CHANNELS.imageTokenStatus),
    updateImageToken: (request) => invoke<ImageTokenStatus>(IPC_CHANNELS.imageTokenUpdate, request),
    validateImageSettings: (request) =>
      invoke<ImageSettingsValidateResult>(IPC_CHANNELS.imageSettingsValidate, request)
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
    copyDirectoryPath: (knowledgeBaseId, noteUuid) =>
      invoke<string>(IPC_CHANNELS.noteCopyDirectoryPath, { knowledgeBaseId, noteUuid }),
    revealInFileManager: (knowledgeBaseId, noteUuid) =>
      invoke<void>(IPC_CHANNELS.noteRevealInFileManager, { knowledgeBaseId, noteUuid }),
    onExternalChanged: (callback) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: ExternalNoteChangeEvent
      ): void => callback(payload)
      ipcRenderer.on(IPC_CHANNELS.noteExternalChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.noteExternalChanged, listener)
    }
  },
  attachments: {
    writeLocal: (request: AttachmentWriteLocalRequest) =>
      invoke<AttachmentWriteLocalResult>(IPC_CHANNELS.attachmentWriteLocal, request),
    uploadImage: (request) =>
      invoke<ImageUploadResult>(IPC_CHANNELS.attachmentUploadImage, request),
    readText: (request: AttachmentReadTextRequest) =>
      invoke<string>(IPC_CHANNELS.attachmentReadText, request)
  },
  search: (request) => invoke<SearchResultDto[]>(IPC_CHANNELS.searchQuery, request),
  git: {
    list: () => invoke<GitRepositoryStateDto[]>(IPC_CHANNELS.gitList),
    refresh: (knowledgeBaseId) =>
      invoke<GitRepositoryStateDto[]>(IPC_CHANNELS.gitRefresh, knowledgeBaseId),
    fetch: (knowledgeBaseId) => invoke<GitOperationResult>(IPC_CHANNELS.gitFetch, knowledgeBaseId),
    pull: (knowledgeBaseId) => invoke<GitOperationResult>(IPC_CHANNELS.gitPull, knowledgeBaseId),
    publish: (knowledgeBaseId) =>
      invoke<GitOperationResult>(IPC_CHANNELS.gitPublish, knowledgeBaseId),
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: GitRepositoryStateDto): void =>
        callback(state)
      ipcRenderer.on(IPC_CHANNELS.gitStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.gitStateChanged, listener)
    }
  },
  ide: {
    showKnowledgeBaseMenu: (knowledgeBaseId) =>
      invoke<void>(IPC_CHANNELS.ideShowKnowledgeBaseMenu, knowledgeBaseId),
    showNoteMenu: (knowledgeBaseId, noteUuid) =>
      invoke<void>(IPC_CHANNELS.ideShowNoteMenu, { knowledgeBaseId, noteUuid }),
    openKnowledgeBase: (knowledgeBaseId) =>
      invoke<void>(IPC_CHANNELS.ideOpenKnowledgeBase, knowledgeBaseId),
    openNote: (knowledgeBaseId, noteUuid) =>
      invoke<void>(IPC_CHANNELS.ideOpenNote, { knowledgeBaseId, noteUuid })
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
  session: {
    read: () => invoke<WorkspaceSession | null>(IPC_CHANNELS.sessionRead),
    save: (session) => invoke<void>(IPC_CHANNELS.sessionSave, session)
  },
  recovery: {
    write: (request: RecoveryWriteRequest) => invoke<void>(IPC_CHANNELS.recoveryWrite, request),
    delete: (request: RecoveryDeleteRequest) => invoke<void>(IPC_CHANNELS.recoveryDelete, request)
  },
  web: {
    create: (request) => invoke<WebTabState>(IPC_CHANNELS.webCreate, request),
    layout: (request) => invoke<void>(IPC_CHANNELS.webLayout, request),
    hideAll: () => invoke<void>(IPC_CHANNELS.webHideAll),
    close: (tabId) => invoke<void>(IPC_CHANNELS.webClose, tabId),
    navigate: (request) => invoke<WebTabState>(IPC_CHANNELS.webNavigate, request),
    goBack: (tabId) => invoke<void>(IPC_CHANNELS.webGoBack, tabId),
    goForward: (tabId) => invoke<void>(IPC_CHANNELS.webGoForward, tabId),
    reload: (tabId) => invoke<void>(IPC_CHANNELS.webReload, tabId),
    stop: (tabId) => invoke<void>(IPC_CHANNELS.webStop, tabId),
    openExternal: (url) => invoke<void>(IPC_CHANNELS.webOpenExternal, url),
    clearBrowsingData: () => invoke<void>(IPC_CHANNELS.webClearBrowsingData),
    onStateChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: WebTabState): void =>
        callback(state)
      ipcRenderer.on(IPC_CHANNELS.webStateChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.webStateChanged, listener)
    },
    onOpenRequested: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: WebOpenRequestedEvent): void =>
        callback(payload)
      ipcRenderer.on(IPC_CHANNELS.webOpenRequested, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.webOpenRequested, listener)
    }
  },
  preview: {
    start: (request) => invoke<PreviewStartResult>(IPC_CHANNELS.previewStart, request),
    stop: (knowledgeBaseId) => invoke<PreviewStateDto>(IPC_CHANNELS.previewStop, knowledgeBaseId),
    list: () => invoke<PreviewStateDto[]>(IPC_CHANNELS.previewList),
    onChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: PreviewStateDto): void =>
        callback(state)
      ipcRenderer.on(IPC_CHANNELS.previewChanged, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.previewChanged, listener)
    }
  },
  onLog: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, line: string): void => callback(line)
    ipcRenderer.on(IPC_CHANNELS.log, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.log, listener)
  }
}

contextBridge.exposeInMainWorld('desk', api)
