<script setup lang="ts">
import type { TocNode } from '../types'
import TocTreeNodes from './TocTreeNodes.vue'

defineProps<{
  nodes: TocNode[]
  selectedNoteDir: string | null
}>()

const emit = defineEmits<{
  select: [noteDir: string]
}>()
</script>

<template>
  <aside class="col">
    <div class="col-title">TOC</div>
    <div v-if="nodes.length" class="tree">
      <TocTreeNodes :nodes="nodes" :selected-note-dir="selectedNoteDir" @select="emit('select', $event)" />
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
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
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
