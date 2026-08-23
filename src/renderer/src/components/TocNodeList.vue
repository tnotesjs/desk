<script setup lang="ts">
import { ref } from 'vue'

import type { DeskTocNode } from '../../../shared/contracts'

defineOptions({ name: 'TocNodeList' })

defineProps<{
  nodes: DeskTocNode[]
  selectedNoteUuid: string | null
  depth?: number
}>()

const emit = defineEmits<{
  select: [node: Extract<DeskTocNode, { type: 'note' }>]
  selectSplit: [node: Extract<DeskTocNode, { type: 'note' }>]
  toggleDone: [node: Extract<DeskTocNode, { type: 'note' }>]
  requestCreate: [node: DeskTocNode, placement: 'before' | 'after' | 'inside']
  requestRename: [node: DeskTocNode]
  requestDelete: [node: DeskTocNode]
  move: [source: DeskTocNode, target: DeskTocNode, placement: 'before' | 'after' | 'inside']
  openIde: [node: Extract<DeskTocNode, { type: 'note' }>]
}>()

const collapsed = ref(new Set<string>())
const dropTarget = ref<{ nodeId: string; placement: 'before' | 'after' | 'inside' } | null>(null)

function toggle(nodeId: string): void {
  const next = new Set(collapsed.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  collapsed.value = next
}

function dragStart(event: DragEvent, node: DeskTocNode): void {
  if (!event.dataTransfer) return
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-tnotes-toc', JSON.stringify(node))
}

function dragPlacement(event: DragEvent): 'before' | 'after' | 'inside' {
  const row = event.currentTarget as HTMLElement
  const ratio = (event.clientY - row.getBoundingClientRect().top) / row.offsetHeight
  if (ratio < 0.28) return 'before'
  if (ratio > 0.72) return 'after'
  return 'inside'
}

function dragOver(event: DragEvent, node: DeskTocNode): void {
  if (!event.dataTransfer?.types.includes('application/x-tnotes-toc')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dropTarget.value = { nodeId: node.nodeId, placement: dragPlacement(event) }
}

function drop(event: DragEvent, target: DeskTocNode): void {
  event.preventDefault()
  const raw = event.dataTransfer?.getData('application/x-tnotes-toc')
  const placement = dropTarget.value?.placement ?? dragPlacement(event)
  dropTarget.value = null
  if (!raw) return
  try {
    const source = JSON.parse(raw) as DeskTocNode
    if (source.nodeId !== target.nodeId) emit('move', source, target, placement)
  } catch {
    // Ignore drags originating outside the TNotes tree.
  }
}
</script>

<template>
  <ul class="toc-nodes">
    <li v-for="node in nodes" :key="node.nodeId">
      <div
        class="toc-row"
        :class="{
          active: node.type === 'note' && node.uuid === selectedNoteUuid,
          [`drop-${dropTarget?.placement}`]: dropTarget?.nodeId === node.nodeId
        }"
        :style="{ '--depth': depth ?? 0 }"
        draggable="true"
        @dragstart.stop="dragStart($event, node)"
        @dragover.stop="dragOver($event, node)"
        @dragleave.self="dropTarget = null"
        @drop.stop="drop($event, node)"
        @contextmenu.prevent="node.type === 'note' && emit('openIde', node)"
      >
        <button
          v-if="node.children.length"
          type="button"
          class="disclosure"
          :title="collapsed.has(node.nodeId) ? '展开' : '折叠'"
          @click="toggle(node.nodeId)"
        >
          {{ collapsed.has(node.nodeId) ? '›' : '⌄' }}
        </button>
        <span v-else class="disclosure spacer" />

        <template v-if="node.type === 'group'">
          <button
            type="button"
            class="node-label group"
            @click="toggle(node.nodeId)"
            @dblclick.stop="emit('requestRename', node)"
          >
            {{ node.title }}
          </button>
        </template>
        <template v-else>
          <button
            type="button"
            class="done-toggle"
            :class="{ done: node.completed }"
            :title="node.completed ? '标记为未完成' : '标记为完成'"
            @click="emit('toggleDone', node)"
          >
            {{ node.completed ? '✓' : '' }}
          </button>
          <button
            type="button"
            class="node-label"
            @click="emit('select', node)"
            @dblclick.stop="emit('requestRename', node)"
          >
            <span class="note-index">{{ node.noteIndex }}</span>
            <span>{{ node.title }}</span>
          </button>
        </template>

        <details class="create-menu" @click.stop>
          <summary class="row-action" title="在此处新建笔记">+</summary>
          <div>
            <button type="button" @click="emit('requestCreate', node, 'before')">上方</button>
            <button type="button" @click="emit('requestCreate', node, 'after')">下方</button>
            <button type="button" @click="emit('requestCreate', node, 'inside')">子笔记</button>
          </div>
        </details>

        <button
          type="button"
          class="row-action rename-action"
          title="重命名"
          @click="emit('requestRename', node)"
        >
          ✎
        </button>

        <button
          v-if="node.type === 'note'"
          type="button"
          class="row-action split-action"
          title="在右侧打开"
          @click="emit('selectSplit', node)"
        >
          ◫
        </button>

        <button
          type="button"
          class="row-action"
          title="永久删除"
          @click="emit('requestDelete', node)"
        >
          ×
        </button>
      </div>

      <TocNodeList
        v-if="node.children.length && !collapsed.has(node.nodeId)"
        :nodes="node.children"
        :selected-note-uuid="selectedNoteUuid"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
        @select-split="emit('selectSplit', $event)"
        @toggle-done="emit('toggleDone', $event)"
        @request-create="(child, placement) => emit('requestCreate', child, placement)"
        @request-rename="emit('requestRename', $event)"
        @request-delete="emit('requestDelete', $event)"
        @move="(source, target, placement) => emit('move', source, target, placement)"
        @open-ide="emit('openIde', $event)"
      />
    </li>
  </ul>
</template>

<style scoped>
.toc-nodes {
  margin: 0;
  padding: 0;
  list-style: none;
}

.toc-row {
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 5px 2px calc(5px + var(--depth) * 12px);
  border-radius: 5px;
  color: var(--text);
}

.toc-row:hover {
  background: var(--hover);
}

.toc-row.active {
  background: var(--selected);
  color: var(--accent-strong);
}

.toc-row.drop-before {
  box-shadow: inset 0 2px 0 var(--accent);
}

.toc-row.drop-after {
  box-shadow: inset 0 -2px 0 var(--accent);
}

.toc-row.drop-inside {
  outline: 1px solid var(--accent);
  background: var(--selected);
}

.disclosure,
.row-action,
.done-toggle,
.node-label {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.disclosure {
  width: 18px;
  height: 20px;
  padding: 0;
  flex: none;
  color: var(--muted);
  font-size: 17px;
}

.disclosure.spacer {
  display: inline-block;
}

.done-toggle {
  width: 14px;
  height: 14px;
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--muted);
  border-radius: 4px;
  padding: 0;
  color: var(--success);
  font-size: 10px;
}

.done-toggle.done {
  border-color: var(--success);
  background: var(--success-soft);
}

.node-label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 0;
  overflow: hidden;
  text-align: left;
  font-size: 12px;
}

