import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import type {
  AppSettings,
  DeletePreviewDto,
  DeskResult,
  DeskTocNode,
  KnowledgeBaseDetail,
  NoteDocumentDto,
  WorkspaceOverview
} from '../../../shared/contracts'

function resultValue<T>(result: DeskResult<T>): T {
  if (result.ok) return result.value
  const error = new Error(result.error.message) as Error & { code?: string }
  error.code = result.error.code
  throw error
}

function replaceDescriptor(
  overview: WorkspaceOverview,
  detail: KnowledgeBaseDetail
): WorkspaceOverview {
  const update = (
    items: WorkspaceOverview['knowledgeBases']
  ): WorkspaceOverview['knowledgeBases'] =>
    items.map((item) => (item.id === detail.id ? detail : item))
  return {
    ...overview,
    knowledgeBases: update(overview.knowledgeBases),
    allKnowledgeBases: update(overview.allKnowledgeBases)
  }
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const overview = ref<WorkspaceOverview>({
    path: null,
    knowledgeBases: [],
    allKnowledgeBases: []
  })
  const settings = ref<AppSettings | null>(null)
  const selectedKnowledgeBaseId = ref<string | null>(null)
  const knowledgeBase = ref<KnowledgeBaseDetail | null>(null)
  const document = ref<NoteDocumentDto | null>(null)
  const editorContent = ref('')
  const dirty = ref(false)
  const externalConflict = ref(false)
  const loading = ref(false)
  const saving = ref(false)
  const error = ref<string | null>(null)
  const status = ref<string | null>(null)
  let autosaveTimer: ReturnType<typeof setTimeout> | null = null
  let unsubscribeWorkspace: (() => void) | null = null
  let unsubscribeExternal: (() => void) | null = null

  const hasWorkspace = computed(() => Boolean(overview.value.path))
  const selectedKnowledgeBase = computed(() =>
    selectedKnowledgeBaseId.value
      ? (overview.value.knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId.value) ??
        null)
      : null
  )

  function clearDocument(): void {
    document.value = null
    editorContent.value = ''
    dirty.value = false
    externalConflict.value = false
    if (autosaveTimer) clearTimeout(autosaveTimer)
    autosaveTimer = null
  }

  function applyDetail(detail: KnowledgeBaseDetail): void {
    knowledgeBase.value = detail
    overview.value = replaceDescriptor(overview.value, detail)
  }

  async function initialize(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const payload = resultValue(await window.desk.bootstrap())
      overview.value = payload.workspace
      settings.value = payload.settings
      unsubscribeWorkspace = window.desk.workspace.onChanged((next) => {
        overview.value = next
        if (
          selectedKnowledgeBaseId.value &&
          !next.allKnowledgeBases.some((item) => item.id === selectedKnowledgeBaseId.value)
        ) {
          selectedKnowledgeBaseId.value = null
          knowledgeBase.value = null
          clearDocument()
        }
      })
      unsubscribeExternal = window.desk.notes.onExternalChanged((event) => {
        if (
          document.value?.knowledgeBaseId !== event.knowledgeBaseId ||
          document.value.uuid !== event.noteUuid
        ) {
          return
        }
        if (dirty.value) {
          externalConflict.value = true
          return
        }
        void reloadCurrentDocument()
      })

      const first = overview.value.knowledgeBases[0]
      if (first) await selectKnowledgeBase(first.id)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  function dispose(): void {
    unsubscribeWorkspace?.()
    unsubscribeWorkspace = null
    unsubscribeExternal?.()
    unsubscribeExternal = null
    if (autosaveTimer) clearTimeout(autosaveTimer)
  }

  async function chooseWorkspace(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      overview.value = resultValue(await window.desk.workspace.choose())
      selectedKnowledgeBaseId.value = null
      knowledgeBase.value = null
      clearDocument()
      const first = overview.value.knowledgeBases[0]
      if (first) await selectKnowledgeBase(first.id)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  async function refreshWorkspace(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      overview.value = resultValue(await window.desk.workspace.refresh())
      if (selectedKnowledgeBaseId.value) {
        await reloadKnowledgeBase()
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  async function selectKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    if (knowledgeBaseId === selectedKnowledgeBaseId.value && knowledgeBase.value) {
      return
    }
    if (dirty.value) await saveCurrentDocument()
    error.value = null
    try {
      const detail = resultValue(await window.desk.knowledgeBases.read(knowledgeBaseId))
      selectedKnowledgeBaseId.value = knowledgeBaseId
      applyDetail(detail)
      clearDocument()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function reloadKnowledgeBase(): Promise<void> {
    if (!selectedKnowledgeBaseId.value) return
    const detail = resultValue(await window.desk.knowledgeBases.read(selectedKnowledgeBaseId.value))
    applyDetail(detail)
  }

  async function selectNote(node: Extract<DeskTocNode, { type: 'note' }>): Promise<void> {
    if (!selectedKnowledgeBaseId.value) return
    if (document.value?.uuid === node.uuid) return
    if (dirty.value) await saveCurrentDocument()
    error.value = null
    try {
      const next = resultValue(
        await window.desk.notes.read(selectedKnowledgeBaseId.value, node.uuid)
      )
      document.value = next
      editorContent.value = next.content
      dirty.value = false
      externalConflict.value = false
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  function updateEditorContent(content: string): void {
    if (!document.value || document.value.readOnly) return
    editorContent.value = content
    dirty.value = content !== document.value.content
    externalConflict.value = false
    if (autosaveTimer) clearTimeout(autosaveTimer)
    if (dirty.value && settings.value?.autosave.enabled) {
      autosaveTimer = setTimeout(() => {
        autosaveTimer = null
        void saveCurrentDocument().catch(() => undefined)
      }, settings.value.autosave.delayMs)
    }
  }

  async function saveCurrentDocument(): Promise<void> {
    if (!document.value || !dirty.value || document.value.readOnly || saving.value) {
      return
    }
    saving.value = true
    error.value = null
    try {
      const mutation = resultValue(
        await window.desk.notes.save({
          knowledgeBaseId: document.value.knowledgeBaseId,
          noteUuid: document.value.uuid,
          content: editorContent.value,
          expectedRevision: document.value.revision
        })
      )
      document.value = mutation.note
      editorContent.value = mutation.note.content
      dirty.value = false
      externalConflict.value = false
      applyDetail(mutation.knowledgeBase)
      status.value = '已保存'
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      error.value = message
      if ((cause as { code?: string }).code === 'REVISION_CONFLICT') {
        externalConflict.value = true
      }
      throw cause
    } finally {
      saving.value = false
    }
  }

  async function reloadCurrentDocument(): Promise<void> {
    if (!document.value) return
    const next = resultValue(
      await window.desk.notes.read(document.value.knowledgeBaseId, document.value.uuid)
    )
    document.value = next
    editorContent.value = next.content
    dirty.value = false
    externalConflict.value = false
  }

  async function keepEditorAgainstDisk(): Promise<void> {
    if (!document.value) return
    const content = editorContent.value
    const next = resultValue(
      await window.desk.notes.read(document.value.knowledgeBaseId, document.value.uuid)
    )
    document.value = next
    editorContent.value = content
    dirty.value = content !== next.content
    externalConflict.value = false
  }

  async function createNote(title: string): Promise<void> {
    if (!knowledgeBase.value || knowledgeBase.value.health !== 'ready') return
    const mutation = resultValue(
      await window.desk.notes.create({
        knowledgeBaseId: knowledgeBase.value.id,
        title,
        expectedSnapshotRevision: knowledgeBase.value.snapshotRevision
      })
    )
    applyDetail(mutation.knowledgeBase)
    document.value = mutation.note
    editorContent.value = mutation.note.content
    dirty.value = false
  }

  async function toggleDone(node: Extract<DeskTocNode, { type: 'note' }>): Promise<void> {
    if (!knowledgeBase.value || knowledgeBase.value.health !== 'ready') return
    const source =
      document.value?.uuid === node.uuid
        ? document.value
        : resultValue(await window.desk.notes.read(knowledgeBase.value.id, node.uuid))
    const mutation = resultValue(
      await window.desk.notes.updateConfig({
        knowledgeBaseId: knowledgeBase.value.id,
        noteUuid: node.uuid,
        expectedRevision: source.revision,
        updates: { done: !node.completed }
      })
    )
    applyDetail(mutation.knowledgeBase)
    if (document.value?.uuid === node.uuid) document.value = mutation.note
  }

  async function previewDeleteNode(node: DeskTocNode): Promise<DeletePreviewDto> {
    if (!knowledgeBase.value) throw new Error('未选择知识库')
    return resultValue(
      await window.desk.toc.previewDelete(
        knowledgeBase.value.id,
        node.type === 'note'
          ? { type: 'note', noteUuid: node.uuid }
          : { type: 'folder', folderPath: node.folderPath }
      )
    )
  }

  async function deleteNode(preview: DeletePreviewDto): Promise<void> {
    const detail = resultValue(
      await window.desk.toc.delete({
        knowledgeBaseId: preview.knowledgeBaseId,
        entry: preview.entry,
        expectedSnapshotRevision: preview.snapshotRevision
      })
    )
    applyDetail(detail)
    if (document.value && preview.notes.some((note) => note.noteUuid === document.value?.uuid)) {
      clearDocument()
    }
  }

  return {
    overview,
    settings,
    selectedKnowledgeBaseId,
    selectedKnowledgeBase,
    knowledgeBase,
    document,
    editorContent,
    dirty,
    externalConflict,
    loading,
    saving,
    error,
    status,
    hasWorkspace,
    initialize,
    dispose,
    chooseWorkspace,
    refreshWorkspace,
    selectKnowledgeBase,
    selectNote,
    updateEditorContent,
    saveCurrentDocument,
    reloadCurrentDocument,
    keepEditorAgainstDisk,
    createNote,
    toggleDone,
    previewDeleteNode,
    deleteNode
  }
})
