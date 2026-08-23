<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import EditorPane from './components/EditorPane.vue'
import KnowledgeSidebar from './components/KnowledgeSidebar.vue'
import NavigatorSidebar from './components/NavigatorSidebar.vue'
import { useEditorStore } from './stores/editor'
import { useWorkspaceStore } from './stores/workspace'

import type { DeletePreviewDto, DeskTocNode } from '../../shared/contracts'

const store = useWorkspaceStore()
const editor = useEditorStore()
const createDialogOpen = ref(false)
const createTitle = ref('')
const deletePreview = ref<DeletePreviewDto | null>(null)
const recoveryCandidate = computed(() => store.pendingRecoveries[0] ?? null)
const dialogBusy = ref(false)
let sessionTimer: ReturnType<typeof setTimeout> | null = null

const workspaceColumns = computed(() => {
  const knowledgeWidth = editor.knowledgeSidebarCollapsed ? 48 : editor.knowledgeSidebarWidth
  const navigatorWidth = editor.navigatorSidebarCollapsed ? 0 : editor.navigatorSidebarWidth
  return `${knowledgeWidth}px ${navigatorWidth}px minmax(0, 1fr)`
})

async function persistSession(): Promise<void> {
  const result = await window.desk.session.save(editor.toSession(store.selectedKnowledgeBaseId))
  if (!result.ok) store.error = `无法保存工作区会话：${result.error.message}`
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void store.saveCurrentDocument().catch(() => undefined)
  }
}

function openCreateDialog(): void {
  createTitle.value = ''
  createDialogOpen.value = true
}

async function confirmCreate(): Promise<void> {
  const title = createTitle.value.trim()
  if (!title || dialogBusy.value) return
  dialogBusy.value = true
  try {
    await store.createNote(title)
    createDialogOpen.value = false
  } finally {
    dialogBusy.value = false
  }
}

async function requestDelete(node: DeskTocNode): Promise<void> {
  dialogBusy.value = true
  try {
    deletePreview.value = await store.previewDeleteNode(node)
  } finally {
    dialogBusy.value = false
  }
}

async function confirmDelete(): Promise<void> {
  if (!deletePreview.value || dialogBusy.value) return
  dialogBusy.value = true
  try {
    await store.deleteNode(deletePreview.value)
    deletePreview.value = null
  } finally {
    dialogBusy.value = false
  }
}

watch(
  () => editor.activeTab?.id,
  () => void store.syncToActiveTab()
)

watch(
  [
    () => editor.layout,
    () => editor.activeGroupId,
    () => store.selectedKnowledgeBaseId,
    () => editor.knowledgeSidebarWidth,
    () => editor.navigatorSidebarWidth,
    () => editor.knowledgeSidebarCollapsed,
    () => editor.navigatorSidebarCollapsed,
    () => editor.expandedTocNodes
  ],
  () => {
    if (!store.hasWorkspace) return
    if (sessionTimer) clearTimeout(sessionTimer)
    sessionTimer = setTimeout(() => {
      sessionTimer = null
      void persistSession()
    }, 450)
  },
  { deep: true }
)

watch(
  () => createDialogOpen.value || Boolean(deletePreview.value) || Boolean(recoveryCandidate.value),
  (modalOpen) => {
    if (modalOpen) {
      void window.desk.web.hideAll()
    } else {
      requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
    }
  }
)

onMounted(async () => {
  window.addEventListener('keydown', onKeydown)
  await store.initialize()
  await persistSession()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (sessionTimer) clearTimeout(sessionTimer)
  if (store.hasWorkspace) {
    void persistSession()
  }
  store.dispose()
})
</script>