.node-label > span:last-child,
.node-label.group {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-label.group {
  font-weight: 650;
  color: var(--muted);
}

.note-index {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.row-action {
  width: 20px;
  height: 20px;
  flex: none;
  display: none;
  border-radius: 4px;
  color: var(--muted);
}

.toc-row:hover > .row-action,
.toc-row:hover > .create-menu > .row-action,
.create-menu[open] > .row-action {
  display: block;
}

.split-action:hover {
  background: var(--selected);
  color: var(--accent);
}

.row-action:hover {
  background: var(--danger-soft);
  color: var(--danger);
}

.rename-action:hover,
.create-menu > .row-action:hover {
  background: var(--selected);
  color: var(--accent);
}

.create-menu {
  position: relative;
  flex: none;
}

.create-menu > summary {
  display: none;
  box-sizing: border-box;
  padding: 1px 0 0;
  text-align: center;
  list-style: none;
}

.create-menu > summary::-webkit-details-marker {
  display: none;
}

.create-menu > div {
  position: absolute;
  z-index: 20;
  top: 22px;
  right: 0;
  width: 78px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 6px;
  background: var(--raised);
  padding: 3px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.create-menu button {
  height: 25px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 0 7px;
  cursor: pointer;
  font-size: 10px;
}

.create-menu button:hover {
  background: var(--hover);
}
</style>
