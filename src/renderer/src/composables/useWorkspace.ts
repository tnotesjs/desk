import { ref, computed } from 'vue'
import type { GitStatus, TocNode } from '../types'

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

  async function init(): Promise<void> {
    loading.value = true
    error.value = null
    try {
      const state = await window.api.getWorkspace()
      workspacePath.value = state.path
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
      const state = await window.api.chooseWorkspace()
      workspacePath.value = state.path
      selectedRepo.value = null
      toc.value = []
      selectedNoteDir.value = null
      noteContent.value = ''
      notePath.value = null
      dirty.value = false
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
    selectedRepo.value = repo
    selectedNoteDir.value = null
    noteContent.value = ''
    notePath.value = null
    dirty.value = false
    error.value = null
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
      status.value = `${target} pull 完成`
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
    if (!target) return
    gitBusy.value = true
    error.value = null
    try {
      const result = await window.api.gitPush(target)
      setGitStatus(result.status)
      if (!result.ok) {
        error.value = result.error || 'git push 失败'
        return
      }
      status.value = `${target} push 完成`
    } catch (e) {
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
      selectedNoteDir.value = null
      noteContent.value = ''
      notePath.value = null
      dirty.value = false
    }
    status.value = '配置已保存'
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
    init,
    chooseWorkspace,
    selectRepo,
    selectNote,
    updateContent,
    saveNote,
    refreshGitStatuses,
    pullRepo,
    pushRepo,
    applySettingsAndRefresh
  }
}
