export const IPC_CHANNELS = {
  bootstrap: 'desk:bootstrap',
  windowClose: 'window:close',
  tabShortcut: 'tab:shortcut',
  workspaceChoose: 'workspace:choose',
  workspaceSet: 'workspace:set',
  workspaceRefresh: 'workspace:refresh',
  workspaceRevealKnowledgeBase: 'workspace:reveal-knowledge-base',
  knowledgeBaseRead: 'knowledge-base:read',
  settingsUpdate: 'settings:update',
  settingsExport: 'settings:export',
  settingsImport: 'settings:import',
  settingsReset: 'settings:reset',
  settingsReadRaw: 'settings:read-raw',
  settingsWriteRaw: 'settings:write-raw',
  noteRead: 'note:read',
  noteResolveTable: 'note:resolve-table',
  noteSave: 'note:save',
  noteCreate: 'note:create',
  noteRename: 'note:rename',
  noteUpdateConfig: 'note:update-config',
  noteCopyDirectoryPath: 'note:copy-directory-path',
  noteRevealInFileManager: 'note:reveal-in-file-manager',
  noteFilesList: 'note-files:list',
  noteFileReadText: 'note-file:read-text',
  noteFileSaveText: 'note-file:save-text',
  attachmentWriteLocal: 'attachment:write-local',
  attachmentUploadImage: 'attachment:upload-image',
  attachmentReadText: 'attachment:read-text',
  attachmentWriteText: 'attachment:write-text',
  imageTokenStatus: 'image:token-status',
  imageTokenUpdate: 'image:token-update',
  imageSettingsValidate: 'image:settings-validate',
  searchQuery: 'search:query',
  gitList: 'git:list',
  gitRefresh: 'git:refresh',
  gitFetch: 'git:fetch',
  gitPull: 'git:pull',
  gitPublish: 'git:publish',
  ideShowKnowledgeBaseMenu: 'ide:show-knowledge-base-menu',
  ideShowNoteMenu: 'ide:show-note-menu',
  ideShowFileMenu: 'ide:show-file-menu',
  ideOpenKnowledgeBase: 'ide:open-knowledge-base',
  ideOpenNote: 'ide:open-note',
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
  noteFileExternalChanged: 'note-file:external-changed',
  webStateChanged: 'web:state-changed',
  webOpenRequested: 'web:open-requested',
  previewChanged: 'preview:changed',
  gitStateChanged: 'git:state-changed',
  updateStatus: 'update:status',
  updateCheck: 'update:check',
  updateOpenRelease: 'update:open-release',
  updateChanged: 'update:changed',
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
  repositoryUrl?: string
  pageUrl?: string
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

export type NoteViewMode = 'visual' | 'readonly' | 'source'
export type NotePageWidth = 'standard' | 'wide'
export type NoteTocDisplay = 'hidden' | 'collapsed' | 'expanded'
export type TabShortcutCommand =
  | 'close-active-tab-or-window'
  | 'close-saved-note-tabs'
  | 'close-all-tabs'
  | 'keep-active-tab-open'
  | 'toggle-pin-active-tab'
  | 'copy-active-note-path'
  | 'reveal-active-note-in-file-manager'
  | 'next-tab'
  | 'previous-tab'
export type ThemeMode = 'system' | 'light' | 'dark'
export type InterfaceDensity = 'compact' | 'comfortable'
export type IdeKind = 'vscode' | 'cursor'
export type ImageDefaultTarget = 'local' | 'github'

export interface GitHubImageSettings {
  repository: string
  branch: string
  path: string
  cdnTemplate: string
  fileNameFormat: string
}

export interface ImageUploadSettings {
  defaultTarget: ImageDefaultTarget
  github: GitHubImageSettings
}

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
  defaultNotePageWidth: NotePageWidth
  noteTocDisplay: NoteTocDisplay
  autosave: {
    enabled: boolean
    delayMs: number
  }
  createNotePosition: 'top' | 'end'
  workspaceLayout: 'kb-dir-content' | 'content-dir-kb'
  prettier: boolean
  ide: IdeKind
  gitPath: string | null
  nodePath: string | null
  confirmBeforeCommit: boolean
  tabs: {
    maxOpenCount: number
    wrap: boolean
    autoRevealInToc: boolean
  }
  toc: {
    showNoteIndex: boolean
    showNoteStatus: boolean
    doneEmoji: string
    undoneEmoji: string
    changesCollapsedByDefault: boolean
  }
  imageUpload: ImageUploadSettings
  updates: {
    autoCheck: boolean
  }
  hiddenKnowledgeBases: string[]
  knowledgeBases: Record<string, KnowledgeBaseSettings>
}

