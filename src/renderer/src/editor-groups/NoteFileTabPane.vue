<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { mountCodeTabEditor, type CodeTabEditorHandle } from '../editor/markdown/deskCodeTabEditor'
import { resolveMarkdownImageUrl } from '../markdown/markdownAssetUrl'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'
import { noteFileKey } from '../stores/workspace/helpers'

import type { NoteFileEditorTab } from '../../../shared/contracts'

const props = defineProps<{ tab: NoteFileEditorTab; groupId: string; active: boolean }>()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const codeHost = ref<HTMLElement | null>(null)
const loading = ref(props.tab.fileKind === 'text')
let codeEditor: CodeTabEditorHandle | null = null
let stopSessionWatch: (() => void) | null = null

const key = computed(() =>
  noteFileKey(props.tab.knowledgeBaseId, props.tab.noteUuid, props.tab.path)
)
const session = computed(() =>
  workspace.getNoteFileSession(props.tab.knowledgeBaseId, props.tab.noteUuid, props.tab.path)
)
const language = computed(() => props.tab.path.split('.').at(-1)?.toLocaleLowerCase() || 'text')
const imageUrl = computed(() =>
  resolveMarkdownImageUrl(props.tab.path, props.tab.knowledgeBaseId, props.tab.noteUuid)
)

function activate(): void {
  editor.activate(props.groupId, props.tab.id)
}

onMounted(async () => {
  if (props.tab.fileKind !== 'text') return
  try {
    const initial = await workspace.ensureNoteFile(
      props.tab.knowledgeBaseId,
      props.tab.noteUuid,
      props.tab.path
    )
    if (!codeHost.value) return
    codeEditor = mountCodeTabEditor(codeHost.value, {
      initialContent: initial.content,
      language: language.value,
      showTools: false,
      saveOnBlur: false,
      onChange: (content) =>
        workspace.updateNoteFileContent(key.value, content, props.tab.noteTitle),
      onSave: async (content) => {
        workspace.updateNoteFileContent(key.value, content, props.tab.noteTitle)
        try {
          await workspace.saveNoteFile(key.value)
          return { ok: true }
        } catch (cause) {
          return { ok: false, message: cause instanceof Error ? cause.message : String(cause) }
        }
      }
    })
    stopSessionWatch = watch(
      () => session.value,
      (next) => {
        if (!next || !codeEditor) return
        codeEditor.setValue(next.content)
        codeEditor.setSavedValue(next.document.content)
      },
      { deep: true, immediate: true }
    )
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    loading.value = false
  }
})

onBeforeUnmount(() => {
  stopSessionWatch?.()
  stopSessionWatch = null
  codeEditor?.destroy()
  codeEditor = null
})
</script>

<template>
  <div class="note-file-pane" @mousedown="activate">
    <div v-if="session?.externalConflict" class="file-conflict-banner">
      <span>磁盘文件已经变化，Desk 没有覆盖你的编辑。</span>
      <button type="button" @click="workspace.reloadCurrentNoteFile">载入磁盘</button>
      <button type="button" @click="workspace.keepCurrentNoteFileAgainstDisk">保留编辑内容</button>
    </div>
    <header class="file-toolbar">
      <span class="note-name">{{ tab.noteTitle }}</span>
      <span class="separator">/</span>
      <span class="file-path" :title="tab.path">{{ tab.path }}</span>
      <span v-if="session?.document.readOnly" class="read-only">只读</span>
      <span v-if="session?.saving" class="save-state">保存中…</span>
    </header>
    <div v-if="tab.fileKind === 'text'" class="text-editor-shell">
      <div v-if="loading" class="file-state">正在读取文件…</div>
      <div ref="codeHost" class="standalone-code-editor" />
    </div>
    <div v-else-if="tab.fileKind === 'image'" class="image-preview">
      <img :src="imageUrl" :alt="tab.title" />
      <span>{{ tab.path }}</span>
    </div>
    <div v-else class="file-state unsupported">
      <strong>暂不支持预览此文件</strong>
      <span>{{ tab.path }}</span>
    </div>
  </div>
</template>

<style scoped>
.note-file-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--editor-bg);
}

.file-toolbar {
  height: 36px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  padding: 0 12px;
  color: var(--muted);
  font-size: 10px;
}

.note-name,
.file-path {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.note-name {
  max-width: 32%;
}

.file-path {
  color: var(--text);
}

.separator {
  opacity: 0.55;
}

.read-only,
.save-state {
  flex: none;
  margin-left: auto;
  border-radius: 999px;
  background: var(--raised);
  padding: 2px 7px;
}

.text-editor-shell,
.standalone-code-editor,
.standalone-code-editor :deep(.desk-code-tab),
.standalone-code-editor :deep(.desk-code-tab__cm),
.standalone-code-editor :deep(.cm-editor) {
  flex: 1;
  min-width: 0;
  min-height: 0;
  height: 100%;
}

.standalone-code-editor :deep(.desk-code-tab) {
  border: 0;
  border-radius: 0;
  background: var(--editor-bg);
}

.standalone-code-editor :deep(.cm-scroller) {
  overflow: auto;
  font-size: 12px;
}

.file-state,
.image-preview {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 11px;
}

.unsupported,
.image-preview {
  flex-direction: column;
  gap: 12px;
}

.unsupported strong {
  color: var(--text);
}

.image-preview img {
  max-width: calc(100% - 48px);
  max-height: calc(100% - 80px);
  object-fit: contain;
  border-radius: 6px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.2);
}

.file-conflict-banner {
  min-height: 34px;
  display: flex;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 35%, var(--border));
  background: color-mix(in srgb, var(--warning) 10%, var(--editor-bg));
  padding: 4px 10px;
  color: var(--text);
  font-size: 10px;
}

.file-conflict-banner span {
  flex: 1;
}

.file-conflict-banner button {
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--raised);
  color: var(--text);
  padding: 3px 8px;
}
</style>
