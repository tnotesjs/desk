<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { NoteEditorTab, NoteViewMode } from '../../../shared/contracts'

const props = defineProps<{ tab: NoteEditorTab; groupId: string }>()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const key = computed(() => `${props.tab.knowledgeBaseId}:${props.tab.noteUuid}`)
const session = computed(() =>
  workspace.getDocumentSession(props.tab.knowledgeBaseId, props.tab.noteUuid)
)

onMounted(() => {
  void workspace.ensureDocument(props.tab.knowledgeBaseId, props.tab.noteUuid)
})

function setMode(mode: NoteViewMode): void {
  editor.setNoteViewMode(props.tab.id, mode)
}

function updateFromTextarea(event: Event): void {
  workspace.updateDocumentContent(key.value, (event.target as HTMLTextAreaElement).value)
}

function activate(): void {
  editor.activate(props.groupId, props.tab.id)
}
</script>

<template>
  <div v-if="session" class="note-pane" @mousedown="activate">
    <div v-if="session.externalConflict" class="conflict-banner">
      <span>磁盘内容已经变化，Desk 没有覆盖你的编辑。</span>
      <button type="button" @click="workspace.reloadCurrentDocument">载入磁盘</button>
      <button type="button" @click="workspace.keepEditorAgainstDisk">保留编辑内容</button>
    </div>

    <div class="document-toolbar">
      <div class="document-path" :title="session.document.readmePath">
        {{ session.document.index }} · {{ session.document.title }}
        <span v-if="session.document.readOnly" class="read-only">只读</span>
      </div>
      <div class="view-switcher">
        <button
          type="button"
          :class="{ active: tab.viewMode === 'visual' }"
          @click="setMode('visual')"
        >
          可视化
        </button>
        <button
          type="button"
          :class="{ active: tab.viewMode === 'source' }"
          @click="setMode('source')"
        >
          源码
        </button>
      </div>
      <button
        type="button"
        class="save-button"
        :disabled="!session.dirty || session.saving || session.document.readOnly"
        @click="workspace.saveDocument(key)"
      >
        {{ session.saving ? '保存中…' : '保存' }}
      </button>
    </div>

    <div v-if="tab.viewMode === 'source'" class="source-editor">
      <textarea
        :value="session.content"
        :readonly="session.document.readOnly"
        spellcheck="false"
        @input="updateFromTextarea"
      />
    </div>
    <div v-else class="visual-foundation">
      <article class="visual-note">
        <div class="foundation-label">可视化编辑器底座</div>
        <pre>{{ session.content }}</pre>
      </article>
    </div>
  </div>
  <div v-else class="loading-note">正在读取笔记…</div>
</template>

<style scoped>
.note-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
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

.loading-note {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 11px;
}
</style>
