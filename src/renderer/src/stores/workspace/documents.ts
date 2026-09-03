import type { ComputedRef, Ref } from 'vue'

import type { useEditorStore } from '../editor'

import type {
  AppSettings,
  AttachmentWriteLocalResult,
  ImageUploadResult,
  KnowledgeBaseDetail,
  NoteEditorTab,
  RecoveryRecord,
  WorkspaceOverview
} from '../../../../shared/contracts'

import { documentKey, resultValue, type DocumentSession } from './helpers'

export interface DocumentsContext {
  editor: ReturnType<typeof useEditorStore>
  documents: Ref<Record<string, DocumentSession>>
  pendingRecoveries: Ref<RecoveryRecord[]>
  overview: Ref<WorkspaceOverview>
  settings: Ref<AppSettings | null>
  error: Ref<string | null>
  status: Ref<string | null>
  activeDocumentKey: ComputedRef<string | null>
  autosaveTimers: Map<string, ReturnType<typeof setTimeout>>
  recoveryTimers: Map<string, ReturnType<typeof setTimeout>>
  setDocumentSession: (key: string, session: DocumentSession) => void
  removeDocumentSession: (key: string) => void
  applyDetail: (detail: KnowledgeBaseDetail) => void
  selectKnowledgeBase: (knowledgeBaseId: string) => Promise<void>
}

