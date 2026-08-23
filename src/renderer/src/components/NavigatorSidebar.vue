<script setup lang="ts">
import { computed, ref } from 'vue'

import TocNodeList from './TocNodeList.vue'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { DeskTocNode } from '../../../shared/contracts'

const emit = defineEmits<{
  createNote: []
  requestDelete: [node: DeskTocNode]
}>()

const store = useWorkspaceStore()
const editor = useEditorStore()
const query = ref('')

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

const previewState = computed(() =>
  store.selectedKnowledgeBaseId
    ? (editor.previewStates[store.selectedKnowledgeBaseId] ?? null)
    : null
)

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
      <input v-model="query" type="search" placeholder="筛选当前目录" />
    </div>

    <div v-if="store.knowledgeBase" class="navigator-body">
      <section class="changes-section">
        <button type="button" class="section-heading">
          <span>⌄</span>
          <strong>变更</strong>
          <em>0</em>
        </button>
        <div class="changes-empty">Git 文件状态将在后续阶段接入</div>
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
      </section>

      <section class="toc-section">
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
          @request-delete="emit('requestDelete', $event)"
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

.toc-section {
  margin-top: 4px;
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

.column-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 11px;
}
</style>