<template>
  <div class="desk-shell">
    <header class="titlebar">
      <div class="traffic-space" />
      <div class="brand">
        <span class="brand-mark">T</span>
        <strong>TNotes Desk</strong>
      </div>
      <div class="workspace-name" :title="store.overview.path ?? ''">
        {{ store.overview.path ?? '未选择工作区' }}
      </div>
      <div class="titlebar-actions">
        <span v-if="store.saving" class="sync-state">正在保存</span>
        <span v-else-if="store.dirty" class="sync-state dirty">未保存</span>
        <button type="button" title="设置（后续阶段）">⚙</button>
      </div>
    </header>

    <div v-if="store.error" class="global-banner error">
      <span>{{ store.error }}</span>
      <button type="button" @click="store.error = null">×</button>
    </div>
    <div v-else-if="store.status" class="global-banner status">
      <span>{{ store.status }}</span>
      <button type="button" @click="store.status = null">×</button>
    </div>

    <main
      v-if="store.hasWorkspace"
      class="workspace-layout"
      :style="{ gridTemplateColumns: workspaceColumns }"
    >
      <KnowledgeSidebar />
      <NavigatorSidebar @create-note="openCreateDialog" @request-delete="requestDelete" />
      <EditorPane />
    </main>

    <main v-else class="welcome">
      <div class="welcome-card">
        <span class="welcome-mark">T</span>
        <h1>打开你的 TNotes 工作区</h1>
        <p>Desk 会扫描所选目录下的 TNotes.* 直接子目录，不会克隆或修改其他目录。</p>
        <button type="button" :disabled="store.loading" @click="store.chooseWorkspace">
          {{ store.loading ? '正在检查…' : '选择工作区' }}
        </button>
        <small>体验时请选择 desk/playground</small>
      </div>
    </main>

    <div v-if="createDialogOpen" class="dialog-backdrop" @mousedown.self="createDialogOpen = false">
      <form class="dialog" @submit.prevent="confirmCreate">
        <header>
          <div>
            <span>新建笔记</span>
            <strong>添加到目录根节点</strong>
          </div>
          <button type="button" @click="createDialogOpen = false">×</button>
        </header>
        <label>
          <span>标题</span>
          <input v-model="createTitle" autofocus placeholder="例如：Desk 使用说明" />
        </label>
        <footer>
          <button type="button" class="secondary" @click="createDialogOpen = false">取消</button>
          <button type="submit" class="primary" :disabled="!createTitle.trim() || dialogBusy">
            创建
          </button>
        </footer>
      </form>
    </div>

    <div v-if="deletePreview" class="dialog-backdrop" @mousedown.self="deletePreview = null">
      <section class="dialog danger-dialog">
        <header>
          <div>
            <span>永久删除</span>
            <strong>这个操作无法通过 Desk 找回</strong>
          </div>
          <button type="button" @click="deletePreview = null">×</button>
        </header>
        <div class="delete-summary">
          <div>
            <strong>{{ deletePreview.notes.length }}</strong
            ><span>篇笔记</span>
          </div>
          <div>
            <strong>{{ deletePreview.filePaths.length }}</strong
            ><span>个文件</span>
          </div>
          <div>
            <strong>{{ deletePreview.directoryPaths.length }}</strong
            ><span>个目录</span>
          </div>
        </div>
        <p>
          文件将被直接永久删除，不进入系统废纸篓。Git 未跟踪文件检查会在 Git 模块接入后显示在这里。
        </p>
        <footer>
          <button type="button" class="secondary" @click="deletePreview = null">取消</button>
          <button type="button" class="danger" :disabled="dialogBusy" @click="confirmDelete">
            确认永久删除
          </button>
        </footer>
      </section>
    </div>

    <div v-if="recoveryCandidate" class="dialog-backdrop">
      <section class="dialog recovery-dialog">
        <header>
          <div>
            <span>发现未保存的编辑</span>
            <strong>{{ recoveryCandidate.title }}</strong>
          </div>
        </header>
        <p>
          Desk 在上次异常结束前保存了恢复快照，时间为
          {{
            new Date(recoveryCandidate.updatedAt).toLocaleString()
          }}。它不是历史版本；处理后只会保留正常的 Git 历史。
        </p>
        <div class="recovery-preview">{{ recoveryCandidate.content.slice(0, 480) }}</div>
        <footer>
          <button type="button" class="secondary" @click="store.discardRecovery(recoveryCandidate)">
            丢弃快照
          </button>
          <button type="button" class="primary" @click="store.acceptRecovery(recoveryCandidate)">
            恢复到编辑器
          </button>
        </footer>
      </section>
    </div>
  </div>
</template>

