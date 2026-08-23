import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useEditorStore } from './editor'

import type {
  AppSettings,
  AttachmentWriteLocalResult,
  DeletePreviewDto,
  DeskResult,
  DeskTocNode,
  KnowledgeBaseDetail,
  NoteDocumentDto,
  RecoveryRecord,
  WorkspaceOverview
} from '../../../shared/contracts'
import type { SplitPlacement } from '../editor-groups/layoutModel'

interface DocumentSession {
  document: NoteDocumentDto
  content: string
  dirty: boolean
  externalConflict: boolean
  saving: boolean
}

function resultValue<T>(result: DeskResult<T>): T {
  if (result.ok) return result.value
  const error = new Error(result.error.message) as Error & { code?: string }
  error.code = result.error.code
  throw error
}

function documentKey(knowledgeBaseId: string, noteUuid: string): string {
  return `${knowledgeBaseId}:${noteUuid}`
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
  const editor = useEditorStore()
  const overview = ref<WorkspaceOverview>({ path: null, knowledgeBases: [], allKnowledgeBases: [] })
  const settings = ref<AppSettings | null>(null)
  const selectedKnowledgeBaseId = ref<string | null>(null)
  const knowledgeBase = ref<KnowledgeBaseDetail | null>(null)
  const documents = ref<Record<string, DocumentSession>>({})
  const pendingRecoveries = ref<RecoveryRecord[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const status = ref<string | null>(null)
  const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let unsubscribeWorkspace: (() => void) | null = null
  let unsubscribeExternal: (() => void) | null = null

  const activeDocumentKey = computed(() => {
    const tab = editor.activeTab
    return tab?.type === 'note' ? documentKey(tab.knowledgeBaseId, tab.noteUuid) : null
  })
  const activeDocumentSession = computed(() =>
    activeDocumentKey.value ? (documents.value[activeDocumentKey.value] ?? null) : null
  )
  const document = computed(() => activeDocumentSession.value?.document ?? null)
  const editorContent = computed(() => activeDocumentSession.value?.content ?? '')
  const dirty = computed(() => Boolean(activeDocumentSession.value?.dirty))
  const externalConflict = computed(() => Boolean(activeDocumentSession.value?.externalConflict))
  const saving = computed(() => Boolean(activeDocumentSession.value?.saving))
  const hasWorkspace = computed(() => Boolean(overview.value.path))
  const selectedKnowledgeBase = computed(() =>
    selectedKnowledgeBaseId.value
      ? (overview.value.knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId.value) ??
        null)
      : null
  )

  function setDocumentSession(key: string, session: DocumentSession): void {
    documents.value = { ...documents.value, [key]: session }
  }

  function removeDocumentSession(key: string): void {
    const next = { ...documents.value }
    delete next[key]
    documents.value = next
    const timer = autosaveTimers.get(key)
    if (timer) clearTimeout(timer)
    autosaveTimers.delete(key)
    const recoveryTimer = recoveryTimers.get(key)
    if (recoveryTimer) clearTimeout(recoveryTimer)
    recoveryTimers.delete(key)
  }

  function deleteRecovery(knowledgeBaseId: string, noteUuid: string): void {
    void window.desk.recovery.delete({ knowledgeBaseId, noteUuid })
  }

  async function persistRecovery(key: string): Promise<void> {
    const session = documents.value[key]
    if (!session?.dirty) return
    const result = await window.desk.recovery.write({
      knowledgeBaseId: session.document.knowledgeBaseId,
      noteUuid: session.document.uuid,
      title: session.document.title,
      content: session.content,
      revision: session.document.revision
    })
    if (!result.ok) error.value = `无法保存恢复快照：${result.error.message}`
  }

  async function prepareRecoveries(records: RecoveryRecord[]): Promise<void> {
    const candidates: RecoveryRecord[] = []
    for (const record of records) {
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
    pendingRecoveries.value = candidates
  }

  function applyDetail(detail: KnowledgeBaseDetail): void {
    if (selectedKnowledgeBaseId.value === detail.id) knowledgeBase.value = detail
    overview.value = replaceDescriptor(overview.value, detail)
  }

  async function initialize(): Promise<void> {
    loading.value = true
    error.value = null
    editor.initializeWebEvents()
    try {
      const payload = resultValue(await window.desk.bootstrap())
      overview.value = payload.workspace
      settings.value = payload.settings
      editor.restore(payload.session, payload.workspace.knowledgeBases)
      await prepareRecoveries(payload.recoveries)
      unsubscribeWorkspace = window.desk.workspace.onChanged((next) => {
        overview.value = next
        if (
          selectedKnowledgeBaseId.value &&
          !next.allKnowledgeBases.some((item) => item.id === selectedKnowledgeBaseId.value)
        ) {
          selectedKnowledgeBaseId.value = null
          knowledgeBase.value = null
        }
      })
      unsubscribeExternal = window.desk.notes.onExternalChanged((event) => {
        const key = documentKey(event.knowledgeBaseId, event.noteUuid)
        const session = documents.value[key]
        if (!session) return
        if (session.dirty) {
          setDocumentSession(key, { ...session, externalConflict: true })
          return
        }
        void reloadDocument(key)
      })

      const initial = payload.workspace.knowledgeBases.find(
        (item) => item.id === payload.session?.selectedKnowledgeBaseId
      )
      const selected = initial ?? payload.workspace.knowledgeBases[0]
      if (selected) await selectKnowledgeBase(selected.id)
      const activeTab = editor.activeTab
      if (activeTab?.type === 'note') {
        await ensureDocument(activeTab.knowledgeBaseId, activeTab.noteUuid)
      }
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
    for (const timer of autosaveTimers.values()) clearTimeout(timer)
    autosaveTimers.clear()
    for (const timer of recoveryTimers.values()) clearTimeout(timer)
    recoveryTimers.clear()
    for (const [key, session] of Object.entries(documents.value)) {
      if (session.dirty) void persistRecovery(key)
    }
    editor.dispose()
  }

  async function chooseWorkspace(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await saveAllDocuments()
      overview.value = resultValue(await window.desk.workspace.choose())
      editor.reset()
      documents.value = {}
      selectedKnowledgeBaseId.value = null
      knowledgeBase.value = null
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
      if (selectedKnowledgeBaseId.value) await reloadKnowledgeBase()
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    } finally {
      loading.value = false
    }
  }

  async function selectKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    if (knowledgeBaseId === selectedKnowledgeBaseId.value && knowledgeBase.value) return
    error.value = null
    try {
      const detail = resultValue(await window.desk.knowledgeBases.read(knowledgeBaseId))
      selectedKnowledgeBaseId.value = knowledgeBaseId
      knowledgeBase.value = detail
      overview.value = replaceDescriptor(overview.value, detail)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function syncToActiveTab(): Promise<void> {
    const tab = editor.activeTab
    if (tab?.type !== 'note') return
    if (selectedKnowledgeBaseId.value !== tab.knowledgeBaseId) {
      await selectKnowledgeBase(tab.knowledgeBaseId)
    }
    await ensureDocument(tab.knowledgeBaseId, tab.noteUuid)
  }

  async function reloadKnowledgeBase(): Promise<void> {
    if (!selectedKnowledgeBaseId.value) return
    applyDetail(resultValue(await window.desk.knowledgeBases.read(selectedKnowledgeBaseId.value)))
  }

  async function ensureDocument(
    knowledgeBaseId: string,
    noteUuid: string
  ): Promise<DocumentSession> {
    const key = documentKey(knowledgeBaseId, noteUuid)
    const existing = documents.value[key]
    if (existing) return existing
    const next = resultValue(await window.desk.notes.read(knowledgeBaseId, noteUuid))
    const session: DocumentSession = {
      document: next,
      content: next.content,
      dirty: false,
      externalConflict: false,
      saving: false
    }
    setDocumentSession(key, session)
    return session
  }

  async function selectNote(
    node: Extract<DeskTocNode, { type: 'note' }>,
    split?: SplitPlacement
  ): Promise<void> {
    if (!selectedKnowledgeBaseId.value || !selectedKnowledgeBase.value) return
    error.value = null
    try {
      await ensureDocument(selectedKnowledgeBaseId.value, node.uuid)
      editor.openNote(
        selectedKnowledgeBase.value,
        node.uuid,
        node.title,
        settings.value?.defaultNoteView ?? 'visual',
        split
      )
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function openNoteByUuid(knowledgeBaseId: string, noteUuid: string): Promise<void> {
    const detail = resultValue(await window.desk.knowledgeBases.read(knowledgeBaseId))
    const stack = [...detail.toc]
    let target: Extract<DeskTocNode, { type: 'note' }> | null = null
    while (stack.length > 0) {
      const node = stack.shift()!
      if (node.type === 'note' && node.uuid === noteUuid) {
        target = node
        break
      }
      stack.unshift(...node.children)
    }
    if (!target) throw new Error(`关联笔记不存在：${noteUuid}`)
    await ensureDocument(knowledgeBaseId, noteUuid)
    editor.openNote(detail, noteUuid, target.title, settings.value?.defaultNoteView ?? 'visual')
    await selectKnowledgeBase(knowledgeBaseId)
  }

  function updateDocumentContent(key: string, content: string): void {
    const session = documents.value[key]
    if (!session || session.document.readOnly) return
    const dirty = content !== session.document.content
    setDocumentSession(key, { ...session, content, dirty, externalConflict: false })
    const currentTimer = autosaveTimers.get(key)
    if (currentTimer) clearTimeout(currentTimer)
    autosaveTimers.delete(key)
    const currentRecoveryTimer = recoveryTimers.get(key)
    if (currentRecoveryTimer) clearTimeout(currentRecoveryTimer)
    recoveryTimers.delete(key)
    if (dirty) {
      recoveryTimers.set(
        key,
        setTimeout(() => {
          recoveryTimers.delete(key)
          void persistRecovery(key)
        }, 250)
      )
    } else {
      deleteRecovery(session.document.knowledgeBaseId, session.document.uuid)
    }
    if (dirty && settings.value?.autosave.enabled) {
      const timer = setTimeout(() => {
        autosaveTimers.delete(key)
        void saveDocument(key).catch(() => undefined)
      }, settings.value.autosave.delayMs)
      autosaveTimers.set(key, timer)
    }
  }

  function updateEditorContent(content: string): void {
    if (activeDocumentKey.value) updateDocumentContent(activeDocumentKey.value, content)
  }

  async function saveDocument(key: string): Promise<void> {
    const session = documents.value[key]
    if (!session || !session.dirty || session.document.readOnly || session.saving) return
    setDocumentSession(key, { ...session, saving: true })
    const recoveryTimer = recoveryTimers.get(key)
    if (recoveryTimer) clearTimeout(recoveryTimer)
    recoveryTimers.delete(key)
    error.value = null
    try {
      const mutation = resultValue(
        await window.desk.notes.save({
          knowledgeBaseId: session.document.knowledgeBaseId,
          noteUuid: session.document.uuid,
          content: session.content,
          expectedRevision: session.document.revision
        })
      )
      setDocumentSession(key, {
        document: mutation.note,
        content: mutation.note.content,
        dirty: false,
        externalConflict: false,
        saving: false
      })
      applyDetail(mutation.knowledgeBase)
      deleteRecovery(mutation.note.knowledgeBaseId, mutation.note.uuid)
      status.value = '已保存'
    } catch (cause) {
      const current = documents.value[key] ?? session
      const isConflict = (cause as { code?: string }).code === 'REVISION_CONFLICT'
      setDocumentSession(key, {
        ...current,
        saving: false,
        externalConflict: current.externalConflict || isConflict
      })
      error.value = cause instanceof Error ? cause.message : String(cause)
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

  async function saveCurrentDocument(): Promise<void> {
    if (activeDocumentKey.value) await saveDocument(activeDocumentKey.value)
  }

  async function saveAllDocuments(): Promise<void> {
    for (const [key, session] of Object.entries(documents.value)) {
      if (session.dirty) await saveDocument(key)
    }
  }

  async function reloadDocument(key: string): Promise<void> {
    const session = documents.value[key]
    if (!session) return
    const next = resultValue(
      await window.desk.notes.read(session.document.knowledgeBaseId, session.document.uuid)
    )
    setDocumentSession(key, {
      document: next,
      content: next.content,
      dirty: false,
      externalConflict: false,
      saving: false
    })
    deleteRecovery(next.knowledgeBaseId, next.uuid)
  }

  async function acceptRecovery(record: RecoveryRecord): Promise<void> {
    const loaded = await ensureDocument(record.knowledgeBaseId, record.noteUuid)
    const key = documentKey(record.knowledgeBaseId, record.noteUuid)
    setDocumentSession(key, {
      ...loaded,
      content: record.content,
      dirty: record.content !== loaded.document.content,
      externalConflict: false
    })
    const descriptor = overview.value.allKnowledgeBases.find(
      (item) => item.id === record.knowledgeBaseId
    )
    if (descriptor) {
      editor.openNote(
        descriptor,
        record.noteUuid,
        record.title,
        settings.value?.defaultNoteView ?? 'visual'
      )
      await selectKnowledgeBase(record.knowledgeBaseId)
    }
    pendingRecoveries.value = pendingRecoveries.value.filter(
      (candidate) =>
        candidate.knowledgeBaseId !== record.knowledgeBaseId ||
        candidate.noteUuid !== record.noteUuid
    )
    await persistRecovery(key)
  }

  function discardRecovery(record: RecoveryRecord): void {
    deleteRecovery(record.knowledgeBaseId, record.noteUuid)
    pendingRecoveries.value = pendingRecoveries.value.filter(
      (candidate) =>
        candidate.knowledgeBaseId !== record.knowledgeBaseId ||
        candidate.noteUuid !== record.noteUuid
    )
  }

  async function reloadCurrentDocument(): Promise<void> {
    if (activeDocumentKey.value) await reloadDocument(activeDocumentKey.value)
  }

  async function keepEditorAgainstDisk(): Promise<void> {
    const key = activeDocumentKey.value
    if (!key) return
    const session = documents.value[key]
    if (!session) return
    const next = resultValue(
      await window.desk.notes.read(session.document.knowledgeBaseId, session.document.uuid)
    )
    setDocumentSession(key, {
      document: next,
      content: session.content,
      dirty: session.content !== next.content,
      externalConflict: false,
      saving: false
    })
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
    const key = documentKey(mutation.note.knowledgeBaseId, mutation.note.uuid)
    setDocumentSession(key, {
      document: mutation.note,
      content: mutation.note.content,
      dirty: false,
      externalConflict: false,
      saving: false
    })
    editor.openNote(
      mutation.knowledgeBase,
      mutation.note.uuid,
      mutation.note.title,
      settings.value?.defaultNoteView ?? 'visual'
    )
  }

  async function toggleDone(node: Extract<DeskTocNode, { type: 'note' }>): Promise<void> {
    if (!knowledgeBase.value || knowledgeBase.value.health !== 'ready') return
    const key = documentKey(knowledgeBase.value.id, node.uuid)
    const loaded = documents.value[key] ?? (await ensureDocument(knowledgeBase.value.id, node.uuid))
    if (loaded.dirty) await saveDocument(key)
    const current = documents.value[key] ?? loaded
    const mutation = resultValue(
      await window.desk.notes.updateConfig({
        knowledgeBaseId: knowledgeBase.value.id,
        noteUuid: node.uuid,
        expectedRevision: current.document.revision,
        updates: { done: !node.completed }
      })
    )
    applyDetail(mutation.knowledgeBase)
    setDocumentSession(key, {
      document: mutation.note,
      content: mutation.note.content,
      dirty: false,
      externalConflict: false,
      saving: false
    })
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
    for (const note of preview.notes) {
      editor.closeNote(preview.knowledgeBaseId, note.noteUuid)
      removeDocumentSession(documentKey(preview.knowledgeBaseId, note.noteUuid))
      deleteRecovery(preview.knowledgeBaseId, note.noteUuid)
    }
  }

  function getDocumentSession(knowledgeBaseId: string, noteUuid: string): DocumentSession | null {
    return documents.value[documentKey(knowledgeBaseId, noteUuid)] ?? null
  }

  return {
    overview,
    settings,
    selectedKnowledgeBaseId,
    selectedKnowledgeBase,
    knowledgeBase,
    documents,
    pendingRecoveries,
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
    syncToActiveTab,
    selectNote,
    openNoteByUuid,
    updateDocumentContent,
    updateEditorContent,
    saveDocument,
    saveCurrentDocument,
    saveAllDocuments,
    writeLocalAttachment,
    reloadCurrentDocument,
    keepEditorAgainstDisk,
    acceptRecovery,
    discardRecovery,
    createNote,
    toggleDone,
    previewDeleteNode,
    deleteNode,
    ensureDocument,
    getDocumentSession
  }
})
