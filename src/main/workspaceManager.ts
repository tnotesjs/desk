import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { watch, type FSWatcher } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createWorkspace } from '@tnotesjs/core/workspace'

import { deskLog } from './log'
import { loadSettings, settingsForKnowledgeBase } from './settings'
import { loadWorkspace, saveWorkspace } from './workspace'

import type {
  ChangedFile,
  KnowledgeBaseSnapshot,
  MutationResult,
  NoteDocument,
  NotePlacement,
  TNotesWorkspace,
  TocEntryRef
} from '@tnotesjs/core/workspace'
import type {
  DeletePreviewDto,
  DeskTocNode,
  ExternalNoteChangeEvent,
  KnowledgeBaseDescriptor,
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

const KNOWLEDGE_BASE_NAME = /^TNotes\./

interface CoreTocNode {
  kind: 'folder' | 'note'
  title?: string
  noteIndex?: string
  tocLineIndex: number
  children: CoreTocNode[]
}

interface KnowledgeBaseHandle {
  id: string
  name: string
  rootPath: string
  workspace: TNotesWorkspace
  snapshot: KnowledgeBaseSnapshot
}

interface WorkspaceManagerEvents {
  changed: [WorkspaceOverview]
  noteExternalChanged: [ExternalNoteChangeEvent]
}

function stablePathSuffix(rootPath: string): string {
  return createHash('sha256').update(rootPath).digest('hex').slice(0, 10)
}

function iconFromSnapshot(snapshot: KnowledgeBaseSnapshot): KnowledgeBaseDescriptor['icon'] {
  const rootItem = snapshot.config?.root_item
  const icon = rootItem?.icon
  if (!icon || typeof icon !== 'object') return null
  return {
    src: typeof icon.src === 'string' ? icon.src : undefined,
    svg: typeof icon.svg === 'string' ? icon.svg : undefined
  }
}

function descriptor(handle: KnowledgeBaseHandle): KnowledgeBaseDescriptor {
  const snapshot = handle.snapshot
  return {
    id: handle.id,
    configId: snapshot.id,
    name: handle.name,
    rootPath: handle.rootPath,
    displayName: snapshot.config?.root_item?.title || handle.name.replace(/^TNotes\./, ''),
    icon: iconFromSnapshot(snapshot),
    health: snapshot.health.status,
    diagnostics: snapshot.health.diagnostics,
    noteCount: snapshot.notes.length,
    snapshotRevision: snapshot.revision
  }
}

function mapToc(
  nodes: CoreTocNode[],
  snapshot: KnowledgeBaseSnapshot,
  folderPath: string[] = []
): DeskTocNode[] {
  const noteByIndex = new Map(snapshot.notes.map((note) => [note.index, note]))
  return nodes.flatMap((node): DeskTocNode[] => {
    if (node.kind === 'folder') {
      const title = node.title ?? '未命名分组'
      const currentPath = [...folderPath, title]
      return [
        {
          type: 'group',
          title,
          tocLineIndex: node.tocLineIndex,
          nodeId: `folder:${node.tocLineIndex}:${currentPath.join('/')}`,
          folderPath: currentPath,
          children: mapToc(node.children, snapshot, currentPath)
        }
      ]
    }
    if (!node.noteIndex) return []
    const note = noteByIndex.get(node.noteIndex)
    if (!note) return []
    return [
      {
        type: 'note',
        uuid: note.uuid,
        title: note.title,
        dirName: note.dirName,
        noteIndex: note.index,
        tocLineIndex: node.tocLineIndex,
        nodeId: `note:${note.uuid}`,
        completed: Boolean(note.config.done),
        children: mapToc(node.children, snapshot, folderPath)
      }
    ]
  })
}

function toDetail(handle: KnowledgeBaseHandle): KnowledgeBaseDetail {
  return {
    ...descriptor(handle),
    toc: mapToc(handle.snapshot.toc as CoreTocNode[], handle.snapshot)
  }
}

function toNoteDocument(handle: KnowledgeBaseHandle, document: NoteDocument): NoteDocumentDto {
  return {
    knowledgeBaseId: handle.id,
    uuid: document.uuid,
    index: document.index,
    title: document.title,
    dirName: document.dirName,
    directoryPath: document.directoryPath,
    readmePath: document.readmePath,
    configPath: document.configPath,
    content: document.content,
    revision: document.revision,
    config: document.config,
    readOnly: handle.snapshot.health.status !== 'ready'
  }
}

function coreEntryRef(entry: TocEntryRefDto): TocEntryRef {
  return entry
}

export class WorkspaceManager {
  private readonly events = new EventEmitter<WorkspaceManagerEvents>()
  private handles = new Map<string, KnowledgeBaseHandle>()
  private workspacePath: string | null = null
  private watchers = new Map<string, FSWatcher>()
  private refreshTimer: NodeJS.Timeout | null = null
  private scanTail: Promise<void> = Promise.resolve()
  private internalWriteUntil = new Map<string, number>()
  private lastWatcherError = ''
  private lastWatcherErrorAt = 0
  private disposed = false

  onChanged(listener: (overview: WorkspaceOverview) => void): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  onNoteExternalChanged(listener: (event: ExternalNoteChangeEvent) => void): () => void {
    this.events.on('noteExternalChanged', listener)
    return () => this.events.off('noteExternalChanged', listener)
  }

  async initialize(): Promise<WorkspaceOverview> {
    return this.setWorkspace(loadWorkspace().path, false)
  }

  async setWorkspace(nextPath: string | null, persist = true): Promise<WorkspaceOverview> {
    this.assertActive()
    const normalized = nextPath ? path.resolve(nextPath) : null
    if (normalized) {
      const stat = await fs.stat(normalized).catch(() => null)
      if (!stat?.isDirectory()) throw new Error(`工作区目录不存在：${normalized}`)
    }

    await this.stopWatcher()
    await this.disposeHandles()
    this.workspacePath = normalized
    if (persist) saveWorkspace(normalized)
    if (normalized) {
      await this.scan()
      this.startWatchers(normalized)
    }
    const overview = this.getOverview()
    this.events.emit('changed', overview)
    return overview
  }

  async refresh(): Promise<WorkspaceOverview> {
    await this.enqueueScan()
    return this.getOverview()
  }

  getOverview(): WorkspaceOverview {
    const allKnowledgeBases = [...this.handles.values()]
      .map(descriptor)
      .sort((left, right) => left.name.localeCompare(right.name))
    const settings = loadSettings()
    const hidden = new Set(settings.hiddenKnowledgeBases)
    const knowledgeBases = allKnowledgeBases.filter((item) => {
      const override = settingsForKnowledgeBase(settings, item.configId)
      return !override.hidden && !hidden.has(item.configId) && !hidden.has(item.name)
    })
    return { path: this.workspacePath, knowledgeBases, allKnowledgeBases }
  }

  getDetail(knowledgeBaseId: string): KnowledgeBaseDetail {
    return toDetail(this.getHandle(knowledgeBaseId))
  }

  async readNote(knowledgeBaseId: string, noteUuid: string): Promise<NoteDocumentDto> {
    const handle = this.getHandle(knowledgeBaseId)
    return toNoteDocument(handle, await handle.workspace.notes.read(noteUuid))
  }

  async saveNote(request: NoteSaveRequest): Promise<NoteMutationDto> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const settings = loadSettings()
    const override = settingsForKnowledgeBase(settings, handle.snapshot.id)
    const result = await handle.workspace.notes.save({
      noteUuid: request.noteUuid,
      content: request.content,
      expectedRevision: request.expectedRevision,
      prettier: request.prettier ?? override.prettier ?? settings.prettier
    })
    return this.noteMutation(handle, result)
  }

  async createNote(request: NoteCreateRequest): Promise<NoteMutationDto> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.notes.create({
      title: request.title,
      placement: request.placement as NotePlacement | undefined,
      expectedSnapshotRevision: request.expectedSnapshotRevision
    })
    return this.noteMutation(handle, result)
  }

  async renameNote(request: NoteRenameRequest): Promise<NoteMutationDto> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.notes.rename({
      noteUuid: request.noteUuid,
      title: request.title,
      expectedRevision: request.expectedRevision
    })
    return this.noteMutation(handle, result)
  }

  async updateNoteConfig(request: NoteUpdateConfigRequest): Promise<NoteMutationDto> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.notes.updateConfig({
      noteUuid: request.noteUuid,
      updates: request.updates,
      expectedRevision: request.expectedRevision
    })
    return this.noteMutation(handle, result)
  }

  async moveToc(request: TocMoveRequest): Promise<KnowledgeBaseDetail> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.toc.move({
      source: coreEntryRef(request.source),
      target: coreEntryRef(request.target),
      placement: request.placement,
      expectedSnapshotRevision: request.expectedSnapshotRevision
    })
    return this.snapshotMutation(handle, result)
  }

  async createTocGroup(request: TocCreateGroupRequest): Promise<KnowledgeBaseDetail> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.toc.createGroup({
      title: request.title,
      placement: request.placement as NotePlacement | undefined,
      expectedSnapshotRevision: request.expectedSnapshotRevision
    })
    return this.snapshotMutation(handle, result)
  }

  async renameTocGroup(request: TocRenameGroupRequest): Promise<KnowledgeBaseDetail> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.toc.renameGroup({
      folderPath: request.folderPath,
      title: request.title,
      expectedSnapshotRevision: request.expectedSnapshotRevision
    })
    return this.snapshotMutation(handle, result)
  }

  async previewDelete(knowledgeBaseId: string, entry: TocEntryRefDto): Promise<DeletePreviewDto> {
    const handle = this.getHandle(knowledgeBaseId)
    const preview = await handle.workspace.toc.previewDelete(coreEntryRef(entry))
    return { knowledgeBaseId, ...preview, entry }
  }

  async deleteToc(request: TocDeleteRequest): Promise<KnowledgeBaseDetail> {
    const handle = this.getHandle(request.knowledgeBaseId)
    const result = await handle.workspace.toc.deleteEntry({
      entry: coreEntryRef(request.entry),
      expectedSnapshotRevision: request.expectedSnapshotRevision
    })
    return this.snapshotMutation(handle, result)
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    await this.stopWatcher()
    await this.disposeHandles()
    this.events.removeAllListeners()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('WorkspaceManager 已释放')
  }

  private getHandle(knowledgeBaseId: string): KnowledgeBaseHandle {
    const handle = this.handles.get(knowledgeBaseId)
    if (!handle) throw new Error(`知识库不存在：${knowledgeBaseId}`)
    return handle
  }

  private async noteMutation(
    handle: KnowledgeBaseHandle,
    result: MutationResult<NoteDocument>
  ): Promise<NoteMutationDto> {
    this.markInternalWrites(result.changedFiles)
    handle.snapshot = await handle.workspace.refresh()
    this.emitChanged()
    return {
      note: toNoteDocument(handle, result.value),
      knowledgeBase: toDetail(handle),
      changedFiles: result.changedFiles
    }
  }

  private snapshotMutation(
    handle: KnowledgeBaseHandle,
    result: MutationResult<KnowledgeBaseSnapshot>
  ): KnowledgeBaseDetail {
    this.markInternalWrites(result.changedFiles)
    handle.snapshot = result.value
    this.emitChanged()
    return toDetail(handle)
  }

  private markInternalWrites(changedFiles: ChangedFile[]): void {
    const until = Date.now() + 1500
    for (const changed of changedFiles) {
      this.internalWriteUntil.set(path.normalize(changed.path), until)
      if (changed.previousPath) {
        this.internalWriteUntil.set(path.normalize(changed.previousPath), until)
      }
    }
  }

  private emitChanged(): void {
    this.events.emit('changed', this.getOverview())
  }

  private async enqueueScan(): Promise<void> {
    this.scanTail = this.scanTail
      .then(() => this.scan())
      .catch((error) => {
        deskLog('workspace', 'scan failed', error instanceof Error ? error.message : String(error))
      })
    await this.scanTail
  }

  private async scan(): Promise<void> {
    if (!this.workspacePath) return
    const entries = await fs.readdir(this.workspacePath, { withFileTypes: true })
    const candidates = entries
      .filter((entry) => entry.isDirectory() && KNOWLEDGE_BASE_NAME.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
    const previousByPath = new Map(
      [...this.handles.values()].map((handle) => [handle.rootPath, handle])
    )
    const next = new Map<string, KnowledgeBaseHandle>()

    for (const candidate of candidates) {
      const rootPath = path.join(this.workspacePath, candidate.name)
      const existing = previousByPath.get(rootPath)
      const workspace = existing?.workspace ?? createWorkspace({ rootPath })
      const snapshot = await workspace.inspect()
      let id = existing?.id ?? snapshot.id
      if (next.has(id)) id = `${snapshot.id}:${stablePathSuffix(rootPath)}`
      next.set(id, {
        id,
        name: candidate.name,
        rootPath,
        workspace,
        snapshot
      })
      previousByPath.delete(rootPath)
    }

    await Promise.all([...previousByPath.values()].map((handle) => handle.workspace.dispose()))
    this.handles = next
    this.syncKnowledgeBaseWatchers()
    deskLog('workspace', 'scan complete', {
      path: this.workspacePath,
      knowledgeBases: next.size
    })
  }

  private startWatchers(workspacePath: string): void {
    this.createWatcher('workspace', workspacePath, false, (_event, fileName) => {
      if (!fileName) return
      const [topLevelName] = fileName.toString().split(path.sep)
      if (topLevelName && KNOWLEDGE_BASE_NAME.test(topLevelName)) {
        this.scheduleRefresh()
      }
    })
    this.syncKnowledgeBaseWatchers()
  }

  private createWatcher(
    key: string,
    targetPath: string,
    recursive: boolean,
    listener: (eventType: 'rename' | 'change', fileName: string | null) => void
  ): void {
    if (this.watchers.has(key)) return
    let watcher: FSWatcher
    try {
      watcher = watch(targetPath, { recursive }, listener)
    } catch (error) {
      this.logWatcherError(error)
      return
    }
    watcher.on('error', (error) => this.logWatcherError(error))
    this.watchers.set(key, watcher)
  }

  private logWatcherError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    const now = Date.now()
    if (message !== this.lastWatcherError || now - this.lastWatcherErrorAt > 5000) {
      this.lastWatcherError = message
      this.lastWatcherErrorAt = now
      deskLog('workspace:watcher', 'error', message)
    }
  }

  private syncKnowledgeBaseWatchers(): void {
    if (!this.workspacePath || !this.watchers.has('workspace')) return
    const expectedKeys = new Set(['workspace'])
    for (const handle of this.handles.values()) {
      const key = `knowledge-base:${handle.rootPath}`
      expectedKeys.add(key)
      this.createWatcher(key, handle.rootPath, true, (_event, fileName) => {
        if (!fileName) return
        const relativePath = fileName.toString()
        if (this.shouldIgnoreKnowledgeBasePath(relativePath)) return
        this.handleWatchedPath(path.join(handle.rootPath, relativePath))
      })
    }

    for (const [key, watcher] of this.watchers) {
      if (!expectedKeys.has(key)) {
        watcher.close()
        this.watchers.delete(key)
      }
    }
  }

  private shouldIgnoreKnowledgeBasePath(relativePath: string): boolean {
    const segments = relativePath.split(path.sep).filter(Boolean)
    return segments.some((segment, index) => {
      if (segment === '.git' || segment === 'node_modules' || segment === 'dist') return true
      return segment === 'cache' && segments[index - 1] === '.vitepress'
    })
  }

  private handleWatchedPath(changedPath: string): void {
    const normalizedPath = path.normalize(changedPath)
    const internalUntil = this.internalWriteUntil.get(normalizedPath) ?? 0
    if (internalUntil < Date.now()) {
      this.internalWriteUntil.delete(normalizedPath)
      if (path.basename(normalizedPath) === 'README.md') {
        for (const handle of this.handles.values()) {
          const note = handle.snapshot.notes.find(
            (item) => path.normalize(item.readmePath) === normalizedPath
          )
          if (note) {
            this.events.emit('noteExternalChanged', {
              knowledgeBaseId: handle.id,
              noteUuid: note.uuid
            })
            break
          }
        }
      }
    }

    this.scheduleRefresh()
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.enqueueScan().then(() => this.emitChanged())
    }, 250)
  }

  private async stopWatcher(): Promise<void> {
    for (const watcher of this.watchers.values()) watcher.close()
    this.watchers.clear()
  }

  private async disposeHandles(): Promise<void> {
    await Promise.all([...this.handles.values()].map((handle) => handle.workspace.dispose()))
    this.handles.clear()
  }
}

export const workspaceManager = new WorkspaceManager()
