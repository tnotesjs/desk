<script setup lang="ts">
import { computed, ref } from 'vue'

import KnowledgeBaseIcon from '../components/KnowledgeBaseIcon.vue'
import UiTooltip from '../components/UiTooltip.vue'
import NoteTabPane from './NoteTabPane.vue'
import NoteFileTabPane from './NoteFileTabPane.vue'
import WebTabPane from './WebTabPane.vue'
import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { EditorGroupNode, EditorTab } from '../../../shared/contracts'
import type { SplitPlacement } from './layoutModel'

const props = defineProps<{ group: EditorGroupNode }>()
const editor = useEditorStore()
const workspace = useWorkspaceStore()
const dragOver = ref(false)
const contextTab = ref<EditorTab | null>(null)
const contextPosition = ref({ x: 0, y: 0 })

const activeTab = computed(
  () => props.group.tabs.find((tab) => tab.id === props.group.activeTabId) ?? null
)
const pinnedTabs = computed(() => props.group.tabs.filter((tab) => tab.pinned))
const regularTabs = computed(() => props.group.tabs.filter((tab) => !tab.pinned))
const primaryKey = computed(() => (workspace.runtimePlatform === 'darwin' ? '⌘' : 'Ctrl'))
const altKey = computed(() => (workspace.runtimePlatform === 'darwin' ? '⌥' : 'Alt'))
const revealLabel = computed(() =>
  workspace.runtimePlatform === 'darwin'
    ? '在 Finder 中显示'
    : workspace.runtimePlatform === 'win32'
      ? '在文件资源管理器中显示'
      : '打开所在文件夹'
)

async function activate(tab: EditorTab): Promise<void> {
  const previous = activeTab.value
  if (previous?.type === 'web' && previous.id !== tab.id) {
    await window.desk.web.layout({ tabId: previous.id, visible: false })
  }
  editor.activate(props.group.id, tab.id)
  void workspace.syncToActiveTab()
}

function beginDrag(event: DragEvent, tab: EditorTab): void {
  event.dataTransfer?.setData('text/x-tnotes-desk-tab', tab.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function isTabDrag(event: DragEvent): boolean {
  // `getData` is unavailable during dragenter/dragover, so gate on the transfer
  // type list. Interior editor drags (e.g. Milkdown block reordering) never carry
  // this MIME type, so they must not activate the split-drop overlay.
  return Array.from(event.dataTransfer?.types ?? []).includes('text/x-tnotes-desk-tab')
}

function draggedTabId(event: DragEvent): string | null {
  return event.dataTransfer?.getData('text/x-tnotes-desk-tab') || null
}

function dropInGroup(event: DragEvent, index?: number): void {
  dragOver.value = false
  if (!isTabDrag(event)) return
  event.preventDefault()
  const tabId = draggedTabId(event)
  if (tabId) editor.moveTab(tabId, props.group.id, index)
}

function dropInRow(event: DragEvent, pinned: boolean, index?: number): void {
  event.preventDefault()
  event.stopPropagation()
  dragOver.value = false
  const tabId = draggedTabId(event)
  if (!tabId) return
  editor.moveTab(tabId, props.group.id, index)
  editor.setPinned(tabId, pinned)
}

function dropSplit(event: DragEvent, placement: SplitPlacement): void {
  if (!isTabDrag(event)) return
  event.preventDefault()
  event.stopPropagation()
  dragOver.value = false
  const tabId = draggedTabId(event)
  if (tabId) editor.splitTab(tabId, props.group.id, placement)
}

function handleGroupDragOver(event: DragEvent): void {
  if (!isTabDrag(event)) return
  event.preventDefault()
}

function handleGroupDragEnter(event: DragEvent): void {
  if (!isTabDrag(event)) return
  dragOver.value = true
}

function isDirty(tab: EditorTab): boolean {
  if (tab.type === 'note') {
    return Boolean(workspace.getDocumentSession(tab.knowledgeBaseId, tab.noteUuid)?.dirty)
  }
  if (tab.type === 'note-file') {
    return Boolean(workspace.getNoteFileSession(tab.knowledgeBaseId, tab.noteUuid, tab.path)?.dirty)
  }
  return false
}

function tabAriaLabel(tab: EditorTab): string {
  if (tab.type === 'web') return tab.url
  if (tab.type === 'note') return `${tab.knowledgeBaseName} · ${tab.title}`
  return `${tab.noteTitle} · ${tab.path}`
}

function closeTab(tab: EditorTab): void {
  if (!editor.close(props.group.id, tab.id)) workspace.status = '固定标签需要先解除固定才能关闭'
}

function closeTabWithMiddleButton(event: MouseEvent, tab: EditorTab): void {
  if (event.button !== 1) return
  event.preventDefault()
  event.stopPropagation()
  if (tab.pinned) editor.setPinned(tab.id, false)
  closeTab(tab)
}

function openWeb(): void {
  try {
    editor.openWeb()
  } catch (cause) {
    workspace.error = cause instanceof Error ? cause.message : String(cause)
  }
}

function showTabMenu(event: MouseEvent, tab: EditorTab): void {
  contextTab.value = tab
  contextPosition.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 244)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 390))
  }
  void window.desk.web.hideAll()
}

