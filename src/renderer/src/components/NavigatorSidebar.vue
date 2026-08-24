<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import TocNodeList from './TocNodeList.vue'
import UiTooltip from './UiTooltip.vue'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { DeskTocNode } from '../../../shared/contracts'

const emit = defineEmits<{
  createNote: [node?: DeskTocNode, placement?: 'before' | 'after' | 'inside']
  createGroup: []
  requestRename: [node: DeskTocNode]
  requestDelete: [node: DeskTocNode]
}>()

const store = useWorkspaceStore()
const editor = useEditorStore()
const query = ref('')
const changesExpanded = ref(true)
const createMenuOpen = ref(false)
const createMenu = ref<HTMLElement | null>(null)
const previewBusy = ref(false)
let searchTimer: ReturnType<typeof setTimeout> | null = null

function closeCreateMenu(event: MouseEvent): void {
  if (createMenu.value?.contains(event.target as Node)) return
  createMenuOpen.value = false
}

onMounted(() => document.addEventListener('mousedown', closeCreateMenu))

function filterNodes(nodes: DeskTocNode[], needle: string): DeskTocNode[] {
  if (!needle) return nodes
  return nodes.flatMap((node): DeskTocNode[] => {
    const children = filterNodes(node.children, needle)
    const matches =
      node.title.toLocaleLowerCase().includes(needle) ||
      (node.type === 'note' && node.noteIndex.includes(needle))
    return matches || children.length ? [{ ...node, children }] : []
  })
}

const visibleToc = computed(() =>
  filterNodes(store.knowledgeBase?.toc ?? [], query.value.trim().toLocaleLowerCase())
)

watch([() => query.value, () => store.selectedKnowledgeBaseId], () => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    searchTimer = null
    void store.searchNotes(query.value)
  }, 180)
})

onUnmounted(() => {
  if (searchTimer) clearTimeout(searchTimer)
  document.removeEventListener('mousedown', closeCreateMenu)
})

const previewState = computed(() =>
  store.selectedKnowledgeBaseId
    ? (editor.previewStates[store.selectedKnowledgeBaseId] ?? null)
    : null
)

const gitState = computed(() =>
  store.selectedKnowledgeBaseId ? (store.gitStates[store.selectedKnowledgeBaseId] ?? null) : null
)
const selectedTocNoteUuid = computed(() => {
  const tab = editor.activeTab
  return tab?.type === 'note' && tab.knowledgeBaseId === store.selectedKnowledgeBaseId
    ? tab.noteUuid
    : null
})
const tocFocusRequestId = computed(() => {
  const request = store.tocFocusRequest
  return request?.knowledgeBaseId === store.selectedKnowledgeBaseId &&
    request.noteUuid === selectedTocNoteUuid.value
    ? request.sequence
    : undefined
})

watch(
  tocFocusRequestId,
  (requestId) => {
    if (requestId && query.value) query.value = ''
  },
  { flush: 'sync' }
)

const statusSymbol: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: '?',
  conflicted: '!'
}

function showNoteMenu(noteUuid: string): void {
  if (!store.selectedKnowledgeBaseId) return
  void window.desk.ide.showNoteMenu(store.selectedKnowledgeBaseId, noteUuid)
}

async function revealKnowledgeBase(): Promise<void> {
  if (!store.knowledgeBase) return
  const result = await window.desk.workspace.revealKnowledgeBase(store.knowledgeBase.id)
  if (!result.ok) store.error = result.error.message
}

function showKnowledgeBaseMenu(): void {
  if (store.knowledgeBase) void window.desk.ide.showKnowledgeBaseMenu(store.knowledgeBase.id)
}

async function togglePreview(): Promise<void> {
  if (!store.selectedKnowledgeBaseId || previewBusy.value) return
  previewBusy.value = true
  try {
    if (previewState.value?.status === 'ready' || previewState.value?.status === 'starting') {
      await editor.stopPreview(store.selectedKnowledgeBaseId)
    } else {
      const currentNote =
        store.document?.knowledgeBaseId === store.selectedKnowledgeBaseId
          ? store.document.dirName
          : undefined
      await editor.startPreview(store.selectedKnowledgeBaseId, currentNote)
    }
  } catch (cause) {
    store.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    previewBusy.value = false
  }
}

function chooseHeaderAction(action: 'group' | 'preview' | 'reveal' | 'ide'): void {
  createMenuOpen.value = false
  if (action === 'group') emit('createGroup')
  else if (action === 'preview') void togglePreview()
  else if (action === 'reveal') void revealKnowledgeBase()
  else showKnowledgeBaseMenu()
}

const previewLabel = computed(() => {
  if (previewBusy.value || previewState.value?.status === 'starting') return '正在启动站点预览'
  if (previewState.value?.status === 'ready') return '停止站点预览'
  if (previewState.value?.status === 'error') return '重新启动站点预览'
  return '启动站点预览'
})
</script>

