import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'

import { deskLog } from './log'
import { loadSettings, settingsForKnowledgeBase } from './settings'
import { loadWorkspace, saveWorkspace } from './workspace'
import { descriptor, toDetail } from './workspace/dto'
import * as noteIo from './workspace/noteIo'
import {
  disposeHandles,
  enqueueScan,
  markInternalWrites,
  scan,
  startWatchers,
  stopWatcher,
  type WorkspaceScanState
} from './workspace/scan'
import * as toc from './workspace/toc'
import type {
  GitRepositoryDescriptor,
  KnowledgeBaseHandle,
  WorkspaceManagerEvents
} from './workspace/types'

import type { SearchIndexDocument } from './searchModel'
import type { ChangedFile } from '@tnotesjs/core/workspace'
import type {
  DeletePreviewDto,
  AttachmentWriteLocalRequest,
  AttachmentWriteLocalResult,
  AttachmentReadTextRequest,
  AttachmentWriteTextRequest,
  ExternalNoteChangeEvent,
  ExternalNoteFileChangeEvent,
  KnowledgeBaseDetail,
  NoteCreateRequest,
  NoteDocumentDto,
  NoteFileEntryDto,
  NoteFileReadTextRequest,
  NoteFileSaveTextRequest,
  NoteFilesListRequest,
  NoteTextFileDto,
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

export type { GitRepositoryDescriptor } from './workspace/types'

export class WorkspaceManager {
  private readonly events = new EventEmitter<WorkspaceManagerEvents>()
  private disposed = false
  private readonly scanState: WorkspaceScanState = {
    handles: new Map(),
    workspacePath: null,
    watchers: new Map(),
    refreshTimer: null,
    scanTail: Promise.resolve(),
    internalWriteUntil: new Map(),
    lastWatcherError: '',
    lastWatcherErrorAt: 0,
    events: this.events,
    emitChanged: () => this.emitChanged()
  }

  private mutationEffects(): {
    markInternalWrites: (changedFiles: ChangedFile[]) => void
    emitChanged: () => void
  } {
    return {
      markInternalWrites: (changedFiles: ChangedFile[]) =>
        markInternalWrites(this.scanState, changedFiles),
      emitChanged: () => this.emitChanged()
    }
  }

  onChanged(listener: (overview: WorkspaceOverview) => void): () => void {
    this.events.on('changed', listener)
    return () => this.events.off('changed', listener)
  }

  onNoteExternalChanged(listener: (event: ExternalNoteChangeEvent) => void): () => void {
    this.events.on('noteExternalChanged', listener)
    return () => this.events.off('noteExternalChanged', listener)
  }

  onNoteFileExternalChanged(listener: (event: ExternalNoteFileChangeEvent) => void): () => void {
    this.events.on('noteFileExternalChanged', listener)
    return () => this.events.off('noteFileExternalChanged', listener)
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

    await stopWatcher(this.scanState)
    await disposeHandles(this.scanState)
    this.scanState.workspacePath = normalized
    if (persist) saveWorkspace(normalized)
    if (normalized) {
      await scan(this.scanState)
      startWatchers(this.scanState, normalized)
    }
    const overview = this.getOverview()
    this.events.emit('changed', overview)
    return overview
  }

  async refresh(): Promise<WorkspaceOverview> {
    await enqueueScan(this.scanState)
    return this.getOverview()
  }

  getOverview(): WorkspaceOverview {
    const allKnowledgeBases = [...this.scanState.handles.values()]
      .map(descriptor)
      .sort((left, right) => left.name.localeCompare(right.name))
    const settings = loadSettings()
    const hidden = new Set(settings.hiddenKnowledgeBases)
    const knowledgeBases = allKnowledgeBases.filter((item) => {
      const override = settingsForKnowledgeBase(settings, item.configId)
      return !override.hidden && !hidden.has(item.configId) && !hidden.has(item.name)
    })
    return { path: this.scanState.workspacePath, knowledgeBases, allKnowledgeBases }
  }

  getDetail(knowledgeBaseId: string): KnowledgeBaseDetail {
    return toDetail(this.getHandle(knowledgeBaseId))
  }

  getLocation(knowledgeBaseId: string): { name: string; rootPath: string } {
    const handle = this.getHandle(knowledgeBaseId)
    return { name: handle.name, rootPath: handle.rootPath }
  }

  getNoteLocation(knowledgeBaseId: string, noteUuid: string): string {
    const handle = this.getHandle(knowledgeBaseId)
    const note = handle.snapshot.notes.find((item) => item.uuid === noteUuid)
    if (!note) throw new Error(`笔记不存在：${noteUuid}`)
    return note.directoryPath
  }

  getGitRepositories(): GitRepositoryDescriptor[] {
    return [...this.scanState.handles.values()].map((handle) => ({
      knowledgeBaseId: handle.id,
      knowledgeBaseName: handle.name,
      configId: handle.snapshot.id,
      rootPath: handle.rootPath,
      notes: handle.snapshot.notes.map((note) => ({
        uuid: note.uuid,
        index: note.index,
        title: note.title,
        dirName: note.dirName,
        directoryPath: note.directoryPath
      }))
    }))
  }

  async getSearchDocuments(): Promise<SearchIndexDocument[]> {
    const pending = [...this.scanState.handles.values()].flatMap((handle) =>
      handle.snapshot.notes.map((note) => ({ handle, note }))
    )
    const documents: SearchIndexDocument[] = []
    let cursor = 0
    const readNext = async (): Promise<void> => {
      while (cursor < pending.length) {
        const current = pending[cursor]
        cursor += 1
        try {
          const content = await fs.readFile(current.note.readmePath, 'utf8')
          documents.push({
            id: `${current.handle.id}:${current.note.uuid}`,
            knowledgeBaseId: current.handle.id,
            knowledgeBaseName: current.handle.name,
            noteUuid: current.note.uuid,
            noteIndex: current.note.index,
            title: current.note.title,
            content,
            revision: createHash('sha256').update(content).digest('hex')
          })
        } catch (error) {
          deskLog('search', 'note skipped', {
            path: current.note.readmePath,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(12, pending.length) }, () => readNext()))
    return documents.sort((left, right) => left.id.localeCompare(right.id))
  }

  async readNote(knowledgeBaseId: string, noteUuid: string): Promise<NoteDocumentDto> {
    return noteIo.readNote(this.getHandle(knowledgeBaseId), noteUuid)
  }

  /**
   * Resolve NotesTable ids against the current knowledge-base snapshot
   * (title + `.tnotes.json` description), same data VitePress notesConfig uses.
   */
  resolveNotesTable(
    knowledgeBaseId: string,
    ids: string[]
  ): {
    notes: Array<{
      id: string
      title: string
      description: string
      noteUuid: string | null
    }>
    missingIds: string[]
  } {
    return noteIo.resolveNotesTable(this.getHandle(knowledgeBaseId), ids)
  }

  async saveNote(request: NoteSaveRequest): Promise<NoteMutationDto> {
    return noteIo.saveNote(this.getHandle(request.knowledgeBaseId), request, this.mutationEffects())
  }

  async createNote(request: NoteCreateRequest): Promise<NoteMutationDto> {
    return noteIo.createNote(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async renameNote(request: NoteRenameRequest): Promise<NoteMutationDto> {
    return noteIo.renameNote(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async updateNoteConfig(request: NoteUpdateConfigRequest): Promise<NoteMutationDto> {
    return noteIo.updateNoteConfig(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async writeLocalAttachment(
    request: AttachmentWriteLocalRequest
  ): Promise<AttachmentWriteLocalResult> {
    return noteIo.writeLocalAttachment(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async resolveNoteAsset(
    knowledgeBaseId: string,
    noteUuid: string,
    requestedPath: string
  ): Promise<string> {
    return noteIo.resolveNoteAsset(this.getHandle(knowledgeBaseId), noteUuid, requestedPath)
  }

  async readNoteTextAsset(request: AttachmentReadTextRequest): Promise<string> {
    return noteIo.readNoteTextAsset(this.getHandle(request.knowledgeBaseId), request)
  }

  async writeNoteTextAsset(request: AttachmentWriteTextRequest): Promise<void> {
    return noteIo.writeNoteTextAsset(
      this.getHandle(request.knowledgeBaseId),
      request,
      (changedFiles) => markInternalWrites(this.scanState, changedFiles)
    )
  }

  async listNoteFiles(request: NoteFilesListRequest): Promise<NoteFileEntryDto[]> {
    return noteIo.listNoteFiles(this.getHandle(request.knowledgeBaseId), request)
  }

  async readNoteTextFile(request: NoteFileReadTextRequest): Promise<NoteTextFileDto> {
    return noteIo.readNoteTextFile(this.getHandle(request.knowledgeBaseId), request)
  }

  async saveNoteTextFile(request: NoteFileSaveTextRequest): Promise<NoteTextFileDto> {
    return noteIo.saveNoteTextFile(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async moveToc(request: TocMoveRequest): Promise<KnowledgeBaseDetail> {
    return toc.moveToc(this.getHandle(request.knowledgeBaseId), request, this.mutationEffects())
  }

  async createTocGroup(request: TocCreateGroupRequest): Promise<KnowledgeBaseDetail> {
    return toc.createTocGroup(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async renameTocGroup(request: TocRenameGroupRequest): Promise<KnowledgeBaseDetail> {
    return toc.renameTocGroup(
      this.getHandle(request.knowledgeBaseId),
      request,
      this.mutationEffects()
    )
  }

  async previewDelete(knowledgeBaseId: string, entry: TocEntryRefDto): Promise<DeletePreviewDto> {
    return toc.previewDelete(this.getHandle(knowledgeBaseId), knowledgeBaseId, entry)
  }

  async deleteToc(request: TocDeleteRequest): Promise<KnowledgeBaseDetail> {
    return toc.deleteToc(this.getHandle(request.knowledgeBaseId), request, this.mutationEffects())
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.scanState.refreshTimer) clearTimeout(this.scanState.refreshTimer)
    await stopWatcher(this.scanState)
    await disposeHandles(this.scanState)
    this.events.removeAllListeners()
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('WorkspaceManager 已释放')
  }

  private getHandle(knowledgeBaseId: string): KnowledgeBaseHandle {
    const handle = this.scanState.handles.get(knowledgeBaseId)
    if (!handle) throw new Error(`知识库不存在：${knowledgeBaseId}`)
    return handle
  }

  private emitChanged(): void {
    this.events.emit('changed', this.getOverview())
  }
}

export const workspaceManager = new WorkspaceManager()
