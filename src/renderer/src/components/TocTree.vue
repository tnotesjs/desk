<script setup lang="ts">
import { reactive, ref } from 'vue'
import type { TocNode } from '../types'
import TocTreeNodes from './TocTreeNodes.vue'
import iconOpened from '../assets/icons/icon__sidebar_opened.svg'
import iconCollapsed from '../assets/icons/icon__sidebar_collapsed.svg'

const props = defineProps<{
  repo: string | null
  nodes: TocNode[]
  selectedNoteDir: string | null
}>()

const emit = defineEmits<{
  select: [noteDir: string]
  updated: [nodes: TocNode[]]
  error: [message: string]
}>()

const collapsed = reactive<Record<string, boolean>>({})
const openMenu = ref<string | null>(null)
const dragSourceId = ref<string | null>(null)
const dropTargetId = ref<string | null>(null)
const dropAction = ref<'moveAfter' | 'prependChild'>('moveAfter')
const busy = ref(false)

function isCollapsed(nodeId: string): boolean {
  return collapsed[nodeId] === true
}

function toggleCollapse(nodeId: string): void {
  collapsed[nodeId] = !isCollapsed(nodeId)
}

function toggleMenu(key: string): void {
  openMenu.value = openMenu.value === key ? null : key
}

function closeMenus(): void {
  openMenu.value = null
}

async function runMutation(fn: () => Promise<TocNode[]>): Promise<void> {
  if (!props.repo || busy.value) return
  busy.value = true
  try {
    const nodes = await fn()
    emit('updated', nodes)
    closeMenus()
  } catch (e) {
    emit('error', e instanceof Error ? e.message : String(e))
  } finally {
    busy.value = false
  }
}

function promptTitle(message: string, fallback = 'new'): string | null {
  const value = window.prompt(message, fallback)
  if (value == null) return null
  const trimmed = value.trim()
  return trimmed || null
}

function onCreateNote(parent: TocNode): void {
  const title = promptTitle('新笔记标题', 'new')
  if (!title || !props.repo) return
  void runMutation(() =>
    window.api.tocCreateNotes(props.repo!, {
      title,
      count: 1,
      parentTocLineIndex: parent.tocLineIndex
    })
  )
}

function onCreateNotes(parent: TocNode): void {
  const raw = window.prompt('创建多少篇笔记？', '3')
  if (raw == null || !props.repo) return
  const count = Math.max(1, Number.parseInt(raw, 10) || 1)
  const title = promptTitle('笔记标题前缀', 'new')
  if (!title) return
  void runMutation(() =>
    window.api.tocCreateNotes(props.repo!, {
      title,
      count,
      parentTocLineIndex: parent.tocLineIndex
    })
  )
}

function onCreateFolder(parent: TocNode | null): void {
  const title = promptTitle('子目录标题', '新目录')
  if (!title || !props.repo) return
  void runMutation(() =>
    window.api.tocCreateFolder(props.repo!, {
      title,
      parentTocLineIndex: parent?.tocLineIndex
    })
  )
}

function onRenameNote(node: Extract<TocNode, { type: 'note' }>): void {
  const current = node.title.replace(/^\d{4}\.\s*/, '')
  const title = promptTitle('重命名笔记', current)
  if (!title || !props.repo) return
  void runMutation(() => window.api.tocRenameNote(props.repo!, node.noteIndex, title))
}

function onRenameFolder(node: Extract<TocNode, { type: 'group' }>): void {
  const title = promptTitle('重命名目录', node.title)
  if (!title || !props.repo) return
  void runMutation(() => window.api.tocRenameFolder(props.repo!, node.tocLineIndex, title))
}

function onDeleteNote(node: Extract<TocNode, { type: 'note' }>): void {
  if (!confirm(`删除笔记及其子树？\n${node.title}`)) return
  if (!props.repo) return
  void runMutation(() => window.api.tocDeleteNote(props.repo!, node.noteIndex))
}

