<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue'

import UiTooltip from '../components/UiTooltip.vue'
import PageWidthIcon from '../components/PageWidthIcon.vue'
import MarkdownSourceEditor from '../markdown/MarkdownSourceEditor.vue'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { NoteEditorTab, NoteViewMode } from '../../../shared/contracts'

interface MarkdownEditorHandle {
  insertTextAt(text: string, position?: number): void
  wrapSelection(prefix: string, suffix: string, placeholder?: string): void
  prefixSelection(prefix: string): void
  setLinePrefix(prefix: string): void
}

const MilkdownMarkdownEditor = defineAsyncComponent(
  () => import('../markdown/MilkdownMarkdownEditor.vue')
)

// Warm the editor chunk after idle so the first note open pays less JS parse cost.
if (typeof requestIdleCallback === 'function') {
  requestIdleCallback(() => {
    void import('../markdown/MilkdownMarkdownEditor.vue')
  })
} else {
  window.setTimeout(() => {
    void import('../markdown/MilkdownMarkdownEditor.vue')
  }, 1_200)
}

const props = defineProps<{ tab: NoteEditorTab; groupId: string; active: boolean }>()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const key = computed(() => `${props.tab.knowledgeBaseId}:${props.tab.noteUuid}`)
const session = computed(() =>
  workspace.getDocumentSession(props.tab.knowledgeBaseId, props.tab.noteUuid)
)
const milkdownMarkdownEditor = ref<MarkdownEditorHandle | null>(null)
const markdownSourceEditor = ref<MarkdownEditorHandle | null>(null)
const milkdownFailed = ref(false)
const milkdownMountKey = ref(0)
const markdownEditor = computed(() =>
  props.tab.viewMode === 'source' ? markdownSourceEditor.value : milkdownMarkdownEditor.value
)
const pageWidthLabel = computed(() => (props.tab.pageWidth === 'wide' ? '超宽显示' : '标准页宽'))
const titleInput = ref<HTMLInputElement | null>(null)
const editingTitle = ref(false)
const titleDraft = ref('')
const renaming = ref(false)

watch(key, () => {
  editingTitle.value = false
})

async function editTitle(): Promise<void> {
  if (!session.value || session.value.document.readOnly || renaming.value) return
  titleDraft.value = session.value.document.title
  editingTitle.value = true
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
}

async function commitTitle(): Promise<void> {
  if (!editingTitle.value) return
  editingTitle.value = false
  const title = titleDraft.value.trim()
  if (!title || title === session.value?.document.title) return
  const { knowledgeBaseId, noteUuid } = props.tab
  renaming.value = true
  try {
    await workspace.renameNote(knowledgeBaseId, noteUuid, title)
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  } finally {
    renaming.value = false
  }
}

function onTitleKeydown(event: KeyboardEvent): void {
  // Enter used to confirm a Chinese IME candidate must not submit the name.
  if (event.isComposing) return
  if (event.key === 'Enter') {
    event.preventDefault()
    titleInput.value?.blur()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    editingTitle.value = false
  }
}

onMounted(() => {
  void workspace.ensureDocument(props.tab.knowledgeBaseId, props.tab.noteUuid)
})

function setMode(mode: NoteViewMode): void {
  editor.setNoteViewMode(props.tab.id, mode)
}

function updateContent(content: string): void {
  workspace.updateDocumentContent(key.value, content, props.tab.viewMode === 'visual')
}

function activate(): void {
  editor.activate(props.groupId, props.tab.id)
}

function insertTemplate(text: string): void {
  markdownEditor.value?.insertTextAt(text)
}

async function pasteImage(file: File, insertAt: number): Promise<void> {
  const targetEditor = markdownSourceEditor.value
  try {
    const attachment = await workspace.uploadImage(
      props.tab.knowledgeBaseId,
      props.tab.noteUuid,
      file
    )
    const alt =
      file.name
        .replace(/\.[^.]+$/, '')
        .replaceAll('[', '')
        .replaceAll(']', '') || 'image'
    targetEditor?.insertTextAt(`![${alt}](${attachment.markdownPath})`, insertAt)
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  }
}