<template>
  <aside class="navigator-sidebar">
    <header class="navigator-header">
      <div class="navigator-title">
        <span>文章</span>
        <strong>{{ store.selectedKnowledgeBase?.displayName ?? '未选择' }}</strong>
      </div>
      <div ref="createMenu" class="header-actions" :class="{ open: createMenuOpen }">
        <UiTooltip label="更多笔记操作">
          <button
            type="button"
            class="menu-button"
            aria-label="更多笔记操作"
            :aria-expanded="createMenuOpen"
            :disabled="!store.knowledgeBase || store.knowledgeBase.health !== 'ready'"
            @click="createMenuOpen = !createMenuOpen"
          >
            ⋯
          </button>
        </UiTooltip>
        <UiTooltip label="添加笔记">
          <button
            type="button"
            class="new-button"
            aria-label="添加笔记"
            :disabled="!store.knowledgeBase || store.knowledgeBase.health !== 'ready'"
            @click="emit('createNote')"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
          </button>
        </UiTooltip>
        <div v-if="createMenuOpen" class="create-menu">
          <button type="button" @click="chooseHeaderAction('group')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg>
            <span><strong>新建分组</strong><small>整理 TOC.md 目录结构</small></span>
          </button>
          <button type="button" @click="chooseHeaderAction('preview')">
            <svg v-if="previewState?.status === 'ready'" viewBox="0 0 24 24" aria-hidden="true">
              <rect x="7" y="7" width="10" height="10" rx="1" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6V6Z" /></svg>
            <span
              ><strong>{{ previewLabel }}</strong
              ><small>在网页标签中查看站点</small></span
            >
          </button>
          <hr />
          <button type="button" @click="chooseHeaderAction('ide')">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M7 4h10v16H7zM4 8h3M17 8h3" />
            </svg>
            <span><strong>使用 IDE 打开</strong><small>跟随设置中的 IDE 配置</small></span>
          </button>
          <button type="button" @click="chooseHeaderAction('reveal')">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h7l2 2h9v11H3z" /></svg>
            <span><strong>打开知识库目录</strong><small>在 Finder 中显示</small></span>
          </button>
        </div>
      </div>
    </header>

    <div
      v-if="previewBusy || previewState?.status === 'starting' || previewState?.status === 'error'"
      class="preview-feedback"
      :class="previewState?.status"
    >
      <span v-if="previewBusy || previewState?.status === 'starting'">
        正在启动 {{ store.selectedKnowledgeBase?.displayName }} 站点预览…
      </span>
      <template v-else>
        <span>预览启动失败：{{ previewState?.error ?? '未知错误' }}</span>
        <button type="button" @click="togglePreview">重试</button>
      </template>
    </div>

    <div class="search-wrap">
      <span>⌕</span>
      <input v-model="query" type="search" placeholder="搜索标题和正文" />
    </div>

    <div v-if="store.knowledgeBase" class="navigator-body">
      <section class="changes-section">
        <div class="section-heading git-heading">
          <button type="button" class="change-toggle" @click="changesExpanded = !changesExpanded">
            {{ changesExpanded ? '⌄' : '›' }}
          </button>
          <strong>变更</strong>
          <span v-if="gitState?.behind" class="behind-state">↓{{ gitState.behind }}</span>
          <em>{{ gitState?.changes.length ?? 0 }}</em>
          <div class="git-actions">
            <UiTooltip label="刷新 Git 状态">
              <button
                type="button"
                aria-label="刷新本地 Git 状态"
                :disabled="Boolean(gitState?.busy)"
                @click="store.refreshGit(store.selectedKnowledgeBaseId ?? undefined)"
              >
                ↻
              </button>
            </UiTooltip>
            <UiTooltip label="拉取远端更新">
              <button
                type="button"
                aria-label="获取并拉取远端更新"
                :disabled="!gitState?.initialized || Boolean(gitState.busy)"
                @click="store.pullGit(store.selectedKnowledgeBaseId!)"
              >
                ⇣
              </button>
            </UiTooltip>
            <UiTooltip label="提交并推送">
              <button
                type="button"
                aria-label="提交并推送当前变更"
                :disabled="!gitState?.initialized || Boolean(gitState.busy)"
                @click="store.requestGitPublish(store.selectedKnowledgeBaseId!)"
              >
                ⇡
              </button>
            </UiTooltip>
          </div>
        </div>
        <template v-if="changesExpanded">
          <button
            v-for="change in gitState?.changes ?? []"
            :key="`${change.status}:${change.path}`"
            type="button"
            class="change-item"
            :class="change.status"
            :disabled="!change.noteUuid"
            @click="
              change.noteUuid &&
              store.openNoteByUuid(store.selectedKnowledgeBaseId!, change.noteUuid)
            "
            @contextmenu.prevent="change.noteUuid && showNoteMenu(change.noteUuid)"
          >
            <span>{{ statusSymbol[change.status] }}</span>
            <span>
              <strong v-if="change.noteUuid">{{ change.noteIndex }} {{ change.noteTitle }}</strong>
              <strong v-else>{{ change.path }}</strong>
              <small v-if="change.noteUuid">{{ change.path }}</small>
            </span>
          </button>
          <div v-if="gitState?.busy" class="changes-empty">
            {{
              gitState.busy === 'publish'
                ? '正在提交并推送…'
                : gitState.busy === 'pull'
                  ? '正在拉取…'
                  : '正在获取远端状态…'
            }}
          </div>
          <div v-else-if="gitState?.error" class="changes-empty git-error">
            {{ gitState.error }}
          </div>
          <div v-else-if="!gitState?.initialized" class="changes-empty">当前目录不是 Git 仓库</div>
          <div v-else-if="!gitState.changes.length" class="changes-empty">工作区干净</div>
        </template>
      </section>

      <section v-if="store.knowledgeBase.health !== 'ready'" class="diagnostics">
        <strong>配置异常，当前知识库只读</strong>
        <ul>
          <li
            v-for="diagnostic in store.knowledgeBase.diagnostics"
            :key="`${diagnostic.code}:${diagnostic.path ?? ''}`"
          >
            {{ diagnostic.message }}
          </li>
        </ul>
        <div class="diagnostic-actions">
          <button type="button" @click="store.refreshWorkspace">重新检查</button>
          <button type="button" @click="revealKnowledgeBase">打开目录</button>
          <button type="button" @click="showKnowledgeBaseMenu">用 IDE 查看</button>
        </div>
      </section>

      <section v-if="query.trim()" class="search-results-section">
        <div class="section-heading static">
          <span>⌕</span>
          <strong>搜索结果</strong>
          <em>{{ store.searchResults.length }}</em>
        </div>
        <div v-if="store.searchLoading" class="changes-empty">正在查询后台索引…</div>
        <button
          v-for="result in store.searchResults"
          v-else
          :key="`${result.knowledgeBaseId}:${result.noteUuid}`"
          type="button"
          class="search-result"
          @click="store.openNoteByUuid(result.knowledgeBaseId, result.noteUuid)"
        >
          <span
            ><em>{{ result.noteIndex }}</em
            ><strong>{{ result.title }}</strong></span
          >
          <small>{{ result.snippet }}</small>
        </button>
        <div v-if="!store.searchLoading && !store.searchResults.length" class="toc-empty">
          没有匹配标题或正文的笔记
        </div>
      </section>

      <section v-else class="toc-section">
        <div class="section-heading static">
          <span>⌄</span>
          <strong>目录</strong>
          <em>{{ store.knowledgeBase.noteCount }}</em>
        </div>
        <TocNodeList
          v-if="visibleToc.length"
          :nodes="visibleToc"
          :selected-note-uuid="selectedTocNoteUuid"
          :focus-request-id="tocFocusRequestId"
          @select="store.selectNote"
          @select-permanent="store.selectNote($event, undefined, true)"
          @select-split="store.selectNote($event, 'right')"
          @toggle-done="store.toggleDone"
          @request-create="(node, placement) => emit('createNote', node, placement)"
          @request-rename="emit('requestRename', $event)"
          @request-delete="emit('requestDelete', $event)"
          @move="store.moveTocNode"
          @open-ide="showNoteMenu($event.uuid)"
        />
        <div v-else class="toc-empty">{{ query ? '没有匹配项' : 'TOC.md 中没有条目' }}</div>
      </section>
    </div>

    <div v-else class="column-empty">从左侧选择一个知识库</div>
  </aside>
