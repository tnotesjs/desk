<script setup lang="ts">
import { computed } from 'vue'
import { VueMonacoEditor } from '@guolao/vue-monaco-editor'
import type { NoteViewMode, PreviewState } from '../types'

const props = defineProps<{
  content: string
  noteDir: string | null
  notePath: string | null
  dirty: boolean
  mode: NoteViewMode
  previewState: PreviewState
  previewUrl: string | null
  previewBusy: boolean
}>()

const emit = defineEmits<{
  'update:content': [value: string]
  'update:mode': [mode: NoteViewMode]
  save: []
  'retry-preview': []
}>()

const title = computed(() => {
  if (!props.noteDir) return '未打开笔记'
  return props.dirty ? `${props.noteDir} · 未保存` : props.noteDir
})

const previewMessage = computed(() => {
  if (!props.noteDir) return '从 TOC 选择一篇笔记'
  if (props.previewBusy || props.previewState.status === 'starting') {
    return '正在启动预览服务…'
  }
  if (props.previewState.status === 'error') {
    return props.previewState.error || '预览启动失败'
  }
  if (!props.previewUrl) return '暂无预览地址'
  return null
})

function onChange(value: string | undefined): void {
  emit('update:content', value ?? '')
}
</script>

<template>
  <section class="editor-pane">
    <div class="editor-bar">
      <div class="title" :title="notePath ?? ''">{{ title }}</div>
      <div class="modes">
        <button
          type="button"
          class="mode-btn"
          :class="{ active: mode === 'code' }"
          @click="emit('update:mode', 'code')"
        >
          code
        </button>
        <button
          type="button"
          class="mode-btn"
          :class="{ active: mode === 'preview' }"
          :disabled="!noteDir"
          @click="emit('update:mode', 'preview')"
        >
          preview
        </button>
      </div>
      <button
        v-if="mode === 'code'"
        type="button"
        class="btn"
        :disabled="!noteDir || !dirty"
        @click="emit('save')"
      >
        保存
      </button>
      <button
        v-else
        type="button"
        class="btn"
        :disabled="!noteDir || previewBusy"
        @click="emit('retry-preview')"
      >
        刷新预览
      </button>
    </div>

    <template v-if="mode === 'code'">
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
    </template>

    <template v-else>
      <webview
        v-if="previewUrl && previewState.status === 'ready' && !previewMessage"
        class="preview-frame"
        :src="previewUrl"
        allowpopups
      />
      <div v-else class="empty">
        <pre class="preview-error">{{ previewMessage }}</pre>
        <button
          v-if="previewState.status === 'error'"
          type="button"
          class="btn"
          style="margin-top: 12px"
          @click="emit('retry-preview')"
        >
          重试
        </button>
      </div>
    </template>
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

.modes {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 999px;
  overflow: hidden;
}

.mode-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 4px 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  cursor: pointer;
}

.mode-btn.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 700;
}

.mode-btn:disabled {
  opacity: 0.45;
  cursor: default;
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

.monaco-wrap,
.preview-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  border: 0;
  background: #fff;
  display: flex;
}

.empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 14px;
  text-align: center;
  padding: 24px;
  overflow: auto;
}

.preview-error {
  margin: 0;
  max-width: min(720px, 100%);
  white-space: pre-wrap;
  word-break: break-word;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text);
}
</style>
