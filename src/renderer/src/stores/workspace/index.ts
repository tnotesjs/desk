import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useEditorStore } from '../editor'

import type {
  AppSettings,
  DeskTocNode,
  GitRepositoryStateDto,
  KnowledgeBaseDetail,
  NoteEditorTab,
  NoteFileKind,
  RecoveryRecord,
  SearchResultDto,
  WorkspaceOverview
} from '../../../../shared/contracts'
import type { SplitPlacement } from '../../editor-groups/layoutModel'

import { createDocuments } from './documents'
import { createTabClosing, type ClosingResource } from './closeTabs'
import { createGit } from './git'
import {
  documentKey,
  noteFileKey,
  replaceDescriptor,
  resultValue,
  type DocumentSession,
  type GitAttention,
  type NoteFileSession
} from './helpers'
import { createNoteFiles } from './noteFiles'
import { createSearch } from './search'
import { createSettings } from './settings'
import { createToc } from './toc'

function collectNoteUuids(nodes: DeskTocNode[]): Set<string> {
  const noteUuids = new Set<string>()
  const queue = [...nodes]
  while (queue.length > 0) {
    const node = queue.shift()!
    if (node.type === 'note') noteUuids.add(node.uuid)
    queue.unshift(...node.children)
  }
  return noteUuids
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const editor = useEditorStore()
  const overview = ref<WorkspaceOverview>({ path: null, knowledgeBases: [], allKnowledgeBases: [] })
  const settings = ref<AppSettings | null>(null)
  const runtimePlatform = ref<'darwin' | 'win32' | 'linux'>('darwin')
  const selectedKnowledgeBaseId = ref<string | null>(null)
  const knowledgeBase = ref<KnowledgeBaseDetail | null>(null)
  const documents = ref<Record<string, DocumentSession>>({})
  const noteFiles = ref<Record<string, NoteFileSession>>({})
  const noteFileTreeRevision = ref(0)
  const pendingRecoveries = ref<RecoveryRecord[]>([])
  const searchResults = ref<SearchResultDto[]>([])
  const searchLoading = ref(false)
  const gitStates = ref<Record<string, GitRepositoryStateDto>>({})
  const gitAttention = ref<GitAttention | null>(null)
  const pendingGitPublishId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const status = ref<string | null>(null)
  const tocFocusRequest = ref<{
    knowledgeBaseId: string
    noteUuid: string
    sequence: number
  } | null>(null)
  const autosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const recoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const noteFileAutosaveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const noteFileRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  let unsubscribeWorkspace: (() => void) | null = null
  let unsubscribeExternal: (() => void) | null = null
  let unsubscribeFileExternal: (() => void) | null = null
  let unsubscribeGit: (() => void) | null = null
  let tocFocusSequence = 0

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

  function applyDetail(detail: KnowledgeBaseDetail): void {
    if (selectedKnowledgeBaseId.value === detail.id) {
      knowledgeBase.value = detail
      editor.switchKnowledgeBase(detail.id, collectNoteUuids(detail.toc))
    }
    overview.value = replaceDescriptor(overview.value, detail)
  }

  async function selectKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    if (knowledgeBaseId === selectedKnowledgeBaseId.value && knowledgeBase.value) return
    error.value = null
    try {
      const detail = resultValue(await window.desk.knowledgeBases.read(knowledgeBaseId))
      selectedKnowledgeBaseId.value = knowledgeBaseId
      applyDetail(detail)
      searchResults.value = []
      const gitState = gitStates.value[knowledgeBaseId]
      if (gitState?.behind) {
        gitAttention.value = {
          knowledgeBaseId,
          knowledgeBaseName: detail.displayName,
          kind: 'behind',
          message: `本地分支落后上游 ${gitState.behind} 个提交。建议先拉取最新版本，再开始编辑。`
        }
      }
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function reloadKnowledgeBase(): Promise<void> {
    if (!selectedKnowledgeBaseId.value) return
    applyDetail(resultValue(await window.desk.knowledgeBases.read(selectedKnowledgeBaseId.value)))
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

  const {
    deleteRecovery,
    persistRecovery,
    prepareRecoveries,
    ensureDocument,
    updateDocumentContent,
    updateEditorContent,
    saveDocument,
    pauseDocumentAutosave,
    discardDocumentChanges,
    waitForDocumentSave,
    writeLocalAttachment,
    uploadImage,
    copyNoteDirectoryPath,
    revealNoteInFileManager,
    saveCurrentDocument: saveCurrentNoteDocument,
    saveAllDocuments: saveAllNoteDocuments,
    reloadDocument,
    acceptRecovery,
    discardRecovery,
    reloadCurrentDocument,
    keepEditorAgainstDisk,
    getDocumentSession
  } = createDocuments({
    editor,
    documents,
    pendingRecoveries,
    overview,
    settings,
    error,
    status,
    activeDocumentKey,
    autosaveTimers,
    recoveryTimers,
    setDocumentSession,
    removeDocumentSession,
    applyDetail,
    selectKnowledgeBase
  })

  const {
    listNoteFiles,
    ensureNoteFile,
    updateNoteFileContent,
    saveNoteFile,
    pauseNoteFileAutosave,
    discardNoteFileChanges,
    waitForNoteFileSave,
    saveAllNoteFiles,
    reloadNoteFile,
    keepNoteFileAgainstDisk,
    prepareFileRecoveries,
    acceptFileRecovery,
    discardFileRecovery,
    getNoteFileSession,
    persistFileRecovery,
    removeNoteFileSession
  } = createNoteFiles({
    editor,
    noteFiles,
    pendingRecoveries,
    settings,
    error,
    status,
    autosaveTimers: noteFileAutosaveTimers,
    recoveryTimers: noteFileRecoveryTimers,
    descriptors: computed(() => overview.value.allKnowledgeBases),
    selectKnowledgeBase
  })

  async function saveCurrentDocument(): Promise<void> {
    const tab = editor.activeTab
    if (tab?.type === 'note-file' && tab.fileKind === 'text') {
      await saveNoteFile(noteFileKey(tab.knowledgeBaseId, tab.noteUuid, tab.path))
      return
    }
    await saveCurrentNoteDocument()
  }

  const { requestCloseTab, requestCloseTabs, isTabDirty, closingTabs } = createTabClosing({
    editor,
    error,
    status,
    resourcesFor: (tab) => {
      if (tab.type === 'web') return []
      const resources: ClosingResource[] = []
      if (tab.type === 'note') {
        const key = documentKey(tab.knowledgeBaseId, tab.noteUuid)
        resources.push({
          key,
          title: tab.title,
          dirty: () => Boolean(documents.value[key]?.dirty),
          saving: () => Boolean(documents.value[key]?.saving),
          pauseAutosave: () => pauseDocumentAutosave(key),
          waitForSave: () => waitForDocumentSave(key),
          save: () => saveDocument(key),
          discard: () => discardDocumentChanges(key)
        })
      }
      for (const [key, session] of Object.entries(noteFiles.value)) {
        if (
          session.document.knowledgeBaseId !== tab.knowledgeBaseId ||
          session.document.noteUuid !== tab.noteUuid
        )
          continue
        if (
          tab.type === 'note-file' &&
          key !== noteFileKey(tab.knowledgeBaseId, tab.noteUuid, tab.path)
        )
          continue
        resources.push({
          key,
          title: `${tab.type === 'note' ? tab.title : tab.noteTitle} / ${session.document.path}`,
          dirty: () => Boolean(noteFiles.value[key]?.dirty),
          saving: () => Boolean(noteFiles.value[key]?.saving),
          pauseAutosave: () => pauseNoteFileAutosave(key),
          waitForSave: () => waitForNoteFileSave(key),
          save: () => saveNoteFile(key),
          discard: () => discardNoteFileChanges(key)
        })
      }
      return resources
    }
  })

  async function saveAllDocuments(): Promise<void> {
    await saveAllNoteDocuments()
    await saveAllNoteFiles()
  }

  const { updateSettings, applySettings, setAppZoom, adjustAppZoom, zoomFeedbackSequence } =
    createSettings({
      editor,
      settings
    })

  const { searchNotes } = createSearch({
    searchResults,
    searchLoading,
    selectedKnowledgeBaseId,
    error
  })

  const { refreshGit, fetchGit, pullGit, requestGitPublish, publishGit, openKnowledgeBaseInIde } =
    createGit({
      gitStates,
      gitAttention,
      pendingGitPublishId,
      overview,
      settings,
      error,
      status,
      saveAllDocuments,
      refreshWorkspace
    })

  const {
    createNote,
    createTocGroup,
    renameNote,
    renameTocNode,
    moveTocNode,
    toggleDone,
    previewDeleteNode,
    deleteNode
  } = createToc({
    editor,
    knowledgeBase,
    documents,
    settings,
    error,
    status,
    applyDetail,
    setDocumentSession,
    removeDocumentSession,
    ensureDocument,
    saveDocument,
    pauseDocumentAutosave,
    waitForDocumentSave,
    persistRecovery,
    deleteRecovery
  })

  async function initialize(): Promise<void> {
    loading.value = true
    error.value = null
    editor.initializeWebEvents()
    try {
      const payload = resultValue(await window.desk.bootstrap())
      overview.value = payload.workspace
      applySettings(payload.settings)
      runtimePlatform.value = payload.platform
      const initialGitStates = resultValue(await window.desk.git.list())
      gitStates.value = Object.fromEntries(
        initialGitStates.map((state) => [state.knowledgeBaseId, state])
      )
      unsubscribeGit = window.desk.git.onStateChanged((state) => {
        gitStates.value = { ...gitStates.value, [state.knowledgeBaseId]: state }
      })
      editor.restore(
        payload.session,
        payload.workspace.allKnowledgeBases,
        new Set(payload.workspace.knowledgeBases.map((item) => item.id))
      )
      await prepareRecoveries(payload.recoveries)
      await prepareFileRecoveries(payload.recoveries)
      unsubscribeWorkspace = window.desk.workspace.onChanged((next) => {
        overview.value = next
        noteFileTreeRevision.value += 1
        editor.retainKnowledgeBases(new Set(next.allKnowledgeBases.map((item) => item.id)))
        const selectedId = selectedKnowledgeBaseId.value
        if (selectedId && !next.allKnowledgeBases.some((item) => item.id === selectedId)) {
          selectedKnowledgeBaseId.value = null
          knowledgeBase.value = null
          return
        }
        if (selectedId) {
          void window.desk.knowledgeBases.read(selectedId).then((result) => {
            if (!result.ok || selectedKnowledgeBaseId.value !== selectedId) return
            applyDetail(result.value)
          })
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
      unsubscribeFileExternal = window.desk.noteFiles.onExternalChanged((event) => {
        noteFileTreeRevision.value += 1
        const key = noteFileKey(event.knowledgeBaseId, event.noteUuid, event.path)
        const session = noteFiles.value[key]
        if (event.kind === 'deleted') {
          if (session?.dirty) {
            noteFiles.value = {
              ...noteFiles.value,
              [key]: { ...session, externalConflict: true }
            }
          } else {
            removeNoteFileSession(key)
            editor.closeNoteFile(event.knowledgeBaseId, event.noteUuid, event.path)
          }
          return
        }
        if (!session) return
        if (session.dirty) {
          noteFiles.value = {
            ...noteFiles.value,
            [key]: { ...session, externalConflict: true }
          }
          return
        }
        void reloadNoteFile(key)
      })

      const initial = payload.workspace.knowledgeBases.find(
        (item) => item.id === payload.session?.selectedKnowledgeBaseId
      )
      const selected = initial ?? payload.workspace.knowledgeBases[0]
      if (selected) await selectKnowledgeBase(selected.id)
      const activeTab = editor.activeTab
      if (activeTab?.type === 'note') {
        await ensureDocument(activeTab.knowledgeBaseId, activeTab.noteUuid)
      } else if (activeTab?.type === 'note-file' && activeTab.fileKind === 'text') {
        await ensureNoteFile(activeTab.knowledgeBaseId, activeTab.noteUuid, activeTab.path)
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
    unsubscribeFileExternal?.()
    unsubscribeFileExternal = null
    unsubscribeGit?.()
    unsubscribeGit = null
    for (const timer of autosaveTimers.values()) clearTimeout(timer)
    autosaveTimers.clear()
    for (const timer of recoveryTimers.values()) clearTimeout(timer)
    recoveryTimers.clear()
    for (const timer of noteFileAutosaveTimers.values()) clearTimeout(timer)
    noteFileAutosaveTimers.clear()
    for (const timer of noteFileRecoveryTimers.values()) clearTimeout(timer)
    noteFileRecoveryTimers.clear()
    for (const [key, session] of Object.entries(documents.value)) {
      if (session.dirty) void persistRecovery(key)
    }
    for (const [key, session] of Object.entries(noteFiles.value)) {
      if (session.dirty) void persistFileRecovery(key)
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
      noteFiles.value = {}
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

  async function syncToActiveTab(forceReveal = false): Promise<void> {
    const tab = editor.activeTab
    if (!tab || tab.type === 'web') return
    if (tab.type === 'note') await ensureDocument(tab.knowledgeBaseId, tab.noteUuid)
    else if (tab.fileKind === 'text') {
      await ensureNoteFile(tab.knowledgeBaseId, tab.noteUuid, tab.path)
    }
    if (forceReveal || settings.value?.tabs.autoRevealInToc) {
      if (selectedKnowledgeBaseId.value !== tab.knowledgeBaseId) {
        await selectKnowledgeBase(tab.knowledgeBaseId)
      }
      tocFocusSequence += 1
      tocFocusRequest.value = {
        knowledgeBaseId: tab.knowledgeBaseId,
        noteUuid: tab.noteUuid,
        sequence: tocFocusSequence
      }
    }
  }

  async function openNoteFile(path: string, fileKind: NoteFileKind): Promise<void> {
    const scope = editor.activeNoteScope
    const descriptor = selectedKnowledgeBase.value
    if (!scope || !descriptor) return
    if (path.toLocaleLowerCase() === 'readme.md') {
      editor.openNote(
        descriptor,
        scope.noteUuid,
        scope.noteTitle,
        settings.value?.defaultNoteView ?? 'visual',
        undefined,
        'permanent'
      )
      await ensureDocument(descriptor.id, scope.noteUuid)
      return
    }
    editor.openNoteFile(descriptor, scope.noteUuid, scope.noteTitle, path, fileKind)
    if (fileKind !== 'text') return
    try {
      await ensureNoteFile(descriptor.id, scope.noteUuid, path)
    } catch (cause) {
      editor.closeNoteFile(descriptor.id, scope.noteUuid, path)
      error.value = cause instanceof Error ? cause.message : String(cause)
    }
  }

  async function reloadCurrentNoteFile(): Promise<void> {
    const tab = editor.activeTab
    if (tab?.type !== 'note-file' || tab.fileKind !== 'text') return
    await reloadNoteFile(noteFileKey(tab.knowledgeBaseId, tab.noteUuid, tab.path))
  }

  async function keepCurrentNoteFileAgainstDisk(): Promise<void> {
    const tab = editor.activeTab
    if (tab?.type !== 'note-file' || tab.fileKind !== 'text') return
    await keepNoteFileAgainstDisk(noteFileKey(tab.knowledgeBaseId, tab.noteUuid, tab.path))
  }

  async function acceptAnyRecovery(record: RecoveryRecord): Promise<void> {
    if (record.path) await acceptFileRecovery(record)
    else await acceptRecovery(record)
  }

  function discardAnyRecovery(record: RecoveryRecord): void {
    if (record.path) discardFileRecovery(record)
    else discardRecovery(record)
  }

  async function revealTabInToc(tab: NoteEditorTab): Promise<void> {
    const located = editor.groups
      .flatMap((group) => group.tabs)
      .find((candidate) => candidate.id === tab.id)
    if (!located || located.type !== 'note') return
    const group = editor.groups.find((candidate) =>
      candidate.tabs.some((item) => item.id === tab.id)
    )
    if (group) editor.activate(group.id, tab.id)
    await syncToActiveTab(true)
  }

  async function selectNote(
    node: Extract<DeskTocNode, { type: 'note' }>,
    split?: SplitPlacement,
    permanent = false
  ): Promise<void> {
    if (!selectedKnowledgeBaseId.value || !selectedKnowledgeBase.value) return
    error.value = null
    // Open the tab shell first so chrome can paint while notes.read runs.
    editor.openNote(
      selectedKnowledgeBase.value,
      node.uuid,
      node.title,
      settings.value?.defaultNoteView ?? 'visual',
      split,
      permanent ? 'permanent' : 'preview'
    )
    try {
      await ensureDocument(selectedKnowledgeBaseId.value, node.uuid)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      if (!documents.value[documentKey(selectedKnowledgeBaseId.value, node.uuid)]) {
        editor.closeNote(selectedKnowledgeBaseId.value, node.uuid)
      }
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
    editor.openNote(detail, noteUuid, target.title, settings.value?.defaultNoteView ?? 'visual')
    try {
      await ensureDocument(knowledgeBaseId, noteUuid)
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : String(cause)
      if (!documents.value[documentKey(knowledgeBaseId, noteUuid)]) {
        editor.closeNote(knowledgeBaseId, noteUuid)
      }
      throw cause
    }
    await syncToActiveTab()
  }

  return {
    overview,
    settings,
    runtimePlatform,
    selectedKnowledgeBaseId,
    selectedKnowledgeBase,
    knowledgeBase,
    documents,
    noteFiles,
    noteFileTreeRevision,
    pendingRecoveries,
    searchResults,
    searchLoading,
    gitStates,
    gitAttention,
    pendingGitPublishId,
    document,
    editorContent,
    dirty,
    externalConflict,
    loading,
    saving,
    error,
    status,
    tocFocusRequest,
    hasWorkspace,
    initialize,
    dispose,
    chooseWorkspace,
    refreshWorkspace,
    reloadKnowledgeBase,
    selectKnowledgeBase,
    searchNotes,
    refreshGit,
    fetchGit,
    pullGit,
    requestGitPublish,
    publishGit,
    openKnowledgeBaseInIde,
    syncToActiveTab,
    revealTabInToc,
    selectNote,
    openNoteFile,
    openNoteByUuid,
    updateDocumentContent,
    updateEditorContent,
    saveDocument,
    saveCurrentDocument,
    requestCloseTab,
    requestCloseTabs,
    isTabDirty,
    closingTabs,
    saveAllDocuments,
    writeLocalAttachment,
    uploadImage,
    updateSettings,
    setAppZoom,
    adjustAppZoom,
    zoomFeedbackSequence,
    applySettings,
    copyNoteDirectoryPath,
    revealNoteInFileManager,
    reloadCurrentDocument,
    keepEditorAgainstDisk,
    acceptRecovery: acceptAnyRecovery,
    discardRecovery: discardAnyRecovery,
    createNote,
    createTocGroup,
    renameNote,
    renameTocNode,
    moveTocNode,
    toggleDone,
    previewDeleteNode,
    deleteNode,
    ensureDocument,
    getDocumentSession,
    listNoteFiles,
    ensureNoteFile,
    updateNoteFileContent,
    saveNoteFile,
    reloadCurrentNoteFile,
    keepCurrentNoteFileAgainstDisk,
    getNoteFileSession
  }
})
