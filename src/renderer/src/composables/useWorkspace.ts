import { ref, computed } from 'vue'
import type { GitStatus, NoteViewMode, PreviewState, TocNode } from '../types'

const workspacePath = ref<string | null>(null)
const knowledgeList = ref<string[]>([])
const gitStatuses = ref<Record<string, GitStatus>>({})
const selectedRepo = ref<string | null>(null)
const toc = ref<TocNode[]>([])
const selectedNoteDir = ref<string | null>(null)
const noteContent = ref('')
const notePath = ref<string | null>(null)
const dirty = ref(false)
const loading = ref(false)
const gitBusy = ref(false)
const error = ref<string | null>(null)
const status = ref<string | null>(null)

const noteMode = ref<NoteViewMode>('code')
const previewBusy = ref(false)
const previewUrl = ref<string | null>(null)
const previewState = ref<PreviewState>({
  repo: null,
  port: null,
  status: 'idle',
  error: null,
  baseUrl: null
})

export function useWorkspace() {
  const hasWorkspace = computed(() => Boolean(workspacePath.value))
  const selectedGitStatus = computed(() =>
    selectedRepo.value ? (gitStatuses.value[selectedRepo.value] ?? null) : null
  )

  function setGitStatus(next: GitStatus): void {
    gitStatuses.value = {
      ...gitStatuses.value,
      [next.repo]: next
    }
  }

  function clearNoteSelection(): void {
    selectedNoteDir.value = null
    noteContent.value = ''
    notePath.value = null
    dirty.value = false
    previewUrl.value = null
  }

  async function refreshGitStatuses(): Promise<void> {
    if (!workspacePath.value) {
      gitStatuses.value = {}
      return
    }
    const list = await window.api.gitStatusAll()
    const map: Record<string, GitStatus> = {}
    for (const item of list) {
      map[item.repo] = item
    }
    gitStatuses.value = map
  }

  async function refreshKnowledge(): Promise<void> {
    if (!workspacePath.value) {
      knowledgeList.value = []
      gitStatuses.value = {}
      return
    }
    knowledgeList.value = await window.api.listKnowledge()
    await refreshGitStatuses()
  }

  async function syncPreviewUrl(): Promise<void> {
    if (!selectedRepo.value || !selectedNoteDir.value) {
      previewUrl.value = null
      return
    }
    previewUrl.value = await window.api.previewNoteUrl(selectedRepo.value, selectedNoteDir.value)
    console.log('[desk:preview:ui] url', previewUrl.value)
  }

  async function ensurePreview(forceRestart = false): Promise<void> {
    if (!selectedRepo.value || !selectedNoteDir.value) {
      previewUrl.value = null
      return
    }

    console.log('[desk:preview:ui] ensurePreview', {
      repo: selectedRepo.value,
      note: selectedNoteDir.value,
      forceRestart,
      state: { ...previewState.value }
    })

    if (
      !forceRestart &&
      previewState.value.repo === selectedRepo.value &&
      previewState.value.status === 'ready'
    ) {
      await syncPreviewUrl()
      return
    }

    previewBusy.value = true
    try {
      if (forceRestart) {
        console.log('[desk:preview:ui] force restart → stop')
        await window.api.previewStop()
      }
      const state = await window.api.previewStart(selectedRepo.value)
      previewState.value = state
      console.log('[desk:preview:ui] start result', { ...state })
      if (state.status === 'error') {
        previewUrl.value = null
        return
      }
      await syncPreviewUrl()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      console.error('[desk:preview:ui] ensurePreview failed', message)
      previewState.value = {
        ...previewState.value,
        status: 'error',
        error: message
      }
      previewUrl.value = null
    } finally {
      previewBusy.value = false
    }
  }

  async function setNoteMode(mode: NoteViewMode): Promise<void> {
    console.log('[desk:preview:ui] setNoteMode', mode)
    noteMode.value = mode
    if (mode === 'preview') {
      await ensurePreview(false)
    }
  }

  async function init(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const state = await window.api.getWorkspace()
      workspacePath.value = state.path
      previewState.value = await window.api.previewStatus()
      if (state.path) {
        await refreshKnowledge()
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function chooseWorkspace(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      await window.api.previewStop()
      previewState.value = await window.api.previewStatus()
      const state = await window.api.chooseWorkspace()
      workspacePath.value = state.path
      selectedRepo.value = null
      toc.value = []
      clearNoteSelection()
      noteMode.value = 'code'
      await refreshKnowledge()
      status.value = state.path ? `已选择工作区` : null
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function selectRepo(repo: string): Promise<void> {
    if (dirty.value && !confirm('当前笔记未保存，确定切换知识库？')) {
      return
    }
    const previous = selectedRepo.value
    selectedRepo.value = repo
    clearNoteSelection()
    error.value = null

    if (previous && previous !== repo && noteMode.value === 'preview') {
      await window.api.previewStop()
      previewState.value = await window.api.previewStatus()
    }

    try {
      toc.value = await window.api.readToc(repo)
      const git = await window.api.gitStatus(repo)
      setGitStatus(git)
    } catch (e) {
      toc.value = []
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function selectNote(noteDir: string): Promise<void> {
    if (!selectedRepo.value) return
    if (dirty.value && !confirm('当前笔记未保存，确定切换笔记？')) {
      return
    }
    error.value = null
    try {
      const note = await window.api.readNote(selectedRepo.value, noteDir)
      selectedNoteDir.value = noteDir
      noteContent.value = note.content
      notePath.value = note.path
      dirty.value = false
      status.value = null
      if (noteMode.value === 'preview') {
        await ensurePreview(false)
      } else {
        previewUrl.value = null
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  function updateContent(value: string): void {
    noteContent.value = value
    dirty.value = true
  }

  async function saveNote(): Promise<void> {
    if (!selectedRepo.value || !selectedNoteDir.value) return
    error.value = null
    try {
      await window.api.writeNote(selectedRepo.value, selectedNoteDir.value, noteContent.value)
      dirty.value = false
      status.value = '已保存'
      const git = await window.api.gitStatus(selectedRepo.value)
      setGitStatus(git)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function pullRepo(repo?: string): Promise<void> {
    const target = repo ?? selectedRepo.value
    if (!target) return
    gitBusy.value = true
    error.value = null
    try {
      const result = await window.api.gitPull(target)
      setGitStatus(result.status)
      if (!result.ok) {
        error.value = result.error || 'git pull 失败'
        return
      }
      status.value = result.message ? `${target}：${result.message}` : `${target} pull 完成`
      if (selectedRepo.value === target) {
        toc.value = await window.api.readToc(target)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      gitBusy.value = false
    }
  }

  async function pushRepo(repo?: string): Promise<void> {
    const target = repo ?? selectedRepo.value
    console.log('[desk:git:ui] pushRepo click', {
      arg: repo ?? null,
      selectedRepo: selectedRepo.value,
      target,
      gitBusy: gitBusy.value
    })
    if (!target) {
      console.warn('[desk:git:ui] pushRepo aborted: no selected repo')
      error.value = '请先选择一个知识库再 Push'
      return
    }
    gitBusy.value = true
    error.value = null
    try {
      console.log('[desk:git:ui] invoking gitPush (tn-like)', target)
      const result = await window.api.gitPush(target)
      console.log('[desk:git:ui] gitPush result', {
        ok: result.ok,
        error: result.error,
        message: result.message,
        stdout: result.stdout,
        stderr: result.stderr,
        status: result.status
      })
      setGitStatus(result.status)
      if (!result.ok) {
        error.value = result.error || 'git push 失败'
        return
      }
      status.value = result.message ? `${target}：${result.message}` : `${target} push 完成`
    } catch (e) {
      console.error('[desk:git:ui] gitPush threw', e)
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      gitBusy.value = false
    }
  }

  async function applySettingsAndRefresh(): Promise<void> {
    await refreshKnowledge()
    if (selectedRepo.value && !knowledgeList.value.includes(selectedRepo.value)) {
      selectedRepo.value = null
      toc.value = []
      clearNoteSelection()
      noteMode.value = 'code'
      await window.api.previewStop()
      previewState.value = await window.api.previewStatus()
    }
    status.value = '配置已保存'
  }

  async function stopPreview(): Promise<void> {
    await window.api.previewStop()
    previewState.value = await window.api.previewStatus()
    previewUrl.value = null
  }

  function noteExistsInToc(nodes: TocNode[], noteDir: string): boolean {
    for (const node of nodes) {
      if (node.type === 'note' && node.noteDir === noteDir) return true
      if (noteExistsInToc(node.children, noteDir)) return true
    }
    return false
  }

  function applyToc(nodes: TocNode[]): void {
    toc.value = nodes
    if (selectedNoteDir.value && !noteExistsInToc(nodes, selectedNoteDir.value)) {
      clearNoteSelection()
    }
  }

  return {
    workspacePath,
    knowledgeList,
    gitStatuses,
    selectedRepo,
    selectedGitStatus,
    toc,
    selectedNoteDir,
    noteContent,
    notePath,
    dirty,
    loading,
    gitBusy,
    error,
    status,
    hasWorkspace,
    noteMode,
    previewBusy,
    previewUrl,
    previewState,
    init,
    chooseWorkspace,
    selectRepo,
    selectNote,
    updateContent,
    saveNote,
    refreshGitStatuses,
    pullRepo,
    pushRepo,
    applySettingsAndRefresh,
    setNoteMode,
    ensurePreview,
    stopPreview,
    applyToc
  }
}