function closeTabMenu(): void {
  contextTab.value = null
  requestAnimationFrame(() => window.dispatchEvent(new Event('resize')))
}

async function runTabAction(
  action:
    | 'close'
    | 'close-saved'
    | 'close-all'
    | 'close-web'
    | 'copy-path'
    | 'reveal-file'
    | 'reveal-toc'
    | 'toggle-pin'
): Promise<void> {
  const tab = contextTab.value
  if (!tab) return
  closeTabMenu()
  if (action === 'close') closeTab(tab)
  else if (action === 'close-saved') editor.closeSavedNotes()
  else if (action === 'close-all') editor.closeAllTabs()
  else if (action === 'close-web') editor.closeAllWebTabs()
  else if (action === 'toggle-pin') editor.togglePinned(tab.id)
  else if (tab.type === 'note' && action === 'copy-path') await workspace.copyNoteDirectoryPath(tab)
  else if (tab.type === 'note' && action === 'reveal-file')
    await workspace.revealNoteInFileManager(tab)
  else if (tab.type === 'note' && action === 'reveal-toc') await workspace.revealTabInToc(tab)
}
</script>

<template>
  <section
    class="editor-group"
    :class="{ active: editor.activeGroupId === group.id, 'drag-over': dragOver }"
    @mousedown="editor.activeGroupId = group.id"
    @dragenter.prevent="handleGroupDragEnter"
    @dragleave.self="dragOver = false"
    @dragover="handleGroupDragOver"
    @drop="dropInGroup"
  >
    <div class="tabs-bar" :class="{ 'has-pinned': pinnedTabs.length, wrap: editor.wrapTabs }">
      <div
        v-if="pinnedTabs.length"
        class="tabs-row pinned-row"
        @dragover.prevent
        @drop="dropInRow($event, true)"
      >
        <button
          v-for="tab in pinnedTabs"
          :key="tab.id"
          type="button"
          class="tab pinned"
          :class="{ selected: tab.id === group.activeTabId }"
          draggable="true"
          :aria-label="tabAriaLabel(tab)"
          @click="activate(tab)"
          @auxclick="closeTabWithMiddleButton($event, tab)"
          @contextmenu.prevent="showTabMenu($event, tab)"
          @dragstart="beginDrag($event, tab)"
          @dragover.prevent
          @drop="dropInRow($event, true, group.tabs.indexOf(tab))"
        >
          <img
            v-if="tab.type === 'web' && editor.webStates[tab.id]?.faviconUrl"
            class="tab-favicon"
            :src="editor.webStates[tab.id].faviconUrl"
            alt=""
          />
          <span v-else-if="tab.type === 'note'" class="tab-icon knowledge-tab-icon">
            <KnowledgeBaseIcon :icon="tab.icon" :fallback="tab.knowledgeBaseName" />
          </span>
          <span v-else-if="tab.type === 'note-file'" class="tab-icon file-tab-icon">&lt;/&gt;</span>
          <span v-else class="tab-icon">⌘</span>
          <span class="tab-title">{{ tab.title }}</span>
          <span v-if="isDirty(tab)" class="dirty-dot">●</span>
          <span class="pin-mark" aria-hidden="true">⌖</span>
        </button>
      </div>

      <div
        class="tabs-row regular-row"
        :class="{ wrap: editor.wrapTabs }"
        @dragover.prevent
        @drop="dropInRow($event, false)"
      >
        <button
          v-for="tab in regularTabs"
          :key="tab.id"
          type="button"
          class="tab"
          :class="{
            selected: tab.id === group.activeTabId,
            preview: tab.type === 'note' && tab.preview
          }"
          draggable="true"
          :aria-label="tabAriaLabel(tab)"
          @click="activate(tab)"
          @auxclick="closeTabWithMiddleButton($event, tab)"
          @dblclick.stop="editor.keepOpen(tab.id)"
          @contextmenu.prevent="showTabMenu($event, tab)"
          @dragstart="beginDrag($event, tab)"
          @dragover.prevent
          @drop="dropInRow($event, false, group.tabs.indexOf(tab))"
        >
          <img
            v-if="tab.type === 'web' && editor.webStates[tab.id]?.faviconUrl"
            class="tab-favicon"
            :src="editor.webStates[tab.id].faviconUrl"
            alt=""
          />
          <span v-else-if="tab.type === 'note'" class="tab-icon knowledge-tab-icon">
            <KnowledgeBaseIcon :icon="tab.icon" :fallback="tab.knowledgeBaseName" />
          </span>
          <span v-else-if="tab.type === 'note-file'" class="tab-icon file-tab-icon">&lt;/&gt;</span>
          <span v-else class="tab-icon">⌘</span>
          <span class="tab-title">{{ tab.title }}</span>
          <span v-if="isDirty(tab)" class="dirty-dot">●</span>
          <span class="tab-close" aria-label="关闭标签" @click.stop="closeTab(tab)">×</span>
        </button>

        <div class="tab-actions">
          <UiTooltip label="新建网页标签">
            <button type="button" aria-label="新建网页标签" @click="openWeb">＋</button>
          </UiTooltip>
          <UiTooltip label="向右拆分">
            <button
              type="button"
              aria-label="向右拆分当前标签"
              :disabled="!activeTab"
              @click="editor.splitActive('right')"
            >
              ◫
            </button>
          </UiTooltip>
          <UiTooltip label="向下拆分">
            <button
              type="button"
              aria-label="向下拆分当前标签"
              :disabled="!activeTab"
              @click="editor.splitActive('bottom')"
            >
              ⊟
            </button>
          </UiTooltip>
        </div>
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
      <NoteFileTabPane
        v-else-if="tab.type === 'note-file'"
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
      <button type="button" @click="openWeb">打开网页标签</button>
    </div>

    <div v-if="dragOver" class="split-drop-zones">
      <div class="drop-zone left" @dragover.prevent @drop="dropSplit($event, 'left')">左侧</div>
      <div class="drop-zone right" @dragover.prevent @drop="dropSplit($event, 'right')">右侧</div>
      <div class="drop-zone top" @dragover.prevent @drop="dropSplit($event, 'top')">上方</div>
      <div class="drop-zone bottom" @dragover.prevent @drop="dropSplit($event, 'bottom')">下方</div>
    </div>

    <Teleport to="body">
      <div v-if="contextTab" class="tab-context-layer" @mousedown.self="closeTabMenu">
        <div
          class="tab-context-menu"
          :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }"
          role="menu"
          @contextmenu.prevent
        >
          <button type="button" role="menuitem" @click="runTabAction('close')">
            <span>关闭</span><kbd>{{ primaryKey }} W</kbd>
          </button>
          <button type="button" role="menuitem" @click="runTabAction('close-saved')">
            <span>关闭已保存笔记</span><kbd>{{ primaryKey }} K&nbsp; U</kbd>
          </button>
          <button type="button" role="menuitem" @click="runTabAction('close-all')">
            <span>全部关闭</span><kbd>{{ primaryKey }} K&nbsp; W</kbd>
          </button>
          <button type="button" role="menuitem" @click="runTabAction('close-web')">
            <span>关闭所有网页 tab</span>
          </button>
          <template v-if="contextTab.type === 'note'">
            <hr />
            <button type="button" role="menuitem" @click="runTabAction('copy-path')">
              <span>复制路径</span><kbd>{{ altKey }} {{ primaryKey }} C</kbd>
            </button>
            <button type="button" role="menuitem" @click="runTabAction('reveal-file')">
              <span>{{ revealLabel }}</span
              ><kbd>{{ altKey }} {{ primaryKey }} R</kbd>
            </button>
            <button type="button" role="menuitem" @click="runTabAction('reveal-toc')">
              <span>在目录列表中显示</span>
            </button>
          </template>
          <hr />
          <button type="button" role="menuitem" @click="runTabAction('toggle-pin')">
            <span>{{ contextTab.pinned ? '解除固定' : '固定' }}</span
            ><kbd>{{ primaryKey }} K&nbsp; ⇧ Enter</kbd>
          </button>
        </div>
      </div>
    </Teleport>
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
  flex: none;
  overflow-x: hidden;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border);
  background: var(--tabs-bg);
}