function onDeleteEntry(node: TocNode): void {
  const label = node.type === 'group' ? `删除分组「${node.title}」及其子树？` : `删除「${node.title}」？`
  if (!confirm(label)) return
  if (!props.repo) return
  void runMutation(() => window.api.tocDeleteEntry(props.repo!, node.tocLineIndex))
}

function onCreateAround(node: Extract<TocNode, { type: 'note' }>, placement: 'before' | 'after'): void {
  const title = promptTitle(placement === 'before' ? '在上方插入笔记' : '在下方插入笔记', 'new')
  if (!title || !props.repo) return
  void runMutation(() =>
    window.api.tocCreateNotes(props.repo!, {
      title,
      aroundNoteIndex: node.noteIndex,
      placement
    })
  )
}

function onDragStart(nodeId: string, e: DragEvent): void {
  dragSourceId.value = nodeId
  e.dataTransfer?.setData('text/plain', nodeId)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDragOver(nodeId: string, e: DragEvent): void {
  e.preventDefault()
  if (!dragSourceId.value || dragSourceId.value === nodeId) return
  dropTargetId.value = nodeId
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (e.clientY - rect.top) / rect.height
  dropAction.value = ratio < 0.35 ? 'prependChild' : 'moveAfter'
}

function onDragLeave(nodeId: string): void {
  if (dropTargetId.value === nodeId) dropTargetId.value = null
}

async function onDrop(nodeId: string, e: DragEvent): Promise<void> {
  e.preventDefault()
  const sourceId = dragSourceId.value || e.dataTransfer?.getData('text/plain')
  dragSourceId.value = null
  dropTargetId.value = null
  if (!sourceId || !props.repo || sourceId === nodeId) return
  await runMutation(() =>
    window.api.tocReorder(props.repo!, {
      nodeId: sourceId,
      action: dropAction.value,
      targetNodeId: nodeId
    })
  )
}

function onDragEnd(): void {
  dragSourceId.value = null
  dropTargetId.value = null
}
</script>

<template>
  <aside class="col" @click="closeMenus">
    <div class="col-title">
      <span>TOC</span>
      <button
        type="button"
        class="root-add"
        title="新建根目录"
        :disabled="!repo || busy"
        @click.stop="onCreateFolder(null)"
      >
        +
      </button>
    </div>
    <div v-if="nodes.length" class="tree">
      <TocTreeNodes
        :nodes="nodes"
        :selected-note-dir="selectedNoteDir"
        :collapsed="collapsed"
        :open-menu="openMenu"
        :drag-source-id="dragSourceId"
        :drop-target-id="dropTargetId"
        :drop-action="dropAction"
        :icon-opened="iconOpened"
        :icon-collapsed="iconCollapsed"
        :busy="busy"
        @select="emit('select', $event)"
        @toggle-collapse="toggleCollapse"
        @toggle-menu="toggleMenu"
        @create-note="onCreateNote"
        @create-notes="onCreateNotes"
        @create-folder="onCreateFolder"
        @rename-note="onRenameNote"
        @rename-folder="onRenameFolder"
        @delete-note="onDeleteNote"
        @delete-entry="onDeleteEntry"
        @create-around="onCreateAround"
        @drag-start="onDragStart"
        @drag-over="onDragOver"
        @drag-leave="onDragLeave"
        @drop="onDrop"
        @drag-end="onDragEnd"
      />
    </div>
    <div v-else class="empty">选择知识库以加载目录</div>
  </aside>
</template>

<style scoped>
.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
}

.col-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.root-add {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 4px;
  width: 22px;
  height: 22px;
  cursor: pointer;
  line-height: 1;
}

.root-add:disabled {
  opacity: 0.45;
  cursor: default;
}

.tree {
  overflow: auto;
  flex: 1;
  padding: 8px;
}

.empty {
  padding: 16px 12px;
  color: var(--muted);
  font-size: 13px;
}
</style>
