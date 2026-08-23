export const IPC_CHANNELS = {
  bootstrap: 'desk:bootstrap',
  workspaceChoose: 'workspace:choose',
  workspaceSet: 'workspace:set',
  workspaceRefresh: 'workspace:refresh',
  knowledgeBaseRead: 'knowledge-base:read',
  settingsUpdate: 'settings:update',
  noteRead: 'note:read',
  noteSave: 'note:save',
  noteCreate: 'note:create',
  noteRename: 'note:rename',
  noteUpdateConfig: 'note:update-config',
  attachmentWriteLocal: 'attachment:write-local',
  attachmentReadText: 'attachment:read-text',
  tocMove: 'toc:move',
  tocCreateGroup: 'toc:create-group',
  tocRenameGroup: 'toc:rename-group',
  tocPreviewDelete: 'toc:preview-delete',
  tocDelete: 'toc:delete',
  sessionRead: 'session:read',
  sessionSave: 'session:save',
  recoveryWrite: 'recovery:write',
  recoveryDelete: 'recovery:delete',
  webCreate: 'web:create',
  webLayout: 'web:layout',
  webHideAll: 'web:hide-all',
  webClose: 'web:close',
  webNavigate: 'web:navigate',
  webGoBack: 'web:go-back',
  webGoForward: 'web:go-forward',
  webReload: 'web:reload',
  webStop: 'web:stop',
  webOpenExternal: 'web:open-external',
  webClearBrowsingData: 'web:clear-browsing-data',
  previewStart: 'preview:start',
  previewStop: 'preview:stop',
  previewList: 'preview:list',
  workspaceChanged: 'workspace:changed',
  noteExternalChanged: 'note:external-changed',
  webStateChanged: 'web:state-changed',
  webOpenRequested: 'web:open-requested',
  previewChanged: 'preview:changed',
  log: 'desk:log'
} as const

export interface DeskError {
  code: string
  message: string
  diagnosticId?: string
  details?: Record<string, unknown>
}

export type DeskResult<T> = { ok: true; value: T } | { ok: false; error: DeskError }

export interface WorkspaceDiagnosticDto {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
  path?: string
}

export interface KnowledgeBaseIconDto {
  src?: string
  svg?: string
}

export interface KnowledgeBaseDescriptor {
  id: string
  configId: string
  name: string
  rootPath: string
  displayName: string
  icon: KnowledgeBaseIconDto | null
  health: 'ready' | 'invalid' | 'future-schema'
  diagnostics: WorkspaceDiagnosticDto[]
  noteCount: number
  snapshotRevision: string
}

export type DeskTocNode =
  | {
      type: 'group'
      title: string
      tocLineIndex: number
      nodeId: string
      folderPath: string[]
      children: DeskTocNode[]
    }
  | {
      type: 'note'
      uuid: string
      title: string
      dirName: string
      noteIndex: string
      tocLineIndex: number
      nodeId: string
      completed: boolean
      children: DeskTocNode[]
    }

export interface KnowledgeBaseDetail extends KnowledgeBaseDescriptor {
  toc: DeskTocNode[]
}

export interface WorkspaceOverview {
  path: string | null
  knowledgeBases: KnowledgeBaseDescriptor[]
  allKnowledgeBases: KnowledgeBaseDescriptor[]
}

export type NoteViewMode = 'visual' | 'source'
export type ThemeMode = 'system' | 'light' | 'dark'
export type InterfaceDensity = 'compact' | 'comfortable'
export type IdeKind = 'vscode' | 'cursor'

export interface KnowledgeBaseSettings {
  hidden?: boolean
  prettier?: boolean
  autoPush?: {
    enabled: boolean
    idleMinutes: number
  }
}

export interface AppSettings {
  version: 1
  theme: ThemeMode
  density: InterfaceDensity
  defaultNoteView: NoteViewMode
  autosave: {
    enabled: boolean
    delayMs: number
  }
  prettier: boolean
  ide: IdeKind
  gitPath: string | null
  nodePath: string | null
  confirmBeforeCommit: boolean
  hiddenKnowledgeBases: string[]
  knowledgeBases: Record<string, KnowledgeBaseSettings>
}

export interface BootstrapPayload {
  workspace: WorkspaceOverview
  settings: AppSettings
  session: WorkspaceSession | null
  recoveries: RecoveryRecord[]
}

export interface RecoveryRecord {
  version: 1
  knowledgeBaseId: string
  noteUuid: string
  title: string
  content: string
  revision: string
  updatedAt: string
}

