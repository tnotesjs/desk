<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useWorkspace } from './composables/useWorkspace'
import WorkspaceBar from './components/WorkspaceBar.vue'
import KnowledgeList from './components/KnowledgeList.vue'
import TocTree from './components/TocTree.vue'
import NoteEditor from './components/NoteEditor.vue'
import SettingsPage from './components/SettingsPage.vue'

const view = ref<'workspace' | 'settings'>('workspace')
let unsubscribeLog: (() => void) | null = null

const {
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
} = useWorkspace()

function onKeydown(e: KeyboardEvent): void {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
    if (view.value !== 'workspace' || noteMode.value !== 'code') return
    e.preventDefault()
    void saveNote()
  }
}

async function onSettingsSaved(): Promise<void> {
  await applySettingsAndRefresh()
}

function onTocError(message: string): void {
  error.value = message
}

onMounted(() => {
  void init()
  window.addEventListener('keydown', onKeydown)
  unsubscribeLog = window.api.onLog((line) => {
    console.log(line)
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  unsubscribeLog?.()
  void stopPreview()
})
</script>

<template>
  <div class="app">
    <WorkspaceBar
      :path="workspacePath"
      :loading="loading"
      @choose="chooseWorkspace"
      @settings="view = 'settings'"
    />

    <div v-if="error" class="banner error">{{ error }}</div>
    <div v-else-if="status" class="banner status">{{ status }}</div>

    <SettingsPage
      v-if="view === 'settings'"
      @back="view = 'workspace'"
      @saved="onSettingsSaved"
    />

    <template v-else>
      <main v-if="hasWorkspace" class="layout">
        <KnowledgeList
          class="col-knowledge"
          :items="knowledgeList"
          :selected="selectedRepo"
          :statuses="gitStatuses"
          :git-busy="gitBusy"
          :selected-status="selectedGitStatus"
          @select="selectRepo"
          @refresh="refreshGitStatuses"
          @pull="pullRepo"
          @push="pushRepo"
        />
        <TocTree
          class="col-toc"
          :repo="selectedRepo"
          :nodes="toc"
          :selected-note-dir="selectedNoteDir"
          @select="selectNote"
          @updated="applyToc"
          @error="onTocError"
        />
        <NoteEditor
          class="col-editor"
          :content="noteContent"
          :note-dir="selectedNoteDir"
          :note-path="notePath"
          :dirty="dirty"
          :mode="noteMode"
          :preview-state="previewState"
          :preview-url="previewUrl"
          :preview-busy="previewBusy"
          @update:content="updateContent"
          @update:mode="setNoteMode"
          @save="saveNote"
          @retry-preview="ensurePreview(true)"
        />
      </main>

      <div v-else class="empty-workspace">
        <h1>选择一个工作区开始</h1>
        <p>
          例如本地的 <code>/Users/huyouda/tnotesjs</code>，应用会扫描其中的
          <code>TNotes.*</code> 知识库。
        </p>
        <button type="button" class="btn primary" :disabled="loading" @click="chooseWorkspace">
          选择工作区
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.app {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
  color: var(--text);
}

.banner {
  padding: 8px 14px;
  font-size: 13px;
  border-bottom: 1px solid var(--border);
}

.banner.error {
  background: #3b1515;
  color: #ffb4b4;
}

.banner.status {
  background: #14301f;
  color: #b6f0c8;
}

.layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 250px 280px 1fr;
}

.col-knowledge,
.col-toc,
.col-editor {
  min-height: 0;
}

.empty-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 32px;
  text-align: center;
}

.empty-workspace h1 {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
}

.empty-workspace p {
  margin: 0;
  max-width: 420px;
  color: var(--muted);
  line-height: 1.5;
}

.empty-workspace code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.92em;
}

.btn {
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 8px;
  padding: 10px 16px;
  cursor: pointer;
  font-size: 14px;
}

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #081018;
  font-weight: 650;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