export type UpdateStateKind = 'idle' | 'checking' | 'up-to-date' | 'available' | 'error'

export interface UpdateStatusDto {
  state: UpdateStateKind
  currentVersion: string
  latestVersion?: string
  releaseUrl?: string
  checkedAt?: string
  message?: string
}

export interface BootstrapPayload {
  workspace: WorkspaceOverview
  settings: AppSettings
  platform: 'darwin' | 'win32' | 'linux'
  session: WorkspaceSession | null
  recoveries: RecoveryRecord[]
}

export interface RecoveryRecord {
  version: 1
  knowledgeBaseId: string
  noteUuid: string
  /** Missing for README.md recoveries created by older Desk releases. */
  path?: string
  title: string
  content: string
  revision: string
  updatedAt: string
}

export interface RecoveryWriteRequest {
  knowledgeBaseId: string
  noteUuid: string
  path?: string
  title: string
  content: string
  revision: string
}

export interface RecoveryDeleteRequest {
  knowledgeBaseId: string
  noteUuid: string
  path?: string
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
  pageWidth: NotePageWidth
  preview?: boolean
  pinned?: boolean
  openedAt?: number
  dirty?: boolean
}

export interface WebEditorTab {
  id: string
  type: 'web'
  url: string
  title: string
  pinned?: boolean
  openedAt?: number
}

export type NoteFileKind = 'text' | 'image' | 'unsupported'

export interface NoteFileEditorTab {
  id: string
  type: 'note-file'
  knowledgeBaseId: string
  knowledgeBaseName: string
  noteUuid: string
  noteTitle: string
  path: string
  title: string
  fileKind: NoteFileKind
  pinned?: boolean
  openedAt?: number
  dirty?: boolean
}

export type EditorTab = NoteEditorTab | NoteFileEditorTab | WebEditorTab

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

export interface KnowledgeBaseEditorSession {
  layout: EditorLayoutNode
  activeGroupId: string
  lastNoteByGroup?: Record<string, { noteUuid: string; noteTitle: string }>
}

