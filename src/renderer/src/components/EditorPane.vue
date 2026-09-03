<script setup lang="ts">
import EditorLayoutNode from '../editor-groups/EditorLayoutNode.vue'
import NoteFileTree from './NoteFileTree.vue'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()
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