export interface RecoveryWriteRequest {
  knowledgeBaseId: string
  noteUuid: string
  title: string
  content: string
  revision: string
}

export interface RecoveryDeleteRequest {
  knowledgeBaseId: string
  noteUuid: string
}

export interface NoteEditorTab {
  id: string
  type: 'note'
  knowledgeBaseId: string
  knowledgeBaseName: string
  noteUuid: string
  title: string
  icon: KnowledgeBaseIconDto | null
  viewMode: NoteViewMode
}

export interface WebEditorTab {
  id: string
  type: 'web'
  url: string
  title: string
}

export type EditorTab = NoteEditorTab | WebEditorTab

export interface EditorGroupNode {
  type: 'group'
  id: string
  tabs: EditorTab[]
  activeTabId: string | null
}

export interface EditorSplitNode {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  ratio: number
  first: EditorLayoutNode
  second: EditorLayoutNode
}

export type EditorLayoutNode = EditorGroupNode | EditorSplitNode

export interface WorkspaceSession {
  version: 1
  selectedKnowledgeBaseId: string | null
  layout: EditorLayoutNode
  activeGroupId: string
  knowledgeSidebarWidth: number
  navigatorSidebarWidth: number
  knowledgeSidebarCollapsed: boolean
  navigatorSidebarCollapsed: boolean
  expandedTocNodes: Record<string, string[]>
}

export interface WebBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WebCreateRequest {
  tabId: string
  url: string
}

export interface WebLayoutRequest {
  tabId: string
  visible: boolean
  bounds?: WebBounds
}

export interface WebNavigateRequest {
  tabId: string
  url: string
}

export interface WebTabState {
  tabId: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  faviconUrl?: string
  error?: string
}

export interface WebOpenRequestedEvent {
  sourceTabId: string
  url: string
}

export interface PreviewStateDto {
  knowledgeBaseId: string
  knowledgeBaseName: string
  status: 'idle' | 'starting' | 'ready' | 'error'
  port: number | null
  baseUrl: string | null
  error: string | null
}

export interface PreviewStartRequest {
  knowledgeBaseId: string
  noteDirName?: string
}

export interface PreviewStartResult {
  state: PreviewStateDto
  url: string | null
}

export interface NoteDocumentDto {
  knowledgeBaseId: string
  uuid: string
  index: string
  title: string
  dirName: string
  directoryPath: string
  readmePath: string
  configPath: string
  content: string
  revision: string
  config: Record<string, unknown>
  readOnly: boolean
}

export interface NoteMutationDto {
  note: NoteDocumentDto
  knowledgeBase: KnowledgeBaseDetail
  changedFiles: Array<{
    path: string
    kind: 'created' | 'updated' | 'deleted' | 'renamed'
    previousPath?: string
  }>
}

export interface NoteSaveRequest {
  knowledgeBaseId: string
  noteUuid: string
  content: string
  expectedRevision: string
  prettier?: boolean
}

export interface NoteCreateRequest {
  knowledgeBaseId: string
  title: string
  placement?:
    | { type: 'root'; placement?: 'start' | 'end' }
    | {
        type: 'note'
        targetNoteUuid: string
        placement: 'before' | 'after' | 'inside'
      }
    | {
        type: 'folder'
        folderPath: string[]
        placement: 'before' | 'after' | 'inside'
      }
  expectedSnapshotRevision?: string
}

export interface NoteRenameRequest {
  knowledgeBaseId: string
  noteUuid: string
  title: string
  expectedRevision: string
}

export interface NoteUpdateConfigRequest {
  knowledgeBaseId: string
  noteUuid: string
  expectedRevision: string
  updates: {
    done?: boolean
    description?: string
    enableDiscussions?: boolean
  }
}

export interface AttachmentWriteLocalRequest {
  knowledgeBaseId: string
  noteUuid: string
  fileName: string
  data: Uint8Array
}

export interface AttachmentWriteLocalResult {
  absolutePath: string
  markdownPath: string
}

export interface AttachmentReadTextRequest {
  knowledgeBaseId: string
  noteUuid: string
  path: string
}

export type TocEntryRefDto =
  | { type: 'note'; noteUuid: string }
  | { type: 'folder'; folderPath: string[] }
  | { type: 'line'; tocLineIndex: number }

export interface TocMoveRequest {
  knowledgeBaseId: string
  source: TocEntryRefDto
  target: TocEntryRefDto
  placement: 'before' | 'after' | 'inside'
  expectedSnapshotRevision: string
}

export interface TocCreateGroupRequest {
  knowledgeBaseId: string
  title: string
  placement?: NoteCreateRequest['placement']
  expectedSnapshotRevision: string
}

