import type { Ref } from 'vue'

import type { useEditorStore } from '../editor'

import type {
  AppSettings,
  KnowledgeBaseDescriptor,
  NoteFileEntryDto,
  RecoveryRecord
} from '../../../../shared/contracts'

import { noteFileKey, resultValue, type NoteFileSession } from './helpers'

interface NoteFilesContext {
  editor: ReturnType<typeof useEditorStore>
  noteFiles: Ref<Record<string, NoteFileSession>>
  pendingRecoveries: Ref<RecoveryRecord[]>
  settings: Ref<AppSettings | null>
  error: Ref<string | null>
  status: Ref<string | null>
  autosaveTimers: Map<string, ReturnType<typeof setTimeout>>
  recoveryTimers: Map<string, ReturnType<typeof setTimeout>>
  descriptors: Ref<KnowledgeBaseDescriptor[]>
  selectKnowledgeBase: (knowledgeBaseId: string) => Promise<void>
}

export function createNoteFiles(ctx: NoteFilesContext) {
  function setSession(key: string, session: NoteFileSession): void {
    ctx.noteFiles.value = { ...ctx.noteFiles.value, [key]: session }
  }

  function removeSession(key: string): void {
    const next = { ...ctx.noteFiles.value }
    delete next[key]
    ctx.noteFiles.value = next
    const autosave = ctx.autosaveTimers.get(key)
    if (autosave) clearTimeout(autosave)
    ctx.autosaveTimers.delete(key)
    const recovery = ctx.recoveryTimers.get(key)
    if (recovery) clearTimeout(recovery)
    ctx.recoveryTimers.delete(key)
  }

  function deleteRecovery(knowledgeBaseId: string, noteUuid: string, path: string): void {
    void window.desk.recovery.delete({ knowledgeBaseId, noteUuid, path })
  }

  async function persistRecovery(key: string, noteTitle?: string): Promise<void> {
    const session = ctx.noteFiles.value[key]
    if (!session?.dirty) return
    const result = await window.desk.recovery.write({
      knowledgeBaseId: session.document.knowledgeBaseId,
      noteUuid: session.document.noteUuid,
      path: session.document.path,
      title: noteTitle ?? session.document.path,
      content: session.content,
      revision: session.document.revision
    })
    if (!result.ok) ctx.error.value = `无法保存恢复快照：${result.error.message}`
  }

  async function listNoteFiles(
    knowledgeBaseId: string,
    noteUuid: string,
    directory?: string
  ): Promise<NoteFileEntryDto[]> {
    return resultValue(await window.desk.noteFiles.list({ knowledgeBaseId, noteUuid, directory }))
  }

  async function ensureNoteFile(
    knowledgeBaseId: string,
    noteUuid: string,
    path: string
  ): Promise<NoteFileSession> {
    const key = noteFileKey(knowledgeBaseId, noteUuid, path)
    const existing = ctx.noteFiles.value[key]
    if (existing) return existing
    const document = resultValue(
      await window.desk.noteFiles.readText({ knowledgeBaseId, noteUuid, path })
    )
    const session: NoteFileSession = {
      document,
      content: document.content,
      dirty: false,
      externalConflict: false,
      saving: false
    }
    setSession(key, session)
    return session
  }

  function updateNoteFileContent(key: string, content: string, noteTitle?: string): void {
    const session = ctx.noteFiles.value[key]
    if (!session || session.document.readOnly) return
    const dirty = content !== session.document.content
    setSession(key, { ...session, content, dirty, externalConflict: false })
    ctx.editor.setNoteFileDirty(
      session.document.knowledgeBaseId,
      session.document.noteUuid,
      session.document.path,
      dirty
    )
    const autosave = ctx.autosaveTimers.get(key)
    if (autosave) clearTimeout(autosave)
    ctx.autosaveTimers.delete(key)
    const recovery = ctx.recoveryTimers.get(key)
    if (recovery) clearTimeout(recovery)
    ctx.recoveryTimers.delete(key)
    if (!dirty) {
      deleteRecovery(
        session.document.knowledgeBaseId,
        session.document.noteUuid,
        session.document.path
      )
      return
    }
    ctx.recoveryTimers.set(
      key,
      setTimeout(() => {
        ctx.recoveryTimers.delete(key)
        void persistRecovery(key, noteTitle)
      }, 250)
    )
    if (ctx.settings.value?.autosave.enabled) {
      ctx.autosaveTimers.set(
        key,
        setTimeout(() => {
          ctx.autosaveTimers.delete(key)
          void saveNoteFile(key).catch(() => undefined)
        }, ctx.settings.value.autosave.delayMs)
      )
    }
  }

  async function saveNoteFile(key: string): Promise<void> {
    const session = ctx.noteFiles.value[key]
    if (!session || !session.dirty || session.document.readOnly || session.saving) return
    const contentToSave = session.content
    setSession(key, { ...session, saving: true })
    const recoveryTimer = ctx.recoveryTimers.get(key)
    if (recoveryTimer) clearTimeout(recoveryTimer)
    ctx.recoveryTimers.delete(key)
    try {
      const document = resultValue(
        await window.desk.noteFiles.saveText({
          knowledgeBaseId: session.document.knowledgeBaseId,
          noteUuid: session.document.noteUuid,
          path: session.document.path,
          content: contentToSave,
          expectedRevision: session.document.revision
        })
      )
      const current = ctx.noteFiles.value[key]
      const content = current?.content ?? contentToSave
      const dirty = content !== document.content
      setSession(key, {
        document,
        content,
        dirty,
        externalConflict: false,
        saving: false
      })
      ctx.editor.setNoteFileDirty(document.knowledgeBaseId, document.noteUuid, document.path, dirty)
      if (!dirty) {
        deleteRecovery(document.knowledgeBaseId, document.noteUuid, document.path)
        ctx.status.value = `已保存 ${document.path}`
      } else if (ctx.settings.value?.autosave.enabled) {
        ctx.autosaveTimers.set(
          key,
          setTimeout(() => {
            ctx.autosaveTimers.delete(key)
            void saveNoteFile(key).catch(() => undefined)
          }, ctx.settings.value.autosave.delayMs)
        )
      }
    } catch (cause) {
      const current = ctx.noteFiles.value[key] ?? session
      setSession(key, {
        ...current,
        saving: false,
        externalConflict:
          current.externalConflict || (cause as { code?: string }).code === 'REVISION_CONFLICT'
      })
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async function reloadNoteFile(key: string): Promise<void> {
    const session = ctx.noteFiles.value[key]
    if (!session) return
    const document = resultValue(
      await window.desk.noteFiles.readText({
        knowledgeBaseId: session.document.knowledgeBaseId,
        noteUuid: session.document.noteUuid,
        path: session.document.path
      })
    )
    setSession(key, {
      document,
      content: document.content,
      dirty: false,
      externalConflict: false,
      saving: false
    })
    ctx.editor.setNoteFileDirty(document.knowledgeBaseId, document.noteUuid, document.path, false)
    deleteRecovery(document.knowledgeBaseId, document.noteUuid, document.path)
  }

  async function keepNoteFileAgainstDisk(key: string): Promise<void> {
    const session = ctx.noteFiles.value[key]
    if (!session) return
    const document = resultValue(
      await window.desk.noteFiles.readText({
        knowledgeBaseId: session.document.knowledgeBaseId,
        noteUuid: session.document.noteUuid,
        path: session.document.path
      })
    )
    const dirty = session.content !== document.content
    setSession(key, {
      document,
      content: session.content,
      dirty,
      externalConflict: false,
      saving: false
    })
    ctx.editor.setNoteFileDirty(document.knowledgeBaseId, document.noteUuid, document.path, dirty)
    if (!dirty) deleteRecovery(document.knowledgeBaseId, document.noteUuid, document.path)
  }

  async function saveAllNoteFiles(): Promise<void> {
    for (const [key, session] of Object.entries(ctx.noteFiles.value)) {
      if (session.dirty) await saveNoteFile(key)
    }
  }

  async function prepareFileRecoveries(records: RecoveryRecord[]): Promise<void> {
    const candidates: RecoveryRecord[] = []
    for (const record of records.filter((item) => item.path)) {
      try {
        const disk = resultValue(
          await window.desk.noteFiles.readText({
            knowledgeBaseId: record.knowledgeBaseId,
            noteUuid: record.noteUuid,
            path: record.path!
          })
        )
        if (disk.content === record.content) {
          deleteRecovery(record.knowledgeBaseId, record.noteUuid, record.path!)
        } else {
          candidates.push(record)
        }
      } catch {
        deleteRecovery(record.knowledgeBaseId, record.noteUuid, record.path!)
      }
    }
    ctx.pendingRecoveries.value.push(...candidates)
  }

  async function acceptFileRecovery(record: RecoveryRecord): Promise<void> {
    if (!record.path) return
    const session = await ensureNoteFile(record.knowledgeBaseId, record.noteUuid, record.path)
    const key = noteFileKey(record.knowledgeBaseId, record.noteUuid, record.path)
    setSession(key, {
      ...session,
      content: record.content,
      dirty: record.content !== session.document.content,
      externalConflict: false
    })
    ctx.editor.setNoteFileDirty(
      record.knowledgeBaseId,
      record.noteUuid,
      record.path,
      record.content !== session.document.content
    )
    const descriptor = ctx.descriptors.value.find((item) => item.id === record.knowledgeBaseId)
    if (descriptor) {
      ctx.editor.openNoteFile(descriptor, record.noteUuid, record.title, record.path, 'text')
      await ctx.selectKnowledgeBase(record.knowledgeBaseId)
    }
    ctx.pendingRecoveries.value = ctx.pendingRecoveries.value.filter((item) => item !== record)
    await persistRecovery(key, record.title)
  }

  function discardFileRecovery(record: RecoveryRecord): void {
    if (!record.path) return
    deleteRecovery(record.knowledgeBaseId, record.noteUuid, record.path)
    ctx.pendingRecoveries.value = ctx.pendingRecoveries.value.filter((item) => item !== record)
  }

  function getNoteFileSession(
    knowledgeBaseId: string,
    noteUuid: string,
    path: string
  ): NoteFileSession | null {
    return ctx.noteFiles.value[noteFileKey(knowledgeBaseId, noteUuid, path)] ?? null
  }

  return {
    listNoteFiles,
    ensureNoteFile,
    updateNoteFileContent,
    saveNoteFile,
    saveAllNoteFiles,
    reloadNoteFile,
    keepNoteFileAgainstDisk,
    prepareFileRecoveries,
    acceptFileRecovery,
    discardFileRecovery,
    getNoteFileSession,
    persistFileRecovery: persistRecovery,
    removeNoteFileSession: removeSession
  }
}