export function createDocuments(ctx: DocumentsContext) {
  function deleteRecovery(knowledgeBaseId: string, noteUuid: string): void {
    void window.desk.recovery.delete({ knowledgeBaseId, noteUuid })
  }

  async function persistRecovery(key: string): Promise<void> {
    const session = ctx.documents.value[key]
    if (!session?.dirty) return
    const result = await window.desk.recovery.write({
      knowledgeBaseId: session.document.knowledgeBaseId,
      noteUuid: session.document.uuid,
      title: session.document.title,
      content: session.content,
      revision: session.document.revision
    })
    if (!result.ok) ctx.error.value = `无法保存恢复快照：${result.error.message}`
  }

  async function prepareRecoveries(records: RecoveryRecord[]): Promise<void> {
    const candidates: RecoveryRecord[] = []
    for (const record of records.filter((item) => !item.path)) {
      try {
        const disk = resultValue(
          await window.desk.notes.read(record.knowledgeBaseId, record.noteUuid)
        )
        if (disk.content === record.content) {
          deleteRecovery(record.knowledgeBaseId, record.noteUuid)
        } else {
          candidates.push(record)
        }
      } catch {
        deleteRecovery(record.knowledgeBaseId, record.noteUuid)
      }
    }
    ctx.pendingRecoveries.value = candidates
  }

  async function ensureDocument(
    knowledgeBaseId: string,
    noteUuid: string
  ): Promise<DocumentSession> {
    const key = documentKey(knowledgeBaseId, noteUuid)
    const existing = ctx.documents.value[key]
    if (existing) return existing
    const next = resultValue(await window.desk.notes.read(knowledgeBaseId, noteUuid))
    const session: DocumentSession = {
      document: next,
      content: next.content,
      dirty: false,
      preserveSourceOnSave: false,
      externalConflict: false,
      saving: false
    }
    ctx.setDocumentSession(key, session)
    return session
  }

  function updateDocumentContent(key: string, content: string, preserveSource = false): void {
    const session = ctx.documents.value[key]
    if (!session || session.document.readOnly) return
    const dirty = content !== session.document.content
    const preserveSourceOnSave = dirty
      ? session.preserveSourceOnSave || preserveSource
      : session.saving
        ? session.preserveSourceOnSave || preserveSource
        : false
    ctx.setDocumentSession(key, {
      ...session,
      content,
      dirty,
      preserveSourceOnSave,
      externalConflict: false
    })
    ctx.editor.setNoteDirty(session.document.knowledgeBaseId, session.document.uuid, dirty)
    const currentTimer = ctx.autosaveTimers.get(key)
    if (currentTimer) clearTimeout(currentTimer)
    ctx.autosaveTimers.delete(key)
    const currentRecoveryTimer = ctx.recoveryTimers.get(key)
    if (currentRecoveryTimer) clearTimeout(currentRecoveryTimer)
    ctx.recoveryTimers.delete(key)
    if (dirty) {
      ctx.recoveryTimers.set(
        key,
        setTimeout(() => {
          ctx.recoveryTimers.delete(key)
          void persistRecovery(key)
        }, 250)
      )
    } else {
      deleteRecovery(session.document.knowledgeBaseId, session.document.uuid)
    }
    if (dirty && ctx.settings.value?.autosave.enabled) {
      const timer = setTimeout(() => {
        ctx.autosaveTimers.delete(key)
        void saveDocument(key).catch(() => undefined)
      }, ctx.settings.value.autosave.delayMs)
      ctx.autosaveTimers.set(key, timer)
    }
  }

  function updateEditorContent(content: string): void {
    if (ctx.activeDocumentKey.value) updateDocumentContent(ctx.activeDocumentKey.value, content)
  }

  async function saveDocument(key: string): Promise<void> {
    const session = ctx.documents.value[key]
    if (!session || !session.dirty || session.document.readOnly || session.saving) return
    const contentToSave = session.content
    ctx.setDocumentSession(key, { ...session, saving: true })
    const recoveryTimer = ctx.recoveryTimers.get(key)
    if (recoveryTimer) clearTimeout(recoveryTimer)
    ctx.recoveryTimers.delete(key)
    ctx.error.value = null
    try {
      const mutation = resultValue(
        await window.desk.notes.save({
          knowledgeBaseId: session.document.knowledgeBaseId,
          noteUuid: session.document.uuid,
          content: contentToSave,
          expectedRevision: session.document.revision,
          // Core still owns generated title/TOC updates. Only visual edits opt
          // out of whole-document Prettier so unrelated source remains intact.
          ...(session.preserveSourceOnSave ? { prettier: false } : {})
        })
      )
      const current = ctx.documents.value[key]
      const changedWhileSaving = Boolean(current && current.content !== contentToSave)
      if (changedWhileSaving && current) {
        const stillDirty = current.content !== mutation.note.content
        ctx.setDocumentSession(key, {
          document: mutation.note,
          content: current.content,
          dirty: stillDirty,
          preserveSourceOnSave: stillDirty && current.preserveSourceOnSave,
          externalConflict: false,
          saving: false
        })
        ctx.editor.setNoteDirty(mutation.note.knowledgeBaseId, mutation.note.uuid, stillDirty)
      } else {
        ctx.setDocumentSession(key, {
          document: mutation.note,
          content: mutation.note.content,
          dirty: false,
          preserveSourceOnSave: false,
          externalConflict: false,
          saving: false
        })
        ctx.editor.setNoteDirty(mutation.note.knowledgeBaseId, mutation.note.uuid, false)
      }
      ctx.applyDetail(mutation.knowledgeBase)
      const remaining = ctx.documents.value[key]
      if (!remaining?.dirty) {
        deleteRecovery(mutation.note.knowledgeBaseId, mutation.note.uuid)
        ctx.status.value = '已保存'
      } else {
        ctx.status.value = '已保存先前修改，仍有未保存内容'
        if (ctx.settings.value?.autosave.enabled && !ctx.autosaveTimers.has(key)) {
          ctx.autosaveTimers.set(
            key,
            setTimeout(() => {
              ctx.autosaveTimers.delete(key)
              void saveDocument(key).catch(() => undefined)
            }, ctx.settings.value.autosave.delayMs)
          )
        }
      }
    } catch (cause) {
      const current = ctx.documents.value[key] ?? session
      const isConflict = (cause as { code?: string }).code === 'REVISION_CONFLICT'
      ctx.setDocumentSession(key, {
        ...current,
        saving: false,
        externalConflict: current.externalConflict || isConflict
      })
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async function writeLocalAttachment(
    knowledgeBaseId: string,
    noteUuid: string,
    file: File
  ): Promise<AttachmentWriteLocalResult> {
    const data = new Uint8Array(await file.arrayBuffer())
    return resultValue(
      await window.desk.attachments.writeLocal({
        knowledgeBaseId,
        noteUuid,
        fileName: file.name || `image-${Date.now()}.png`,
        data
      })
    )
  }

  async function uploadImage(
    knowledgeBaseId: string,
    noteUuid: string,
    file: File
  ): Promise<ImageUploadResult> {
    const data = new Uint8Array(await file.arrayBuffer())
    const result = resultValue(
      await window.desk.attachments.uploadImage({
        knowledgeBaseId,
        noteUuid,
        fileName: file.name || `image-${Date.now()}.png`,
        data
      })
    )
    ctx.status.value =
      result.warning ??
      (result.target === 'github' ? '图片已上传到 GitHub 图床' : '图片已保存到本地 assets')
    return result
  }

  async function copyNoteDirectoryPath(
    tab: Pick<NoteEditorTab, 'knowledgeBaseId' | 'noteUuid'>
  ): Promise<void> {
    const result = await window.desk.notes.copyDirectoryPath(tab.knowledgeBaseId, tab.noteUuid)
    if (!result.ok) {
      ctx.error.value = result.error.message
      return
    }
    ctx.status.value = `已复制路径：${result.value}`
  }

  async function revealNoteInFileManager(
    tab: Pick<NoteEditorTab, 'knowledgeBaseId' | 'noteUuid'>
  ): Promise<void> {
    const result = await window.desk.notes.revealInFileManager(tab.knowledgeBaseId, tab.noteUuid)
    if (!result.ok) ctx.error.value = result.error.message
  }

  async function saveCurrentDocument(): Promise<void> {
    if (ctx.activeDocumentKey.value) await saveDocument(ctx.activeDocumentKey.value)
  }

  async function saveAllDocuments(): Promise<void> {
    for (const [key, session] of Object.entries(ctx.documents.value)) {
      if (session.dirty) await saveDocument(key)
    }
  }

  async function reloadDocument(key: string): Promise<void> {
    const session = ctx.documents.value[key]
    if (!session) return
    const next = resultValue(
      await window.desk.notes.read(session.document.knowledgeBaseId, session.document.uuid)
    )
    ctx.setDocumentSession(key, {
      document: next,
      content: next.content,
      dirty: false,
      preserveSourceOnSave: false,
      externalConflict: false,
      saving: false
    })
    ctx.editor.setNoteDirty(next.knowledgeBaseId, next.uuid, false)
    deleteRecovery(next.knowledgeBaseId, next.uuid)
  }

  async function acceptRecovery(record: RecoveryRecord): Promise<void> {
    const loaded = await ensureDocument(record.knowledgeBaseId, record.noteUuid)
    const key = documentKey(record.knowledgeBaseId, record.noteUuid)
    ctx.setDocumentSession(key, {
      ...loaded,
      content: record.content,
      dirty: record.content !== loaded.document.content,
      preserveSourceOnSave: record.content !== loaded.document.content,
      externalConflict: false
    })
    ctx.editor.setNoteDirty(
      record.knowledgeBaseId,
      record.noteUuid,
      record.content !== loaded.document.content
    )
    const descriptor = ctx.overview.value.allKnowledgeBases.find(
      (item) => item.id === record.knowledgeBaseId
    )
    if (descriptor) {
      ctx.editor.openNote(
        descriptor,
        record.noteUuid,
        record.title,
        ctx.settings.value?.defaultNoteView ?? 'visual',
        undefined,
        'permanent'
      )
      await ctx.selectKnowledgeBase(record.knowledgeBaseId)
    }
    ctx.pendingRecoveries.value = ctx.pendingRecoveries.value.filter(
      (candidate) =>
        candidate.knowledgeBaseId !== record.knowledgeBaseId ||
        candidate.noteUuid !== record.noteUuid
    )
    await persistRecovery(key)
  }

  function discardRecovery(record: RecoveryRecord): void {
    deleteRecovery(record.knowledgeBaseId, record.noteUuid)
    ctx.pendingRecoveries.value = ctx.pendingRecoveries.value.filter(
      (candidate) =>
        candidate.knowledgeBaseId !== record.knowledgeBaseId ||
        candidate.noteUuid !== record.noteUuid
    )
  }

  async function reloadCurrentDocument(): Promise<void> {
    if (ctx.activeDocumentKey.value) await reloadDocument(ctx.activeDocumentKey.value)
  }

  async function keepEditorAgainstDisk(): Promise<void> {
    const key = ctx.activeDocumentKey.value
    if (!key) return
    const session = ctx.documents.value[key]
    if (!session) return
    const next = resultValue(
      await window.desk.notes.read(session.document.knowledgeBaseId, session.document.uuid)
    )
    ctx.setDocumentSession(key, {
      document: next,
      content: session.content,
      dirty: session.content !== next.content,
      preserveSourceOnSave: session.content !== next.content && session.preserveSourceOnSave,
      externalConflict: false,
      saving: false
    })
  }

  function getDocumentSession(knowledgeBaseId: string, noteUuid: string): DocumentSession | null {
    return ctx.documents.value[documentKey(knowledgeBaseId, noteUuid)] ?? null
  }

  return {
    deleteRecovery,
    persistRecovery,
    prepareRecoveries,
    ensureDocument,
    updateDocumentContent,
    updateEditorContent,
    saveDocument,
    writeLocalAttachment,
    uploadImage,
    copyNoteDirectoryPath,
    revealNoteInFileManager,
    saveCurrentDocument,
    saveAllDocuments,
    reloadDocument,
    acceptRecovery,
    discardRecovery,
    reloadCurrentDocument,
    keepEditorAgainstDisk,
    getDocumentSession
  }
}

export type DocumentsApi = ReturnType<typeof createDocuments>
