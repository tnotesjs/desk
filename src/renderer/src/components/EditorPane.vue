<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useWorkspaceStore } from '../stores/workspace'

import type { NoteViewMode } from '../../../shared/contracts'

const store = useWorkspaceStore()
const mode = ref<NoteViewMode>(store.settings?.defaultNoteView ?? 'visual')

watch(
  () => store.document?.uuid,
  () => {
    mode.value = store.settings?.defaultNoteView ?? 'visual'
  }
)

const tabTitle = computed(() => {
  if (!store.document) return '未打开笔记'
  return `${store.document.title}${store.dirty ? ' ●' : ''}`
})

function updateFromTextarea(event: Event): void {
  store.updateEditorContent((event.target as HTMLTextAreaElement).value)
}
</script>

<template>
  <section class="editor-pane">
    <div class="tabs-bar">
      <div v-if="store.document" class="tab active">
        <span class="tab-icon">{{ store.selectedKnowledgeBase?.displayName.slice(0, 1) }}</span>
        <span>{{ tabTitle }}</span>
        <button type="button" title="关闭">×</button>
      </div>
      <div v-else class="tab-placeholder">编辑器</div>
    </div>

    <template v-if="store.document">
      <div v-if="store.externalConflict" class="conflict-banner">
        <span>磁盘内容已经变化，Desk 没有覆盖你的编辑。</span>
        <button type="button" @click="store.reloadCurrentDocument">载入磁盘</button>
        <button type="button" @click="store.keepEditorAgainstDisk">保留编辑器内容</button>
      </div>

      <div class="document-toolbar">
        <div class="document-path" :title="store.document.readmePath">
          {{ store.document.index }} · {{ store.document.title }}
          <span v-if="store.document.readOnly" class="read-only">只读</span>
        </div>
        <div class="view-switcher">
          <button type="button" :class="{ active: mode === 'visual' }" @click="mode = 'visual'">
            可视化
          </button>
          <button type="button" :class="{ active: mode === 'source' }" @click="mode = 'source'">
            源码
          </button>
        </div>
        <button
          type="button"
          class="save-button"
          :disabled="!store.dirty || store.saving || store.document.readOnly"
          @click="store.saveCurrentDocument"
        >
          {{ store.saving ? '保存中…' : '保存' }}
        </button>
      </div>

      <div v-if="mode === 'source'" class="source-editor">
        <textarea
          :value="store.editorContent"
          :readonly="store.document.readOnly"
          spellcheck="false"
          @input="updateFromTextarea"
        />
      </div>
      <div v-else class="visual-foundation">
        <div class="visual-note">
          <div class="foundation-label">可视化编辑器底座</div>
          <pre>{{ store.editorContent }}</pre>
        </div>
      </div>
    </template>

    <div v-else class="editor-empty">
      <div class="empty-mark">T</div>
      <strong>打开一篇笔记开始编辑</strong>
      <span>从左侧目录选择笔记；稍后也可以在这里打开网页标签。</span>
    </div>
  </section>
</template>

<style scoped>
.editor-pane {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--editor-bg);
}

.tabs-bar {
  height: 35px;
  flex: none;
  display: flex;
  align-items: stretch;
  border-bottom: 1px solid var(--border);
  background: var(--tabs-bg);
}

.tab,
.tab-placeholder {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 150px;
  max-width: 260px;
  padding: 0 9px;
  border-right: 1px solid var(--border);
  color: var(--muted);
  font-size: 11px;
}

.tab.active {
  background: var(--editor-bg);
  color: var(--text);
  box-shadow: inset 0 1px var(--accent);
}

.tab > span:nth-child(2) {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tab-icon {
  width: 15px;
  height: 15px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  background: var(--raised);
  color: var(--accent);
  font-size: 8px;
  font-weight: 700;
}

.tab button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.document-toolbar {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--editor-bg);
}

.document-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 10px;
}

.read-only {
  margin-left: 6px;
  border-radius: 4px;
  background: var(--warning-soft);
  color: var(--warning);
  padding: 2px 5px;
}

.view-switcher {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.view-switcher button,
.save-button,
.conflict-banner button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
}

.view-switcher button {
  height: 24px;
  padding: 0 9px;
}

.view-switcher button.active {
  background: var(--selected);
  color: var(--accent-strong);
}

.save-button {
  height: 25px;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0 9px;
  color: var(--text);
}

.save-button:hover:not(:disabled) {
  border-color: var(--accent);
}

.save-button:disabled {
  opacity: 0.4;
}

.conflict-banner {
  min-height: 35px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 10px;
}

.conflict-banner span {
  flex: 1;
}

.conflict-banner button {
  border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
  border-radius: 5px;
  color: var(--warning);
  padding: 4px 7px;
}

.source-editor,
.visual-foundation {
  flex: 1;
  min-height: 0;
}

.source-editor textarea {
  width: 100%;
  height: 100%;
  resize: none;
  border: 0;
  outline: none;
  background: var(--editor-bg);
  color: var(--editor-text);
  padding: 20px max(24px, calc((100% - 940px) / 2));
  font-family: var(--font-mono);
  font-size: 13px;
  line-height: 1.65;
  tab-size: 2;
}

.visual-foundation {
  overflow: auto;
  padding: 32px max(30px, calc((100% - 820px) / 2));
  background: var(--document-bg);
}

.visual-note {
  min-height: 100%;
  color: var(--document-text);
}

.foundation-label {
  margin-bottom: 20px;
  color: var(--muted);
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.visual-note pre {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.75;
}

.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--muted);
  font-size: 11px;
}

.editor-empty strong {
  color: var(--text);
  font-size: 14px;
}

.empty-mark {
  width: 42px;
  height: 42px;
  display: grid;
  place-items: center;
  margin-bottom: 5px;
  border: 1px solid var(--border);
  border-radius: 12px;
  color: var(--accent);
  font-size: 21px;
  font-weight: 750;
}
</style>