export interface WorkspaceSession {
  version: 1
  selectedKnowledgeBaseId: string | null
  layout: EditorLayoutNode
  activeGroupId: string
  knowledgeBaseEditors: Record<string, KnowledgeBaseEditorSession>
  knowledgeSidebarWidth: number
  navigatorSidebarWidth: number
  knowledgeSidebarCollapsed: boolean
  navigatorSidebarCollapsed: boolean
  expandedTocNodes: Record<string, string[]>
  noteFileSidebarWidth: number
  noteFileSidebarCollapsed: boolean
  expandedNoteFileDirectories: Record<string, string[]>
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

export interface NoteFileEntryDto {
  name: string
  path: string
  kind: 'directory' | 'file'
  fileKind: NoteFileKind | null
  size: number | null
}

export interface NoteFilesListRequest {
  knowledgeBaseId: string
  noteUuid: string
  directory?: string
}

export interface NoteTextFileDto {
  knowledgeBaseId: string
  noteUuid: string
  path: string
  content: string
  revision: string
  size: number
  readOnly: boolean
}

export interface NoteFileReadTextRequest {
  knowledgeBaseId: string
  noteUuid: string
  path: string
}

export interface NoteFileSaveTextRequest extends NoteFileReadTextRequest {
  content: string
  expectedRevision: string
}

/** Rows for `<NotesTable>` preview — Desk adapter over workspace snapshot. */
export interface NotesTableResolveRowDto {
  id: string
  title: string
  description: string
  /** Present when the id maps to a note in this knowledge base. */
  noteUuid: string | null
}

export interface NotesTableResolveRequest {
  knowledgeBaseId: string
  ids: string[]
}

export interface NotesTableResolveResult {
  notes: NotesTableResolveRowDto[]
  missingIds: string[]
}

export interface NoteMutationDto {
  note: NoteDocumentDto
  knowledgeBase: KnowledgeBaseDetail
  changedFiles: Array<{
    path: string
    kind: 'created' | 'updated' | 'deleted' | 'renamed' | 'trashed'
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

export interface ImageUploadRequest extends AttachmentWriteLocalRequest {}

export interface ImageUploadResult {
  markdownPath: string
  target: ImageDefaultTarget
  fallback: boolean
  absolutePath?: string
  remotePath?: string
  warning?: string
}

export interface ImageTokenStatus {
  configured: boolean
  encryptionAvailable: boolean
}

export interface ImageTokenUpdateRequest {
  token?: string
  clear: boolean
}

export interface ImageSettingsValidateRequest {
  github: GitHubImageSettings
  token?: string
}

export interface ImageSettingsValidateResult {
  repository: string
  branch: string
  message: string
}

export interface SearchRequest {
  query: string
  knowledgeBaseId: string | null
  limit?: number
}

export interface SearchResultDto {
  knowledgeBaseId: string
  knowledgeBaseName: string
  noteUuid: string
  noteIndex: string
  title: string
  snippet: string
  score: number
}

export type GitFileStatus =
  'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'

export interface GitFileChangeDto {
  path: string
  previousPath?: string
  status: GitFileStatus
  staged: boolean
  worktree: boolean
  noteUuid?: string
  noteIndex?: string
  noteTitle?: string
}

export interface GitRepositoryStateDto {
  knowledgeBaseId: string
  knowledgeBaseName: string
  initialized: boolean
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: GitFileChangeDto[]
  conflict: boolean
  busy: 'fetch' | 'pull' | 'publish' | null
  lastFetchedAt: string | null
  error: string | null
}

export interface GitOperationResult {
  state: GitRepositoryStateDto
  message: string
  conflict: boolean
}

export interface AttachmentReadTextRequest {
  knowledgeBaseId: string
  noteUuid: string
  path: string
}

export interface AttachmentWriteTextRequest {
  knowledgeBaseId: string
  noteUuid: string
  path: string
  content: string
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
  untrackedFilePaths: string[]
  snapshotRevision: string
}

export interface ExternalNoteChangeEvent {
  knowledgeBaseId: string
  noteUuid: string
}

export interface ExternalNoteFileChangeEvent {
  knowledgeBaseId: string
  noteUuid: string
  path: string
  kind: 'changed' | 'deleted'
}

export interface DeskApi {
  bootstrap(): Promise<DeskResult<BootstrapPayload>>
  app: {
    closeWindow(): Promise<DeskResult<void>>
    onTabShortcut(callback: (command: TabShortcutCommand) => void): () => void
  }
  updates: {
    status(): Promise<DeskResult<UpdateStatusDto>>
    check(): Promise<DeskResult<UpdateStatusDto>>
    openReleasePage(): Promise<DeskResult<void>>
    onChanged(callback: (status: UpdateStatusDto) => void): () => void
  }
  workspace: {
    choose(): Promise<DeskResult<WorkspaceOverview>>
    set(path: string | null): Promise<DeskResult<WorkspaceOverview>>
    refresh(): Promise<DeskResult<WorkspaceOverview>>
    revealKnowledgeBase(knowledgeBaseId: string): Promise<DeskResult<void>>
    onChanged(callback: (overview: WorkspaceOverview) => void): () => void
  }
  settings: {
    update(next: Partial<AppSettings>): Promise<DeskResult<AppSettings>>
    export(): Promise<DeskResult<void>>
    import(): Promise<DeskResult<AppSettings>>
    reset(): Promise<DeskResult<AppSettings>>
    readRaw(): Promise<DeskResult<string>>
    writeRaw(json: string): Promise<DeskResult<AppSettings>>
    imageTokenStatus(): Promise<DeskResult<ImageTokenStatus>>
    updateImageToken(request: ImageTokenUpdateRequest): Promise<DeskResult<ImageTokenStatus>>
    validateImageSettings(
      request: ImageSettingsValidateRequest
    ): Promise<DeskResult<ImageSettingsValidateResult>>
  }
  knowledgeBases: {
    read(knowledgeBaseId: string): Promise<DeskResult<KnowledgeBaseDetail>>
  }
  notes: {
    read(knowledgeBaseId: string, noteUuid: string): Promise<DeskResult<NoteDocumentDto>>
    resolveTable(request: NotesTableResolveRequest): Promise<DeskResult<NotesTableResolveResult>>
    save(request: NoteSaveRequest): Promise<DeskResult<NoteMutationDto>>
    create(request: NoteCreateRequest): Promise<DeskResult<NoteMutationDto>>
    rename(request: NoteRenameRequest): Promise<DeskResult<NoteMutationDto>>
    updateConfig(request: NoteUpdateConfigRequest): Promise<DeskResult<NoteMutationDto>>
    copyDirectoryPath(knowledgeBaseId: string, noteUuid: string): Promise<DeskResult<string>>
    revealInFileManager(knowledgeBaseId: string, noteUuid: string): Promise<DeskResult<void>>
    onExternalChanged(callback: (event: ExternalNoteChangeEvent) => void): () => void
  }
  noteFiles: {
    list(request: NoteFilesListRequest): Promise<DeskResult<NoteFileEntryDto[]>>
    readText(request: NoteFileReadTextRequest): Promise<DeskResult<NoteTextFileDto>>
    saveText(request: NoteFileSaveTextRequest): Promise<DeskResult<NoteTextFileDto>>
    onExternalChanged(callback: (event: ExternalNoteFileChangeEvent) => void): () => void
  }
  attachments: {
    writeLocal(
      request: AttachmentWriteLocalRequest
    ): Promise<DeskResult<AttachmentWriteLocalResult>>
    uploadImage(request: ImageUploadRequest): Promise<DeskResult<ImageUploadResult>>
    readText(request: AttachmentReadTextRequest): Promise<DeskResult<string>>
    writeText(request: AttachmentWriteTextRequest): Promise<DeskResult<void>>
  }
  search(request: SearchRequest): Promise<DeskResult<SearchResultDto[]>>
  git: {
    list(): Promise<DeskResult<GitRepositoryStateDto[]>>
    refresh(knowledgeBaseId?: string): Promise<DeskResult<GitRepositoryStateDto[]>>
    fetch(knowledgeBaseId: string): Promise<DeskResult<GitOperationResult>>
    pull(knowledgeBaseId: string): Promise<DeskResult<GitOperationResult>>
    publish(knowledgeBaseId: string): Promise<DeskResult<GitOperationResult>>
    onStateChanged(callback: (state: GitRepositoryStateDto) => void): () => void
  }
  ide: {
    showKnowledgeBaseMenu(knowledgeBaseId: string): Promise<DeskResult<void>>
    showNoteMenu(knowledgeBaseId: string, noteUuid: string): Promise<DeskResult<void>>
    showFileMenu(knowledgeBaseId: string, path: string): Promise<DeskResult<void>>
    openKnowledgeBase(knowledgeBaseId: string): Promise<DeskResult<void>>
    openNote(knowledgeBaseId: string, noteUuid: string): Promise<DeskResult<void>>
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
