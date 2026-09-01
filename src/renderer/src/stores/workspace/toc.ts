import type { Ref } from 'vue'

import type { useEditorStore } from '../editor'

import type {
  AppSettings,
  DeletePreviewDto,
  DeskTocNode,
  KnowledgeBaseDetail,
  NoteCreateRequest
} from '../../../../shared/contracts'

import {
  documentKey,
  ipcPlain,
  notePlacement,
  resultValue,
  tocEntry,
  type DocumentSession
} from './helpers'

export interface TocContext {
  editor: ReturnType<typeof useEditorStore>
  knowledgeBase: Ref<KnowledgeBaseDetail | null>
  documents: Ref<Record<string, DocumentSession>>
  settings: Ref<AppSettings | null>
  error: Ref<string | null>
  status: Ref<string | null>
  applyDetail: (detail: KnowledgeBaseDetail) => void
  setDocumentSession: (key: string, session: DocumentSession) => void
  removeDocumentSession: (key: string) => void
  ensureDocument: (knowledgeBaseId: string, noteUuid: string) => Promise<DocumentSession>
  saveDocument: (key: string) => Promise<void>
  deleteRecovery: (knowledgeBaseId: string, noteUuid: string) => void
}

export function createToc(ctx: TocContext) {
  async function createNote(
    title: string,
    placement: NoteCreateRequest['placement'] = { type: 'root', placement: 'end' }
  ): Promise<void> {
    if (!ctx.knowledgeBase.value || ctx.knowledgeBase.value.health !== 'ready') return
    const mutation = resultValue(
      await window.desk.notes.create(
        ipcPlain({
          knowledgeBaseId: ctx.knowledgeBase.value.id,
          title,
          placement: notePlacement(placement),
          expectedSnapshotRevision: ctx.knowledgeBase.value.snapshotRevision
        })
      )
    )
    ctx.applyDetail(mutation.knowledgeBase)
    const key = documentKey(mutation.note.knowledgeBaseId, mutation.note.uuid)
    ctx.setDocumentSession(key, {
      document: mutation.note,
      content: mutation.note.content,
      dirty: false,
      preserveSourceOnSave: false,
      externalConflict: false,
      saving: false
    })
    ctx.editor.openNote(
      mutation.knowledgeBase,
      mutation.note.uuid,
      mutation.note.title,
      ctx.settings.value?.defaultNoteView ?? 'visual',
      undefined,
      'permanent'
    )
  }

  async function createTocGroup(title: string): Promise<void> {
    if (!ctx.knowledgeBase.value || ctx.knowledgeBase.value.health !== 'ready') return
    try {
      const detail = resultValue(
        await window.desk.toc.createGroup(
          ipcPlain({
            knowledgeBaseId: ctx.knowledgeBase.value.id,
            title,
            placement: { type: 'root', placement: 'end' },
            expectedSnapshotRevision: ctx.knowledgeBase.value.snapshotRevision
          })
        )
      )
      ctx.applyDetail(detail)
      ctx.status.value = '分组已创建'
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async function renameTocNode(node: DeskTocNode, title: string): Promise<void> {
    if (!ctx.knowledgeBase.value || ctx.knowledgeBase.value.health !== 'ready') return
    try {
      if (node.type === 'group') {
        const detail = resultValue(
          await window.desk.toc.renameGroup(
            ipcPlain({
              knowledgeBaseId: ctx.knowledgeBase.value.id,
              folderPath: [...node.folderPath],
              title,
              expectedSnapshotRevision: ctx.knowledgeBase.value.snapshotRevision
            })
          )
        )
        ctx.applyDetail(detail)
      } else {
        const key = documentKey(ctx.knowledgeBase.value.id, node.uuid)
        const loaded =
          ctx.documents.value[key] ??
          (await ctx.ensureDocument(ctx.knowledgeBase.value.id, node.uuid))
        if (loaded.dirty) await ctx.saveDocument(key)
        const current = ctx.documents.value[key] ?? loaded
        const mutation = resultValue(
          await window.desk.notes.rename({
            knowledgeBaseId: ctx.knowledgeBase.value.id,
            noteUuid: node.uuid,
            title,
            expectedRevision: current.document.revision
          })
        )
        ctx.applyDetail(mutation.knowledgeBase)
        ctx.setDocumentSession(key, {
          document: mutation.note,
          content: mutation.note.content,
          dirty: false,
          preserveSourceOnSave: false,
          externalConflict: false,
          saving: false
        })
        ctx.editor.renameNote(ctx.knowledgeBase.value.id, node.uuid, mutation.note.title)
        ctx.deleteRecovery(ctx.knowledgeBase.value.id, node.uuid)
      }
      ctx.status.value = '名称已更新'
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async function moveTocNode(
    source: DeskTocNode,
    target: DeskTocNode,
    placement: 'before' | 'after' | 'inside'
  ): Promise<void> {
    if (!ctx.knowledgeBase.value || ctx.knowledgeBase.value.health !== 'ready') return
    if (source.nodeId === target.nodeId) return
    try {
      const detail = resultValue(
        await window.desk.toc.move(
          ipcPlain({
            knowledgeBaseId: ctx.knowledgeBase.value.id,
            source: tocEntry(source),
            target: tocEntry(target),
            placement,
            expectedSnapshotRevision: ctx.knowledgeBase.value.snapshotRevision
          })
        )
      )
      ctx.applyDetail(detail)
      ctx.status.value = '目录顺序已更新'
    } catch (cause) {
      ctx.error.value = cause instanceof Error ? cause.message : String(cause)
      throw cause
    }
  }

  async function toggleDone(node: Extract<DeskTocNode, { type: 'note' }>): Promise<void> {
    if (!ctx.knowledgeBase.value || ctx.knowledgeBase.value.health !== 'ready') return
    const key = documentKey(ctx.knowledgeBase.value.id, node.uuid)
    const loaded =
      ctx.documents.value[key] ?? (await ctx.ensureDocument(ctx.knowledgeBase.value.id, node.uuid))
    if (loaded.dirty) await ctx.saveDocument(key)
    const current = ctx.documents.value[key] ?? loaded
    const mutation = resultValue(
      await window.desk.notes.updateConfig({
        knowledgeBaseId: ctx.knowledgeBase.value.id,
        noteUuid: node.uuid,
        expectedRevision: current.document.revision,
        updates: { done: !node.completed }
      })
    )
    ctx.applyDetail(mutation.knowledgeBase)
    ctx.setDocumentSession(key, {
      document: mutation.note,
      content: mutation.note.content,
      dirty: false,
      preserveSourceOnSave: false,
      externalConflict: false,
      saving: false
    })
  }

  async function previewDeleteNode(node: DeskTocNode): Promise<DeletePreviewDto> {
    if (!ctx.knowledgeBase.value) throw new Error('未选择知识库')
    return resultValue(
      await window.desk.toc.previewDelete(
        ctx.knowledgeBase.value.id,
        ipcPlain(
          node.type === 'note'
            ? { type: 'note', noteUuid: node.uuid }
            : { type: 'folder', folderPath: [...node.folderPath] }
        )
      )
    )
  }

  async function deleteNode(preview: DeletePreviewDto): Promise<void> {
    const detail = resultValue(
      await window.desk.toc.delete(
        ipcPlain({
          knowledgeBaseId: preview.knowledgeBaseId,
          entry: preview.entry,
          expectedSnapshotRevision: preview.snapshotRevision
        })
      )
    )
    ctx.applyDetail(detail)
    for (const note of preview.notes) {
      ctx.editor.closeNote(preview.knowledgeBaseId, note.noteUuid)
      ctx.removeDocumentSession(documentKey(preview.knowledgeBaseId, note.noteUuid))
      ctx.deleteRecovery(preview.knowledgeBaseId, note.noteUuid)
    }
  }

  return {
    createNote,
    createTocGroup,
    renameTocNode,
    moveTocNode,
    toggleDone,
    previewDeleteNode,
    deleteNode
  }
}

export type TocApi = ReturnType<typeof createToc>