async function uploadVisualImage(file: File): Promise<{ src: string; alt: string }> {
  try {
    const attachment = await workspace.uploadImage(
      props.tab.knowledgeBaseId,
      props.tab.noteUuid,
      file
    )
    const alt =
      file.name
        .replace(/\.[^.]+$/, '')
        .replaceAll('[', '')
        .replaceAll(']', '') || 'image'
    return { src: attachment.markdownPath, alt }
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
    throw cause
  }
}

function handleMilkdownFatal(message: string): void {
  milkdownFailed.value = true
  workspace.error = `Milkdown 无法打开这篇笔记：${message}`
}

function retryMilkdown(): void {
  milkdownMountKey.value += 1
  milkdownFailed.value = false
}

function openLink(url: string): void {
  try {
    editor.openWeb(url)
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
        <span class="note-index">{{ session.document.index }}.</span>
        <input
          v-if="editingTitle"
          ref="titleInput"
          v-model="titleDraft"
          class="note-title-input"
          aria-label="笔记名称"
          autocomplete="off"
          @blur="commitTitle"
          @keydown="onTitleKeydown"
        />
        <button
          v-else
          type="button"
          class="note-title-button"
          aria-label="重命名笔记"
          :disabled="session.document.readOnly || renaming"
          @click="editTitle"
        >
          {{ session.document.title }}
        </button>
        <span v-if="session.document.readOnly" class="read-only">只读</span>
      </div>
      <div class="view-controls">
        <UiTooltip :label="pageWidthLabel">
          <button
            type="button"
            class="page-width-toggle"
            :aria-label="pageWidthLabel"
            @click="editor.toggleNotePageWidth(tab.id)"
          >
            <PageWidthIcon :mode="tab.pageWidth" />
          </button>
        </UiTooltip>
        <span class="view-divider" aria-hidden="true"></span>
        <div class="view-switcher" aria-label="笔记视图">
          <UiTooltip label="可视化编辑">
            <button
              type="button"
              aria-label="可视化编辑"
              :class="{ active: tab.viewMode === 'visual' }"
              @click="setMode('visual')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z" />
                <path d="m14.5 6.7 2.8 2.8" />
              </svg>
            </button>
          </UiTooltip>
          <UiTooltip label="只读视图">
            <button
              type="button"
              aria-label="只读视图"
              :class="{ active: tab.viewMode === 'readonly' }"
              @click="setMode('readonly')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 5.5A3.5 3.5 0 0 1 7.5 4H11v16H7.5A3.5 3.5 0 0 0 4 21V5.5Z" />
                <path d="M20 5.5A3.5 3.5 0 0 0 16.5 4H13v16h3.5A3.5 3.5 0 0 1 20 21V5.5Z" />
              </svg>
            </button>
          </UiTooltip>
          <UiTooltip label="源码视图">
            <button
              type="button"
              aria-label="源码视图"
              :class="{ active: tab.viewMode === 'source' }"
              @click="setMode('source')"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4l-3 16" />
              </svg>
            </button>
          </UiTooltip>
        </div>
      </div>
    </div>
    <div v-if="tab.viewMode === 'visual'" class="format-actions" aria-label="Markdown 格式工具栏">
      <UiTooltip label="粗体" shortcut="⌘ B">
        <button type="button" aria-label="粗体" @click="markdownEditor?.wrapSelection('**', '**')">
          B
        </button>
      </UiTooltip>
      <UiTooltip label="斜体" shortcut="⌘ I">
        <button type="button" aria-label="斜体" @click="markdownEditor?.wrapSelection('*', '*')">
          <em>I</em>
        </button>
      </UiTooltip>
      <UiTooltip label="二级标题" shortcut="⌥ ⌘ 2">
        <button type="button" aria-label="二级标题" @click="markdownEditor?.setLinePrefix('## ')">
          H2
        </button>
      </UiTooltip>
      <UiTooltip label="引用" shortcut="⇧ ⌘ U">
        <button type="button" aria-label="引用" @click="markdownEditor?.setLinePrefix('> ')">
          ❞
        </button>
      </UiTooltip>
      <UiTooltip label="无序列表" shortcut="⇧ ⌘ 8">
        <button type="button" aria-label="无序列表" @click="markdownEditor?.setLinePrefix('- ')">
          ≡
        </button>
      </UiTooltip>
      <UiTooltip label="链接">
        <button
          type="button"
          aria-label="链接"
          @click="markdownEditor?.wrapSelection('[', '](https://)', '链接')"
        >
          ↗
        </button>
      </UiTooltip>
      <UiTooltip label="代码块">
        <button type="button" aria-label="代码块" @click="insertTemplate('\n```ts\n\n```\n')">
          { }
        </button>
      </UiTooltip>
      <UiTooltip label="表格">
        <button
          type="button"
          aria-label="表格"
          @click="insertTemplate('\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n')"
        >
          ▦
        </button>
      </UiTooltip>
    </div>

    <MilkdownMarkdownEditor
      v-if="tab.viewMode !== 'source' && !milkdownFailed"
      :key="milkdownMountKey"
      ref="milkdownMarkdownEditor"
      class="editor-surface"
      :content="session.content"
      :mode="tab.viewMode"
      :read-only="session.document.readOnly"
      :knowledge-base-id="tab.knowledgeBaseId"
      :note-uuid="tab.noteUuid"
      :active="active"
      :page-width="tab.pageWidth"
      :toc-display="workspace.settings?.noteTocDisplay ?? 'expanded'"
      :upload-image="uploadVisualImage"
      @change="updateContent"
      @open-link="openLink"
      @open-note="workspace.openNoteByUuid(tab.knowledgeBaseId, $event)"
      @fatal="handleMilkdownFatal"
    />
    <div v-else-if="tab.viewMode !== 'source'" class="editor-fatal" role="alert">
      <strong>可视化编辑器加载失败</strong>
      <span>内容没有被修改。你可以重试，或切换到源码视图继续编辑。</span>
      <div>
        <button type="button" @click="retryMilkdown">重试</button>
        <button type="button" @click="setMode('source')">打开源码视图</button>
      </div>
    </div>
    <MarkdownSourceEditor
      v-else
      ref="markdownSourceEditor"
      class="editor-surface"
      :content="session.content"
      :mode="tab.viewMode"
      :read-only="session.document.readOnly"
      :knowledge-base-id="tab.knowledgeBaseId"
      :note-uuid="tab.noteUuid"
      :active="active"
      :page-width="tab.pageWidth"
      @change="updateContent"
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
  position: relative;
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
  display: flex;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 10px;
}

.note-index,
.read-only {
  flex: none;
}

.note-title-button,
.note-title-input {
  min-width: 0;
  height: 26px;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 0 4px;
  background: transparent;
  color: inherit;
  font: inherit;
}

.note-title-button {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  cursor: text;
}

.note-title-button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.note-title-button:disabled {
  cursor: default;
}

.note-title-input {
  flex: 1;
  outline: none;
  border-color: var(--accent);
  background: var(--panel);
  color: var(--text);
}

.read-only {
  margin-left: 6px;
  border-radius: 4px;
  background: var(--warning-soft);
  color: var(--warning);
  padding: 2px 5px;
}

.view-controls,
.view-switcher {
  flex: none;
  display: flex;
  align-items: center;
  border-radius: 6px;
  padding: 2px;
  gap: 1px;
}

.view-divider {
  width: 1px;
  height: 16px;
  margin: 0 7px;
  background: var(--border);
}

.view-controls button,
.format-actions button,
.conflict-banner button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 10px;
}

.format-actions {
  flex: none;
  min-height: 34px;
  padding: 0 12px;
  border-bottom: 1px solid var(--border);
  background: var(--editor-bg);
  display: flex;
  align-items: center;
  gap: 1px;
}

.format-actions :deep(.ui-tooltip-host) {
  flex: none;
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

.view-controls button {
  width: 27px;
  height: 25px;
  display: grid;
  place-items: center;
  border-radius: 5px;
  padding: 0;
}

.view-controls svg {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.view-switcher button.active {
  background: var(--selected);
  color: var(--accent-strong);
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

.editor-fatal {
  flex: 1;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 10px;
  padding: 28px;
  color: var(--muted);
  text-align: center;
  font-size: 12px;
}

.editor-fatal strong {
  color: var(--text);
  font-size: 14px;
}

.editor-fatal > div {
  display: flex;
  gap: 8px;
}

.editor-fatal button {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 10px;
  background: var(--panel);
  color: var(--text);
  cursor: pointer;
}

.loading-note {
  flex: 1;
  display: grid;
  place-items: center;
  color: var(--muted);
  font-size: 11px;
}
</style>