<style scoped>
.desk-shell {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--app-bg);
  color: var(--text);
}

.recovery-preview {
  max-height: 180px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  padding: 10px;
  white-space: pre-wrap;
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1.55;
}

.titlebar {
  height: 42px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 13px;
  padding: 0 9px;
  border-bottom: 1px solid var(--border);
  background: var(--titlebar-bg);
  -webkit-app-region: drag;
}

.traffic-space {
  width: 58px;
  flex: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11px;
}

.brand strong {
  font-weight: 650;
}

.brand-mark,
.welcome-mark {
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: linear-gradient(145deg, #68a7ff, #8a72ff);
  color: white;
  font-weight: 800;
}

.brand-mark {
  width: 21px;
  height: 21px;
  font-size: 11px;
}

.workspace-name {
  flex: 1;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 10px;
}

.titlebar-actions {
  width: 130px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  -webkit-app-region: no-drag;
}

.titlebar-actions button {
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.titlebar-actions button:hover {
  background: var(--hover);
  color: var(--text);
}

.sync-state {
  color: var(--muted);
  font-size: 9px;
}

.sync-state.dirty {
  color: var(--warning);
}

.workspace-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 218px 292px minmax(0, 1fr);
}

.global-banner {
  min-height: 31px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 14px;
  border-bottom: 1px solid var(--border);
  font-size: 10px;
}

.global-banner span {
  flex: 1;
}

.global-banner button {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.global-banner.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.global-banner.status {
  background: var(--success-soft);
  color: var(--success);
}

.welcome {
  flex: 1;
  display: grid;
  place-items: center;
  background:
    radial-gradient(circle at 50% 30%, rgba(92, 129, 255, 0.09), transparent 36%), var(--app-bg);
}

.welcome-card {
  width: min(430px, calc(100% - 40px));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 11px;
  text-align: center;
}

.welcome-mark {
  width: 54px;
  height: 54px;
  margin-bottom: 7px;
  border-radius: 15px;
  font-size: 26px;
}

.welcome-card h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 680;
}

.welcome-card p {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.65;
}

.welcome-card > button {
  height: 34px;
  border: 0;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  padding: 0 16px;
  cursor: pointer;
  font-weight: 650;
  font-size: 12px;
}

.welcome-card small {
  color: var(--muted);
  font-size: 9px;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: rgba(3, 6, 12, 0.58);
  backdrop-filter: blur(3px);
}

.dialog {
  width: min(430px, calc(100% - 32px));
  border: 1px solid var(--border-strong);
  border-radius: 11px;
  background: var(--raised);
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.45);
  overflow: hidden;
}

.dialog header {
  display: flex;
  align-items: center;
  padding: 14px 15px;
  border-bottom: 1px solid var(--border);
}

.dialog header > div {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.dialog header span {
  color: var(--muted);
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.dialog header strong {
  font-size: 13px;
  font-weight: 650;
}

.dialog header button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 18px;
}

.dialog label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 17px 15px;
  color: var(--muted);
  font-size: 10px;
}

.dialog input {
  height: 34px;
  border: 1px solid var(--border);
  border-radius: 7px;
  outline: none;
  background: var(--input-bg);
  color: var(--text);
  padding: 0 10px;
  font-size: 12px;
}

.dialog input:focus {
  border-color: var(--accent);
}

.dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 15px;
  border-top: 1px solid var(--border);
}

.dialog footer button {
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 12px;
  cursor: pointer;
  font-size: 11px;
}

.dialog footer .secondary {
  background: transparent;
  color: var(--text);
}

.dialog footer .primary {
  border-color: var(--accent);
  background: var(--accent);
  color: #fff;
}

.dialog footer .danger {
  border-color: var(--danger);
  background: var(--danger);
  color: #fff;
}

.delete-summary {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 16px 15px 8px;
}

.delete-summary > div {
  display: flex;
  flex-direction: column;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px;
}

.delete-summary strong {
  color: var(--danger);
  font-size: 18px;
}

.delete-summary span {
  color: var(--muted);
  font-size: 9px;
}

.danger-dialog p {
  margin: 0;
  padding: 8px 15px 17px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.55;
}
</style>