export interface TocRenameGroupRequest {
  knowledgeBaseId: string
  folderPath: string[]
  title: string
  expectedSnapshotRevision: string
}

export interface TocDeleteRequest {
  knowledgeBaseId: string
  entry: TocEntryRefDto
  expectedSnapshotRevision: string
}

export interface DeletePreviewDto {
  knowledgeBaseId: string
  entry: TocEntryRefDto
  notes: Array<{
    noteUuid: string
    index: string
    title: string
    directoryPath: string
  }>
  filePaths: string[]
  directoryPaths: string[]
  snapshotRevision: string
}

export interface ExternalNoteChangeEvent {
  knowledgeBaseId: string
  noteUuid: string
}

export interface DeskApi {
  bootstrap(): Promise<DeskResult<BootstrapPayload>>
  workspace: {
    choose(): Promise<DeskResult<WorkspaceOverview>>
    set(path: string | null): Promise<DeskResult<WorkspaceOverview>>
    refresh(): Promise<DeskResult<WorkspaceOverview>>
    onChanged(callback: (overview: WorkspaceOverview) => void): () => void
  }
  settings: {
    update(next: Partial<AppSettings>): Promise<DeskResult<AppSettings>>
  }
  knowledgeBases: {
    read(knowledgeBaseId: string): Promise<DeskResult<KnowledgeBaseDetail>>
  }
  notes: {
    read(knowledgeBaseId: string, noteUuid: string): Promise<DeskResult<NoteDocumentDto>>
    save(request: NoteSaveRequest): Promise<DeskResult<NoteMutationDto>>
    create(request: NoteCreateRequest): Promise<DeskResult<NoteMutationDto>>
    rename(request: NoteRenameRequest): Promise<DeskResult<NoteMutationDto>>
    updateConfig(request: NoteUpdateConfigRequest): Promise<DeskResult<NoteMutationDto>>
    onExternalChanged(callback: (event: ExternalNoteChangeEvent) => void): () => void
  }
  attachments: {
    writeLocal(
      request: AttachmentWriteLocalRequest
    ): Promise<DeskResult<AttachmentWriteLocalResult>>
    readText(request: AttachmentReadTextRequest): Promise<DeskResult<string>>
  }
  toc: {
    move(request: TocMoveRequest): Promise<DeskResult<KnowledgeBaseDetail>>
    createGroup(request: TocCreateGroupRequest): Promise<DeskResult<KnowledgeBaseDetail>>
    renameGroup(request: TocRenameGroupRequest): Promise<DeskResult<KnowledgeBaseDetail>>
    previewDelete(
      knowledgeBaseId: string,
      entry: TocEntryRefDto
    ): Promise<DeskResult<DeletePreviewDto>>
    delete(request: TocDeleteRequest): Promise<DeskResult<KnowledgeBaseDetail>>
  }
  session: {
    read(): Promise<DeskResult<WorkspaceSession | null>>
    save(session: WorkspaceSession): Promise<DeskResult<void>>
  }
  recovery: {
    write(request: RecoveryWriteRequest): Promise<DeskResult<void>>
    delete(request: RecoveryDeleteRequest): Promise<DeskResult<void>>
  }
  web: {
    create(request: WebCreateRequest): Promise<DeskResult<WebTabState>>
    layout(request: WebLayoutRequest): Promise<DeskResult<void>>
    hideAll(): Promise<DeskResult<void>>
    close(tabId: string): Promise<DeskResult<void>>
    navigate(request: WebNavigateRequest): Promise<DeskResult<WebTabState>>
    goBack(tabId: string): Promise<DeskResult<void>>
    goForward(tabId: string): Promise<DeskResult<void>>
    reload(tabId: string): Promise<DeskResult<void>>
    stop(tabId: string): Promise<DeskResult<void>>
    openExternal(url: string): Promise<DeskResult<void>>
    clearBrowsingData(): Promise<DeskResult<void>>
    onStateChanged(callback: (state: WebTabState) => void): () => void
    onOpenRequested(callback: (event: WebOpenRequestedEvent) => void): () => void
  }
  preview: {
    start(request: PreviewStartRequest): Promise<DeskResult<PreviewStartResult>>
    stop(knowledgeBaseId: string): Promise<DeskResult<PreviewStateDto>>
    list(): Promise<DeskResult<PreviewStateDto[]>>
    onChanged(callback: (state: PreviewStateDto) => void): () => void
  }
  onLog(callback: (line: string) => void): () => void
}
