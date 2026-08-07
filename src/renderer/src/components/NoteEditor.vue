<script setup lang="ts">
import { computed } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'

const props = defineProps<{
  content: string
  noteDir: string | null
  notePath: string | null
  dirty: boolean
}>()

const emit = defineEmits<{
  'update:content': [value: string]
  save: []
}>()

const title = computed(() => {
  if (!props.noteDir) return '未打开笔记'
  return props.dirty ? `${props.noteDir} · 未保存` : props.noteDir
})

function onChange(value: string | undefined): void {
  emit('update:content', value ?? '')
}
</script>

<template>
  <section class="editor-pane">
    <div class="editor-bar">
      <div class="title" :title="notePath ?? ''">{{ title }}</div>
      <div class="mode">code</div>
      <button
        type="button"
        class="btn"
        :disabled="!noteDir || !dirty"
        @click="emit('save')"
      >
        保存
      </button>
    </div>
    <div v-if="noteDir" class="monaco-wrap">
      <VueMonacoEditor
        :key="noteDir"
        :value="content"
        language="markdown"
        theme="vs-dark"
        :options="{
          automaticLayout: true,
          fontSize: 14,
          minimap: { enabled: false },
          wordWrap: 'on',
          scrollBeyondLastLine: false,
          tabSize: 2
        }"
        @change="onChange"
      />
    </div>
    <div v-else class="empty">从 TOC 选择一篇笔记</div>
  </section>
</template>

<style scoped>
.editor-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: var(--bg);
}

.editor-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  font-weight: 600;
}

.mode {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 2px 8px;
}

.btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  font-size: 13px;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.monaco-wrap {
  flex: 1;
  min-height: 0;
}

.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 14px;
}
</style>
