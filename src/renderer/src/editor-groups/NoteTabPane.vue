<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import MarkdownEditor from '../markdown/MarkdownEditor.vue'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { NoteEditorTab, NoteViewMode } from '../../../shared/contracts'

const props = defineProps<{ tab: NoteEditorTab; groupId: string; active: boolean }>()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const key = computed(() => `${props.tab.knowledgeBaseId}:${props.tab.noteUuid}`)
const session = computed(() =>
  workspace.getDocumentSession(props.tab.knowledgeBaseId, props.tab.noteUuid)
)
const markdownEditor = ref<InstanceType<typeof MarkdownEditor> | null>(null)

onMounted(() => {
  void workspace.ensureDocument(props.tab.knowledgeBaseId, props.tab.noteUuid)
})

function setMode(mode: NoteViewMode): void {
  editor.setNoteViewMode(props.tab.id, mode)
}

function updateContent(content: string): void {
  workspace.updateDocumentContent(key.value, content)
}

function activate(): void {
  editor.activate(props.groupId, props.tab.id)
}

function insertTemplate(text: string): void {
  markdownEditor.value?.insertTextAt(text)
}

async function pasteImage(file: File, insertAt: number): Promise<void> {
  try {
    const attachment = await workspace.writeLocalAttachment(
      props.tab.knowledgeBaseId,
      props.tab.noteUuid,
      file
    )
    const alt =
      file.name
        .replace(/\.[^.]+$/, '')
        .replaceAll('[', '')
        .replaceAll(']', '') || 'image'
    markdownEditor.value?.insertTextAt(`![${alt}](${attachment.markdownPath})`, insertAt)
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  }
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
      <div class="format-actions" aria-label="Markdown 格式工具栏">
        <button type="button" title="粗体" @click="markdownEditor?.wrapSelection('**', '**')">
          B
        </button>
        <button type="button" title="斜体" @click="markdownEditor?.wrapSelection('*', '*')">
          <em>I</em>
        </button>
        <button type="button" title="二级标题" @click="markdownEditor?.prefixSelection('## ')">
          H2
        </button>
        <button type="button" title="引用" @click="markdownEditor?.prefixSelection('> ')">❞</button>
        <button type="button" title="无序列表" @click="markdownEditor?.prefixSelection('- ')">
          ≡
        </button>
        <button
          type="button"
          title="链接"
          @click="markdownEditor?.wrapSelection('[', '](https://)', '链接')"
        >
          ↗
        </button>
        <button type="button" title="代码块" @click="insertTemplate('\n```ts\n\n```\n')">
          { }
        </button>
        <button
          type="button"
          title="表格"
          @click="insertTemplate('\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n')"
        >
          ▦
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

    <MarkdownEditor
      ref="markdownEditor"
      class="editor-surface"
      :content="session.content"
      :mode="tab.viewMode"
      :read-only="session.document.readOnly"
      :knowledge-base-id="tab.knowledgeBaseId"
      :note-uuid="tab.noteUuid"
      @change="updateContent"
      @open-link="editor.openWeb"
      @open-note="workspace.openNoteByUuid(tab.knowledgeBaseId, $event)"
      @paste-image="pasteImage"
    />
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
.format-actions button,
.save-button,
.conflict-banner button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
}

.format-actions {
  display: flex;
  align-items: center;
  gap: 1px;
}

.format-actions button {
  min-width: 24px;
  height: 24px;
  border-radius: 4px;
  font-family: var(--font-mono);
}

.format-actions button:hover {
  background: var(--hover);
  color: var(--text);
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

.editor-surface {
  flex: 1;
  min-height: 0;
}

.loading-note {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 11px;
}
</style>
