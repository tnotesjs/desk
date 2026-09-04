<script setup lang="ts">
import { watch } from 'vue'
import EditorLayoutNode from '../editor-groups/EditorLayoutNode.vue'
import NoteFileTree from './NoteFileTree.vue'
import { useEditorStore } from '../stores/editor'
import { useTabDragLifecycle, useTabDragStore } from '../editor-groups/tabDrag'

const editor = useEditorStore()
useTabDragLifecycle()
const drag = useTabDragStore()
watch(
  () =>
    drag.tabId && !editor.groups.some((group) => group.tabs.some((tab) => tab.id === drag.tabId)),
  (sourceMissing) => {
    if (sourceMissing) drag.finish()
  }
)
</script>

<template>
  <section class="editor-workspace">
    <NoteFileTree />
    <div class="editor-layout-shell">
      <EditorLayoutNode :node="editor.layout" />
    </div>
  </section>
</template>

<style scoped>
.editor-workspace {
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  overflow: hidden;
  background: var(--editor-bg);
}

.editor-layout-shell {
  min-width: 0;
  min-height: 0;
  flex: 1;
  position: relative;
}
</style>
