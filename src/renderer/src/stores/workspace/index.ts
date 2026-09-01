import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { useEditorStore } from '../editor'

import type {
  AppSettings,
  DeskTocNode,
  GitRepositoryStateDto,
  KnowledgeBaseDetail,
  NoteEditorTab,
  RecoveryRecord,
  SearchResultDto,
  WorkspaceOverview
} from '../../../../shared/contracts'
import type { SplitPlacement } from '../../editor-groups/layoutModel'

import { createDocuments } from './documents'
import { createGit } from './git'
import {
  documentKey,
  replaceDescriptor,
  resultValue,
  type DocumentSession,
  type GitAttention
} from './helpers'
import { createSearch } from './search'
import { createSettings } from './settings'
import { createToc } from './toc'

export const useWorkspaceStore = defineStore('workspace', () => {
  const editor = useEditorStore()
  const overview = ref<WorkspaceOverview>({ path: null, knowledgeBases: [], allKnowledgeBases: [] })
  const settings = ref<AppSettings | null>(null)
  const runtimePlatform = ref<'darwin' | 'win32' | 'linux'>('darwin')
  const selectedKnowledgeBaseId = ref<string | null>(null)
  const knowledgeBase = ref<KnowledgeBaseDetail | null>(null)
  const documents = ref<Record<string, DocumentSession>>({})
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
  let unsubscribeWorkspace: (() => void) | null = null
  let unsubscribeExternal: (() => void) | null = null
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
    if (selectedKnowledgeBaseId.value === detail.id) knowledgeBase.value = detail
    overview.value = replaceDescriptor(overview.value, detail)
  }

  async function selectKnowledgeBase(knowledgeBaseId: string): Promise<void> {
    if (knowledgeBaseId === selectedKnowledgeBaseId.value && knowledgeBase.value) return
    error.value = null
    try {
      const detail = resultValue(await window.desk.knowledgeBases.read(knowledgeBaseId))
      selectedKnowledgeBaseId.value = knowledgeBaseId
      knowledgeBase.value = detail
      searchResults.value = []
      overview.value = replaceDescriptor(overview.value, detail)
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

  const { updateSettings, applySettings } = createSettings({ editor, settings })

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
    deleteRecovery
  })

  async function initialize(): Promise<void> {
    loading.value = true
    error.value = null
    editor.initializeWebEvents()
    try {
      const payload = resultValue(await window.desk.bootstrap())
      overview.value = payload.workspace
      settings.value = payload.settings
      runtimePlatform.value = payload.platform
      editor.configure(payload.settings)
      const initialGitStates = resultValue(await window.desk.git.list())
      gitStates.value = Object.fromEntries(
        initialGitStates.map((state) => [state.knowledgeBaseId, state])
      )
      unsubscribeGit = window.desk.git.onStateChanged((state) => {
        gitStates.value = { ...gitStates.value, [state.knowledgeBaseId]: state }
      })
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
    unsubscribeGit?.()
    unsubscribeGit = null
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

  async function syncToActiveTab(forceReveal = false): Promise<void> {
    const tab = editor.activeTab
    if (tab?.type !== 'note') return
    await ensureDocument(tab.knowledgeBaseId, tab.noteUuid)
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
    try {
      await ensureDocument(selectedKnowledgeBaseId.value, node.uuid)
      editor.openNote(
        selectedKnowledgeBase.value,
        node.uuid,
        node.title,
        settings.value?.defaultNoteView ?? 'visual',
        split,
        permanent ? 'permanent' : 'preview'
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
    openNoteByUuid,
    updateDocumentContent,
    updateEditorContent,
    saveDocument,
    saveCurrentDocument,
    saveAllDocuments,
    writeLocalAttachment,
    uploadImage,
    updateSettings,
    applySettings,
    copyNoteDirectoryPath,
    revealNoteInFileManager,
    reloadCurrentDocument,
    keepEditorAgainstDisk,
    acceptRecovery,
    discardRecovery,
    createNote,
    createTocGroup,
    renameTocNode,
    moveTocNode,
    toggleDone,
    previewDeleteNode,
    deleteNode,
    ensureDocument,
    getDocumentSession
  }
})
