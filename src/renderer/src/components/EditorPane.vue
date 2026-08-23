<script setup lang="ts">
import EditorLayoutNode from '../editor-groups/EditorLayoutNode.vue'
import { useEditorStore } from '../stores/editor'

const editor = useEditorStore()
</script>

<template>
  <section class="editor-workspace">
    <EditorLayoutNode :node="editor.layout" />
  </section>
</template>

<style scoped>
.editor-workspace {
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
  background: var(--editor-bg);
}
</style>
