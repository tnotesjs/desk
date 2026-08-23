<script setup lang="ts">
import { computed, ref } from 'vue'

import NoteTabPane from './NoteTabPane.vue'
import WebTabPane from './WebTabPane.vue'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { EditorGroupNode, EditorTab } from '../../../shared/contracts'
import type { SplitPlacement } from './layoutModel'

const props = defineProps<{ group: EditorGroupNode }>()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const dragOver = ref(false)

const activeTab = computed(
  () => props.group.tabs.find((tab) => tab.id === props.group.activeTabId) ?? null
)

function activate(tab: EditorTab): void {
  editor.activate(props.group.id, tab.id)
  void workspace.syncToActiveTab()
}

function beginDrag(event: DragEvent, tab: EditorTab): void {
  event.dataTransfer?.setData('text/x-tnotes-desk-tab', tab.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function draggedTabId(event: DragEvent): string | null {
  return event.dataTransfer?.getData('text/x-tnotes-desk-tab') || null
}

function dropInGroup(event: DragEvent, index?: number): void {
  event.preventDefault()
  dragOver.value = false
  const tabId = draggedTabId(event)
  if (tabId) editor.moveTab(tabId, props.group.id, index)
}

function dropSplit(event: DragEvent, placement: SplitPlacement): void {
  event.preventDefault()
  event.stopPropagation()
  dragOver.value = false
  const tabId = draggedTabId(event)
  if (tabId) editor.splitTab(tabId, props.group.id, placement)
}

function isDirty(tab: EditorTab): boolean {
  if (tab.type !== 'note') return false
  return Boolean(workspace.getDocumentSession(tab.knowledgeBaseId, tab.noteUuid)?.dirty)
}

function tabIcon(tab: EditorTab): string {
  if (tab.type === 'web') return '⌘'
  return tab.knowledgeBaseName.slice(0, 1).toUpperCase()
}
</script>

<template>
  <section
    class="editor-group"
    :class="{ active: editor.activeGroupId === group.id, 'drag-over': dragOver }"
    @mousedown="editor.activeGroupId = group.id"
    @dragenter.prevent="dragOver = true"
    @dragleave.self="dragOver = false"
    @dragover.prevent
    @drop="dropInGroup"
  >
    <div class="tabs-bar">
      <button
        v-for="(tab, index) in group.tabs"
        :key="tab.id"
        type="button"
        class="tab"
        :class="{ selected: tab.id === group.activeTabId }"
        draggable="true"
        :title="tab.type === 'note' ? `${tab.knowledgeBaseName} · ${tab.title}` : tab.url"
        @click="activate(tab)"
        @dragstart="beginDrag($event, tab)"
        @dragover.prevent
        @drop.stop="dropInGroup($event, index)"
      >
        <img
          v-if="tab.type === 'web' && editor.webStates[tab.id]?.faviconUrl"
          class="tab-favicon"
          :src="editor.webStates[tab.id].faviconUrl"
          alt=""
        />
        <span v-else class="tab-icon">{{ tabIcon(tab) }}</span>
        <span class="tab-title">{{ tab.title }}</span>
        <span v-if="isDirty(tab)" class="dirty-dot">●</span>
        <span class="tab-close" title="关闭" @click.stop="editor.close(group.id, tab.id)">×</span>
      </button>
      <div class="tab-actions">
        <button type="button" title="新建网页标签" @click="editor.openWeb()">＋</button>
        <button
          type="button"
          title="向右拆分当前标签"
          :disabled="!activeTab"
          @click="editor.splitActive('right')"
        >
          ◫
        </button>
        <button
          type="button"
          title="向下拆分当前标签"
          :disabled="!activeTab"
          @click="editor.splitActive('bottom')"
        >
          ⊟
        </button>
      </div>
    </div>

    <div
      v-for="tab in group.tabs"
      v-show="tab.id === group.activeTabId"
      :key="tab.id"
      class="tab-content"
    >
      <NoteTabPane
        v-if="tab.type === 'note'"
        :tab="tab"
        :group-id="group.id"
        :active="tab.id === group.activeTabId"
      />
      <WebTabPane v-else :tab="tab" :active="tab.id === group.activeTabId" />
    </div>
    <div v-if="!activeTab" class="editor-empty">
      <div class="empty-mark">T</div>
      <strong>打开一篇笔记或网页</strong>
      <span>可把标签拖到边缘进行左右或上下拆分。</span>
      <button type="button" @click="editor.openWeb()">打开网页标签</button>
    </div>

    <div v-if="dragOver" class="split-drop-zones">
      <div class="drop-zone left" @dragover.prevent @drop="dropSplit($event, 'left')">左侧</div>
      <div class="drop-zone right" @dragover.prevent @drop="dropSplit($event, 'right')">右侧</div>
      <div class="drop-zone top" @dragover.prevent @drop="dropSplit($event, 'top')">上方</div>
      <div class="drop-zone bottom" @dragover.prevent @drop="dropSplit($event, 'bottom')">下方</div>
    </div>
  </section>
</template>

<style scoped>
.editor-group {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--editor-bg);
}

.editor-group.active {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent);
}

.tabs-bar {
  height: 35px;
  flex: none;
  display: flex;
  align-items: stretch;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--tabs-bg);
}

.tab {
  min-width: 100px;
  max-width: 230px;
  display: flex;
  align-items: center;
  gap: 6px;
  border: 0;
  border-right: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  padding: 0 8px;
  cursor: default;
  font-size: 10px;
}

.tab.selected {
  background: var(--editor-bg);
  color: var(--text);
  box-shadow: inset 0 1px var(--accent);
}

.tab-title {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.tab-icon,
.tab-favicon {
  width: 15px;
  height: 15px;
  flex: none;
  border-radius: 4px;
}

.tab-icon {
  display: grid;
  place-items: center;
  background: var(--raised);
  color: var(--accent);
  font-size: 8px;
  font-weight: 750;
}

.dirty-dot {
  color: var(--accent);
  font-size: 7px;
}

.tab-close {
  width: 14px;
  flex: none;
  border-radius: 3px;
  color: var(--muted);
  font-size: 13px;
  line-height: 14px;
}

.tab-close:hover {
  background: var(--hover);
  color: var(--text);
}

.tab-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  padding: 0 4px;
}

.tab-actions button {
  width: 25px;
  height: 25px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.tab-actions button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
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

.tab-content {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.editor-empty strong {
  color: var(--text);
  font-size: 14px;
}

.editor-empty button {
  margin-top: 8px;
  height: 28px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--raised);
  color: var(--text);
  padding: 0 10px;
  cursor: pointer;
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

.split-drop-zones {
  position: absolute;
  inset: 35px 0 0;
  z-index: 20;
  pointer-events: none;
  background: color-mix(in srgb, var(--editor-bg) 58%, transparent);
}

.drop-zone {
  position: absolute;
  display: grid;
  place-items: center;
  border: 1px dashed color-mix(in srgb, var(--accent) 65%, transparent);
  border-radius: 7px;
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  color: var(--accent-strong);
  pointer-events: auto;
  font-size: 9px;
}

.drop-zone.left,
.drop-zone.right {
  top: 25%;
  bottom: 25%;
  width: 22%;
}

.drop-zone.left {
  left: 3%;
}

.drop-zone.right {
  right: 3%;
}

.drop-zone.top,
.drop-zone.bottom {
  left: 28%;
  right: 28%;
  height: 19%;
}

.drop-zone.top {
  top: 3%;
}

.drop-zone.bottom {
  bottom: 3%;
}
</style>
