<script setup lang="ts">
import { ref } from 'vue'

import EditorGroup from './EditorGroup.vue'
import { useEditorStore } from '../stores/editor'

import type { EditorLayoutNode } from '../../../shared/contracts'

defineOptions({ name: 'EditorLayoutNode' })

const props = defineProps<{ node: EditorLayoutNode }>()
const editor = useEditorStore()
const splitElement = ref<HTMLElement | null>(null)

function beginResize(event: PointerEvent): void {
  if (props.node.type !== 'split' || !splitElement.value) return
  event.preventDefault()
  const splitId = props.node.id
  const direction = props.node.direction
  const element = splitElement.value
  const onMove = (moveEvent: PointerEvent): void => {
    const rect = element.getBoundingClientRect()
    const ratio =
      direction === 'horizontal'
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height
    editor.resizeSplit(splitId, ratio)
  }
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp, { once: true })
}
</script>

<template>
  <EditorGroup v-if="node.type === 'group'" :group="node" />
  <div v-else ref="splitElement" class="editor-split" :class="node.direction">
    <div class="split-child first" :style="{ flexBasis: `${node.ratio * 100}%` }">
      <EditorLayoutNode :node="node.first" />
    </div>
    <div class="split-divider" @pointerdown="beginResize" />
    <div class="split-child second" :style="{ flexBasis: `${(1 - node.ratio) * 100}%` }">
      <EditorLayoutNode :node="node.second" />
    </div>
  </div>
</template>

<style scoped>
.editor-split {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.editor-split.vertical {
  flex-direction: column;
}

.split-child {
  min-width: 0;
  min-height: 0;
  flex-grow: 0;
  flex-shrink: 1;
  overflow: hidden;
}

.editor-split.horizontal > .split-divider {
  width: 4px;
  height: 100%;
  cursor: col-resize;
}

.editor-split.vertical > .split-divider {
  width: 100%;
  height: 4px;
  cursor: row-resize;
}

.split-divider {
  z-index: 3;
  flex: none;
  background: var(--border);
  transition: background 120ms;
}

.split-divider:hover {
  background: var(--accent);
}
</style>
