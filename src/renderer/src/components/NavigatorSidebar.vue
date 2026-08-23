<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import TocNodeList from './TocNodeList.vue'
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
let searchTimer: ReturnType<typeof setTimeout> | null = null

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
})

const previewState = computed(() =>
  store.selectedKnowledgeBaseId
    ? (editor.previewStates[store.selectedKnowledgeBaseId] ?? null)
    : null
)

const gitState = computed(() =>
  store.selectedKnowledgeBaseId ? (store.gitStates[store.selectedKnowledgeBaseId] ?? null) : null
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
  if (!store.selectedKnowledgeBaseId) return
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
  }
}
</script>

<template>
  <aside class="navigator-sidebar">
    <header class="navigator-header">
      <div class="navigator-title">
        <span>文章</span>
        <strong>{{ store.selectedKnowledgeBase?.displayName ?? '未选择' }}</strong>
      </div>
      <button
        type="button"
        class="new-button"
        :disabled="!store.knowledgeBase || store.knowledgeBase.health !== 'ready'"
        title="新建根笔记"
        @click="emit('createNote')"
      >
        +
      </button>
      <button
        type="button"
        class="group-button"
        :disabled="!store.knowledgeBase || store.knowledgeBase.health !== 'ready'"
        title="新建目录分组"
        @click="emit('createGroup')"
      >
        ▱+
      </button>
      <button
        type="button"
        class="preview-button"
        :class="previewState?.status"
        :disabled="!store.knowledgeBase || store.knowledgeBase.health !== 'ready'"
        :title="
          previewState?.status === 'ready' || previewState?.status === 'starting'
            ? '停止站点预览服务'
            : '启动站点预览'
        "
        @click="togglePreview"
      >
        {{
          previewState?.status === 'starting' ? '…' : previewState?.status === 'ready' ? '■' : '▶'
        }}
      </button>
    </header>

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
            <button
              type="button"
              title="刷新本地 Git 状态"
              :disabled="Boolean(gitState?.busy)"
              @click="store.refreshGit(store.selectedKnowledgeBaseId ?? undefined)"
            >
              ↻
            </button>
            <button
              type="button"
              title="获取并拉取远端更新"
              :disabled="!gitState?.initialized || Boolean(gitState.busy)"
              @click="store.pullGit(store.selectedKnowledgeBaseId!)"
            >
              ⇣
            </button>
            <button
              type="button"
              title="提交并推送当前变更"
              :disabled="!gitState?.initialized || Boolean(gitState.busy)"
              @click="store.requestGitPublish(store.selectedKnowledgeBaseId!)"
            >
              ⇡
            </button>
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
          :selected-note-uuid="store.document?.uuid ?? null"
          @select="store.selectNote"
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
.group-button,
.preview-button {
  width: 28px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--raised);
  color: var(--text);
  cursor: pointer;
  font-size: 18px;
}

.new-button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.preview-button {
  font-size: 10px;
}

.preview-button.ready,
.preview-button.starting {
  border-color: color-mix(in srgb, var(--success) 45%, var(--border));
  color: var(--success);
}

.new-button:disabled {
  opacity: 0.4;
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
