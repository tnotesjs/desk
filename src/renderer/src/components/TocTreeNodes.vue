<script setup lang="ts">
import type { TocNode } from '../types'

defineProps<{
  nodes: TocNode[]
  selectedNoteDir: string | null
  depth?: number
}>()

const emit = defineEmits<{
  select: [noteDir: string]
}>()
</script>

<template>
  <ul class="nodes" :style="{ '--depth': depth ?? 0 }">
    <li v-for="(node, index) in nodes" :key="index" class="node">
      <div
        v-if="node.type === 'group'"
        class="group-title"
      >
        {{ node.title }}
      </div>
      <button
        v-else
        type="button"
        class="note-item"
        :class="{ active: node.noteDir === selectedNoteDir }"
        @click="emit('select', node.noteDir)"
      >
        <span class="mark">{{ node.completed ? '✓' : '·' }}</span>
        <span class="label">{{ node.title }}</span>
      </button>

      <TocTreeNodes
        v-if="node.children.length"
        :nodes="node.children"
        :selected-note-dir="selectedNoteDir"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
      />
    </li>
  </ul>
</template>

<script lang="ts">
export default {
  name: 'TocTreeNodes'
}
</script>

<style scoped>
.nodes {
  list-style: none;
  margin: 0;
  padding: 0;
}

.node {
  margin: 0;
}

.group-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--muted);
  padding: 8px 8px 4px;
  padding-left: calc(8px + var(--depth) * 14px);
}

.note-item {
  width: 100%;
  display: flex;
  gap: 8px;
  align-items: flex-start;
  text-align: left;
  border: 0;
  background: transparent;
  color: inherit;
  border-radius: 6px;
  padding: 6px 8px;
  padding-left: calc(8px + var(--depth) * 14px);
  cursor: pointer;
  font-size: 13px;
  line-height: 1.35;
}

.note-item:hover {
  background: var(--hover);
}

.note-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}

.mark {
  width: 12px;
  flex: none;
  opacity: 0.75;
}

.label {
  min-width: 0;
  word-break: break-word;
}
</style>