.tabs-row {
  min-height: 35px;
  display: flex;
  align-items: stretch;
}

.pinned-row {
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid var(--border);
  background: color-mix(in srgb, var(--raised) 55%, var(--tabs-bg));
}

.regular-row {
  min-width: 100%;
}

.regular-row.wrap {
  flex-wrap: wrap;
}

.tabs-bar:not(.wrap) .regular-row {
  overflow-x: auto;
  overflow-y: hidden;
}

.tab {
  height: 35px;
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

.tab.preview .tab-title {
  font-style: italic;
}

.tab.pinned {
  background: color-mix(in srgb, var(--raised) 38%, transparent);
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

.knowledge-tab-icon {
  background: transparent;
}

.file-tab-icon {
  width: 20px;
  background: transparent;
  font-family: var(--font-mono);
  font-size: 8px;
}

.dirty-dot {
  color: var(--accent);
  font-size: 7px;
}

.pin-mark {
  flex: none;
  color: var(--muted);
  font-size: 10px;
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
  background: var(--tabs-bg);
}

.tab-actions :deep(.ui-tooltip-host) {
  flex: none;
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

.tab-context-layer {
  position: fixed;
  z-index: 1000;
  inset: 0;
}

.tab-context-menu {
  position: fixed;
  width: 228px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: var(--raised);
  padding: 6px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.36);
}

.tab-context-menu button {
  min-height: 31px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  padding: 0 9px;
  text-align: left;
  cursor: pointer;
  font-size: 11px;
}

.tab-context-menu button:hover {
  background: var(--hover);
}

.tab-context-menu kbd {
  flex: none;
  color: var(--muted);
  font-family: var(--font-sans);
  font-size: 9px;
  font-weight: 500;
}

.tab-context-menu hr {
  width: calc(100% - 10px);
  border: 0;
  border-top: 1px solid var(--border);
  margin: 5px;
}
</style>
