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
  requestDelete: [node: DeskTocNode]
}>()

const collapsed = ref(new Set<string>())

function toggle(nodeId: string): void {
  const next = new Set(collapsed.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  collapsed.value = next
}
</script>

<template>
  <ul class="toc-nodes">
    <li v-for="node in nodes" :key="node.nodeId">
      <div
        class="toc-row"
        :class="{ active: node.type === 'note' && node.uuid === selectedNoteUuid }"
        :style="{ '--depth': depth ?? 0 }"
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
          <button type="button" class="node-label group" @click="toggle(node.nodeId)">
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
          <button type="button" class="node-label" @click="emit('select', node)">
            <span class="note-index">{{ node.noteIndex }}</span>
            <span>{{ node.title }}</span>
          </button>
        </template>

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
        @request-delete="emit('requestDelete', $event)"
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

.toc-row:hover > .row-action {
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
</style>