</template>

<style scoped>
.navigator-sidebar {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--panel);
  border-right: 1px solid var(--border);
}

.navigator-header {
  height: 64px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px 8px 13px;
  border-bottom: 1px solid var(--border);
}

.navigator-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.navigator-title span {
  color: var(--muted);
  font-size: 10px;
}

.navigator-title strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 650;
}

.new-button,
.menu-button {
  height: 28px;
  width: 28px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--raised);
  color: var(--text);
  cursor: pointer;
  font-size: 18px;
}

.new-button {
  display: grid;
  place-items: center;
}

.new-button svg {
  width: 15px;
  height: 15px;
}

.menu-button {
  line-height: 20px;
}

.new-button svg,
.create-menu svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.header-actions {
  position: relative;
  display: flex;
  gap: 6px;
}

.header-actions.open :deep(.ui-tooltip-popover) {
  display: none;
}

.create-menu {
  position: absolute;
  z-index: 80;
  top: 35px;
  right: 0;
  width: 184px;
  overflow: hidden;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--raised);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.34);
  padding: 4px;
}

.create-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  padding: 8px;
  text-align: left;
  cursor: pointer;
}

.create-menu button:hover {
  background: var(--hover);
}

.create-menu hr {
  border: 0;
  border-top: 1px solid var(--border);
  margin: 4px 6px;
}

.create-menu svg {
  width: 18px;
  height: 18px;
  flex: none;
  color: var(--accent-strong);
}

.create-menu span {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.create-menu strong {
  font-size: 10px;
  font-weight: 620;
}

.create-menu small {
  color: var(--muted);
  font-size: 8px;
}

.new-button:hover:not(:disabled),
.menu-button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.new-button:disabled,
.menu-button:disabled {
  opacity: 0.4;
}

.preview-feedback {
  min-height: 30px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--accent) 8%, var(--panel));
  padding: 5px 10px;
  color: var(--muted);
  font-size: 9px;
}

.preview-feedback.error {
  background: var(--danger-soft);
  color: var(--danger);
}

.preview-feedback > span {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  display: -webkit-box;
  overflow: hidden;
  line-height: 1.35;
  white-space: normal;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.preview-feedback button {
  flex: none;
  border: 1px solid currentColor;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 3px 7px;
  font-size: 9px;
}

.search-wrap {
  height: 43px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 9px;
  border-bottom: 1px solid var(--border);
}

.search-wrap > span {
  position: absolute;
  margin-left: 9px;
  color: var(--muted);
  pointer-events: none;
}

.search-wrap input {
  width: 100%;
  height: 28px;
  border: 1px solid transparent;
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--text);
  padding: 0 9px 0 28px;
  font-size: 11px;
}

.search-wrap input:focus {
  border-color: var(--accent);
}

.navigator-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 7px;
}

.section-heading {
  width: 100%;
  height: 27px;
  display: flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 0 5px;
  text-align: left;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.section-heading strong {
  flex: 1;
  font-weight: 700;
}

.section-heading em {
  min-width: 18px;
  border-radius: 9px;
  background: var(--raised);
  padding: 1px 5px;
  text-align: center;
  font-style: normal;
  font-size: 9px;
}

.changes-empty,
.toc-empty {
  color: var(--muted);
  padding: 3px 25px 9px;
  font-size: 10px;
}

.git-heading {
  text-transform: none;
  letter-spacing: 0;
}

.change-toggle,
.git-actions button {
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.change-toggle {
  width: 18px;
  padding: 0;
  font-size: 15px;
}

.git-actions {
  display: flex;
  gap: 1px;
  margin-left: 3px;
}

.git-actions button {
  width: 21px;
  height: 21px;
  padding: 0;
  font-size: 11px;
}

.git-actions button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.git-actions button:disabled {
  opacity: 0.35;
}

.behind-state {
  color: var(--warning);
  font-size: 9px;
  font-weight: 700;
}

.change-item {
  width: 100%;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  padding: 5px 7px 5px 12px;
  text-align: left;
}

.change-item:not(:disabled) {
  cursor: pointer;
}

.change-item:not(:disabled):hover {
  background: var(--hover);
}

.change-item > span:first-child {
  width: 11px;
  flex: none;
  color: var(--warning);
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 750;
}

.change-item.conflicted > span:first-child {
  color: var(--danger);
}

.change-item > span:last-child {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.change-item strong,
.change-item small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.change-item strong {
  font-size: 10px;
  font-weight: 560;
}

.change-item small {
  color: var(--muted);
  font-size: 8px;
}

.git-error {
  color: var(--danger);
}

.toc-section {
  margin-top: 4px;
}

.search-results-section {
  margin-top: 4px;
}

.search-result {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  padding: 7px 8px;
  text-align: left;
  cursor: pointer;
}

.search-result:hover {
  background: var(--hover);
}

.search-result > span {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 7px;
}

.search-result em {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 9px;
  font-style: normal;
}

.search-result strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 630;
}

.search-result small {
  display: -webkit-box;
  overflow: hidden;
  color: var(--muted);
  font-size: 9px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.diagnostics {
  margin: 7px 4px;
  padding: 9px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
  border-radius: 7px;
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 10px;
}

.diagnostics strong {
  font-size: 11px;
}

.diagnostics ul {
  margin: 6px 0 0;
  padding-left: 15px;
}

.diagnostic-actions {
  display: flex;
  gap: 5px;
  margin-top: 8px;
}

.diagnostic-actions button {
  height: 25px;
  border: 1px solid color-mix(in srgb, var(--danger) 35%, var(--border));
  border-radius: 5px;
  background: transparent;
  color: var(--danger);
  cursor: pointer;
  padding: 0 7px;
  font-size: 9px;
}

.column-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 11px;
}
</style>
