<script setup lang="ts">
import { computed, inject, nextTick, provide, ref, watch } from 'vue'

import { useEditorStore } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'
import type { DeskTocNode } from '../../../shared/contracts'
import type { InjectionKey, Ref } from 'vue'

defineOptions({ name: 'TocNodeList' })

const props = defineProps<{
  nodes: DeskTocNode[]
  selectedNoteUuid: string | null
  depth?: number
  focusRequestId?: number
}>()

const emit = defineEmits<{
  select: [node: Extract<DeskTocNode, { type: 'note' }>]
  selectPermanent: [node: Extract<DeskTocNode, { type: 'note' }>]
  selectSplit: [node: Extract<DeskTocNode, { type: 'note' }>]
  toggleDone: [node: Extract<DeskTocNode, { type: 'note' }>]
  requestCreate: [node: DeskTocNode, placement: 'before' | 'after' | 'inside']
  requestRename: [node: DeskTocNode]
  requestDelete: [node: DeskTocNode]
  move: [source: DeskTocNode, target: DeskTocNode, placement: 'before' | 'after' | 'inside']
  openIde: [node: Extract<DeskTocNode, { type: 'note' }>]
}>()

const collapsedKey: InjectionKey<Ref<Set<string>>> = Symbol.for('tnotes-desk-toc-collapsed')
const inheritedCollapsed = inject(collapsedKey, null)
const collapsed = inheritedCollapsed ?? ref(new Set<string>())
if (!inheritedCollapsed) provide(collapsedKey, collapsed)
const listHost = ref<HTMLElement | null>(null)
const focusedNoteUuid = ref<string | null>(null)
const dropTarget = ref<{ nodeId: string; placement: 'before' | 'after' | 'inside' } | null>(null)
const draggingNodeId = ref<string | null>(null)
const contextNote = ref<Extract<DeskTocNode, { type: 'note' }> | null>(null)
const contextPosition = ref({ x: 0, y: 0 })
let expandTimer: ReturnType<typeof setTimeout> | null = null

const store = useWorkspaceStore()
const editor = useEditorStore()
const tocShowIndex = computed(() => store.settings?.toc?.showNoteIndex !== false)
const tocShowStatus = computed(() => store.settings?.toc?.showNoteStatus !== false)
const tocDoneEmoji = computed(() => store.settings?.toc?.doneEmoji ?? '✅')
const tocUndoneEmoji = computed(() => store.settings?.toc?.undoneEmoji ?? '⏰')
const revealLabel = computed(() =>
  store.runtimePlatform === 'darwin'
    ? '在 Finder 中显示'
    : store.runtimePlatform === 'win32'
      ? '在文件资源管理器中显示'
      : '打开所在文件夹'
)
const contextNoteTab = computed(() => {
  const knowledgeBaseId = store.selectedKnowledgeBaseId
  const noteUuid = contextNote.value?.uuid
  if (!knowledgeBaseId || !noteUuid) return null
  return (
    editor.groups
      .flatMap((group) => group.tabs)
      .find(
        (tab) =>
          tab.type === 'note' &&
          tab.knowledgeBaseId === knowledgeBaseId &&
          tab.noteUuid === noteUuid
      ) ?? null
  )
})

function parentPathToNote(
  nodes: DeskTocNode[],
  noteUuid: string,
  parents: string[] = []
): string[] | null {
  for (const node of nodes) {
    if (node.type === 'note' && node.uuid === noteUuid) return parents
    const match = parentPathToNote(node.children, noteUuid, [...parents, node.nodeId])
    if (match) return match
  }
  return null
}

watch(
  () => props.focusRequestId,
  async (requestId) => {
    if (inheritedCollapsed || !requestId || !props.selectedNoteUuid) return
    const parents = parentPathToNote(props.nodes, props.selectedNoteUuid)
    if (!parents) return
    const next = new Set(collapsed.value)
    for (const nodeId of parents) next.delete(nodeId)
    collapsed.value = next
    focusedNoteUuid.value = props.selectedNoteUuid
    await nextTick()
    requestAnimationFrame(() => {
      const row = [...(listHost.value?.querySelectorAll<HTMLElement>('.toc-row') ?? [])].find(
        (candidate) => candidate.dataset.noteUuid === props.selectedNoteUuid
      )
      row?.scrollIntoView?.({ block: 'nearest' })
      window.setTimeout(() => {
        if (focusedNoteUuid.value === props.selectedNoteUuid) focusedNoteUuid.value = null
      }, 900)
    })
  }
)

function toggle(nodeId: string): void {
  const next = new Set(collapsed.value)
  if (next.has(nodeId)) next.delete(nodeId)
  else next.add(nodeId)
  collapsed.value = next
}

function dragStart(event: DragEvent, node: DeskTocNode): void {
  if (!event.dataTransfer) return
  const target = event.target as HTMLElement
  if (target.closest('.row-menu, .row-action')) {
    event.preventDefault()
    return
  }
  draggingNodeId.value = node.nodeId
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-tnotes-toc', JSON.stringify(node))
  event.dataTransfer.setData('text/plain', node.title)
  const ghost = document.createElement('div')
  ghost.className = 'toc-drag-ghost'
  ghost.textContent = node.type === 'note' ? `${node.noteIndex}  ${node.title}` : node.title
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, 18, 16)
  requestAnimationFrame(() => ghost.remove())
}

function dragPlacement(event: DragEvent): 'before' | 'after' | 'inside' {
  const row = event.currentTarget as HTMLElement
  const ratio = (event.clientY - row.getBoundingClientRect().top) / row.offsetHeight
  if (ratio < 0.28) return 'before'
  if (ratio > 0.72) return 'after'
  return 'inside'
}

function dragOver(event: DragEvent, node: DeskTocNode): void {
  if (!event.dataTransfer?.types.includes('application/x-tnotes-toc')) return
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  const placement = dragPlacement(event)
  dropTarget.value = { nodeId: node.nodeId, placement }
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = null
  if (placement === 'inside' && node.children.length && collapsed.value.has(node.nodeId)) {
    expandTimer = setTimeout(() => toggle(node.nodeId), 520)
  }
  const scroller = (event.currentTarget as HTMLElement).closest<HTMLElement>('.navigator-body')
  if (scroller) {
    const bounds = scroller.getBoundingClientRect()
    if (event.clientY < bounds.top + 44) scroller.scrollTop -= 12
    else if (event.clientY > bounds.bottom - 44) scroller.scrollTop += 12
  }
}

function dragLeave(event: DragEvent, node: DeskTocNode): void {
  const row = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return
  if (dropTarget.value?.nodeId === node.nodeId) dropTarget.value = null
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = null
}

function containsNode(node: DeskTocNode, nodeId: string): boolean {
  return node.children.some((child) => child.nodeId === nodeId || containsNode(child, nodeId))
}

function dragEnd(): void {
  draggingNodeId.value = null
  dropTarget.value = null
  if (expandTimer) clearTimeout(expandTimer)
  expandTimer = null
}

function drop(event: DragEvent, target: DeskTocNode): void {
  event.preventDefault()
  const raw = event.dataTransfer?.getData('application/x-tnotes-toc')
  const placement = dropTarget.value?.placement ?? dragPlacement(event)
  dropTarget.value = null
  if (!raw) return
  try {
    const source = JSON.parse(raw) as DeskTocNode
    if (source.nodeId !== target.nodeId && !containsNode(source, target.nodeId)) {
      emit('move', source, target, placement)
    }
  } catch {
    // Ignore drags originating outside the TNotes tree.
  } finally {
    dragEnd()
  }
}

function runMenuAction(event: MouseEvent, action: () => void): void {
  action()
  ;(event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}

function showNoteContextMenu(
  event: MouseEvent,
  node: Extract<DeskTocNode, { type: 'note' }>
): void {
  event.stopPropagation()
  contextNote.value = node
  contextPosition.value = {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - 232)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - 210))
  }
}

function closeNoteContextMenu(): void {
  contextNote.value = null
}

async function runNoteContextAction(
  action: 'copy-path' | 'reveal-file' | 'toggle-pin' | 'open-ide'
): Promise<void> {
  const node = contextNote.value
  const knowledgeBaseId = store.selectedKnowledgeBaseId
  if (!node || !knowledgeBaseId) return
  const existingTab = contextNoteTab.value
  closeNoteContextMenu()
  const target = { knowledgeBaseId, noteUuid: node.uuid }
  if (action === 'copy-path') {
    await store.copyNoteDirectoryPath(target)
    return
  }
  if (action === 'reveal-file') {
    await store.revealNoteInFileManager(target)
    return
  }
  if (action === 'open-ide') {
    const result = await window.desk.ide.openNote(knowledgeBaseId, node.uuid)
    if (!result.ok) store.error = result.error.message
    return
  }
  if (existingTab) {
    editor.setPinned(existingTab.id, !existingTab.pinned)
    return
  }
  await store.selectNote(node, undefined, true)
  const openedTab = editor.groups
    .flatMap((group) => group.tabs)
    .find(
      (tab) =>
        tab.type === 'note' && tab.knowledgeBaseId === knowledgeBaseId && tab.noteUuid === node.uuid
    )
  if (openedTab) editor.setPinned(openedTab.id, true)
}

function collectBranchIds(nodes: DeskTocNode[]): string[] {
  const ids: string[] = []
  for (const node of nodes) {
    if (node.children.length) {
      ids.push(node.nodeId)
      ids.push(...collectBranchIds(node.children))
    }
  }
  return ids
}

function toggleAllCollapsed(): void {
  const branchIds = collectBranchIds(props.nodes)
  const allCollapsed =
    branchIds.length > 0 && branchIds.every((nodeId) => collapsed.value.has(nodeId))
  collapsed.value = allCollapsed ? new Set<string>() : new Set(branchIds)
}

defineExpose({ toggleAllCollapsed })
</script>

<template>
  <ul ref="listHost" class="toc-nodes">
    <li v-for="node in nodes" :key="node.nodeId">
      <div
        class="toc-row"
        :class="{
          active: node.type === 'note' && node.uuid === selectedNoteUuid,
          focused: node.type === 'note' && node.uuid === focusedNoteUuid,
          dragging: draggingNodeId === node.nodeId,
          [`drop-${dropTarget?.placement}`]: dropTarget?.nodeId === node.nodeId
        }"
        :data-note-uuid="node.type === 'note' ? node.uuid : undefined"
        :style="{ '--depth': depth ?? 0 }"
        draggable="true"
        @dragstart.stop="dragStart($event, node)"
        @dragend.stop="dragEnd"
        @dragover.stop="dragOver($event, node)"
        @dragleave="dragLeave($event, node)"
        @drop.stop="drop($event, node)"
        @contextmenu.prevent="node.type === 'note' && showNoteContextMenu($event, node)"
      >
        <button
          v-if="node.children.length"
          type="button"
          class="disclosure"
          :aria-label="collapsed.has(node.nodeId) ? '展开' : '折叠'"
          :data-tooltip="collapsed.has(node.nodeId) ? '展开' : '折叠'"
          @click="toggle(node.nodeId)"
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path :d="collapsed.has(node.nodeId) ? 'M4 2.5 7.5 6 4 9.5' : 'M2.5 4 6 7.5 9.5 4'" />
          </svg>
        </button>
        <span v-else class="disclosure spacer" />

        <template v-if="node.type === 'group'">
          <button type="button" class="node-label group" @click="toggle(node.nodeId)">
            {{ node.title }}
          </button>
        </template>
        <template v-else>
          <button
            v-if="tocShowStatus"
            type="button"
            class="done-toggle"
            :class="{ done: node.completed }"
            :aria-label="node.completed ? '标记为未完成' : '标记为完成'"
            @click="emit('toggleDone', node)"
          >
            {{ node.completed ? tocDoneEmoji : tocUndoneEmoji }}
          </button>
          <button
            type="button"
            class="node-label"
            @click="emit('select', node)"
            @dblclick.stop="emit('selectPermanent', node)"
          >
            <span v-if="tocShowIndex" class="note-index">{{ node.noteIndex }}</span>
            <span>{{ node.title }}</span>
          </button>
        </template>

        <details class="row-menu" @click.stop>
          <summary class="row-action menu-trigger" aria-label="更多操作" data-tooltip="更多操作">
            ⋮
          </summary>
          <div class="row-menu-popover">
            <button
              v-if="node.type === 'note'"
              type="button"
              @click="runMenuAction($event, () => emit('selectSplit', node))"
            >
              <span>◫</span>在右侧打开
            </button>
            <button type="button" @click="runMenuAction($event, () => emit('requestRename', node))">
              <span>✎</span>重命名
            </button>
            <button
              v-if="node.type === 'note'"
              type="button"
              @click="runMenuAction($event, () => emit('toggleDone', node))"
            >
              <span>✓</span>{{ node.completed ? '标记为未完成' : '标记为完成' }}
            </button>
            <button
              v-if="node.type === 'note'"
              type="button"
              @click="runMenuAction($event, () => emit('openIde', node))"
            >
              <span>⌘</span>使用 IDE 打开
            </button>
            <hr />
            <button
              type="button"
              @click="runMenuAction($event, () => emit('requestCreate', node, 'before'))"
            >
              <span>↑</span>在上方添加
            </button>
            <button
              type="button"
              @click="runMenuAction($event, () => emit('requestCreate', node, 'after'))"
            >
              <span>↓</span>在下方添加
            </button>
            <hr />
            <button
              type="button"
              class="danger"
              @click="runMenuAction($event, () => emit('requestDelete', node))"
            >
              <span>×</span>永久删除
            </button>
          </div>
        </details>

        <button
          type="button"
          class="row-action add-note-action"
          aria-label="添加子笔记"
          data-tooltip="添加子笔记"
          @click="emit('requestCreate', node, 'inside')"
        >
          +
        </button>
      </div>

      <TocNodeList
        v-if="node.children.length && !collapsed.has(node.nodeId)"
        :nodes="node.children"
        :selected-note-uuid="selectedNoteUuid"
        :focus-request-id="focusRequestId"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
        @select-permanent="emit('selectPermanent', $event)"
        @select-split="emit('selectSplit', $event)"
        @toggle-done="emit('toggleDone', $event)"
        @request-create="(child, placement) => emit('requestCreate', child, placement)"
        @request-rename="emit('requestRename', $event)"
        @request-delete="emit('requestDelete', $event)"
        @move="(source, target, placement) => emit('move', source, target, placement)"
        @open-ide="emit('openIde', $event)"
      />
    </li>
  </ul>

  <Teleport to="body">
    <div v-if="contextNote" class="note-context-layer" @mousedown.self="closeNoteContextMenu">
      <div
        class="note-context-menu"
        :style="{ left: `${contextPosition.x}px`, top: `${contextPosition.y}px` }"
        role="menu"
        @contextmenu.prevent
      >
        <button type="button" role="menuitem" @click="runNoteContextAction('copy-path')">
          复制路径
        </button>
        <button type="button" role="menuitem" @click="runNoteContextAction('reveal-file')">
          {{ revealLabel }}
        </button>
        <button type="button" role="menuitem" @click="runNoteContextAction('toggle-pin')">
          {{ contextNoteTab?.pinned ? '解除固定' : '固定' }}
        </button>
        <hr />
        <button type="button" role="menuitem" @click="runNoteContextAction('open-ide')">
          使用 IDE 打开
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.toc-nodes {
  margin: 0;
  padding: 0;
  list-style: none;
}

.toc-row {
  position: relative;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 2px 5px 2px calc(5px + var(--depth) * 12px);
  border-radius: 5px;
  color: var(--text);
}

.toc-row:hover {
  background: var(--hover);
}

.toc-row.active {
  background: var(--selected);
  color: var(--accent-strong);
}

.toc-row.focused {
  animation: toc-focus-pulse 0.9s ease-out;
}

@keyframes toc-focus-pulse {
  0%,
  45% {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 80%, transparent);
  }
  100% {
    box-shadow: inset 0 0 0 1px transparent;
  }
}

.toc-row.dragging {
  opacity: 0.38;
}

.toc-row.drop-before {
  box-shadow: none;
}

.toc-row.drop-after {
  box-shadow: none;
}

.toc-row.drop-before::before,
.toc-row.drop-after::after {
  content: '';
  position: absolute;
  z-index: 2;
  right: 4px;
  left: calc(18px + var(--depth) * 12px);
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
  box-shadow: -3px 0 0 1px var(--accent);
}

.toc-row.drop-before::before {
  top: -1px;
}

.toc-row.drop-after::after {
  bottom: -1px;
}

.toc-row.drop-inside {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
  background: color-mix(in srgb, var(--selected) 86%, transparent);
}

.disclosure,
.row-action,
.done-toggle,
.node-label {
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.disclosure {
  width: 18px;
  height: 20px;
  display: grid;
  place-items: center;
  padding: 0;
  flex: none;
  color: var(--muted);
}

.disclosure svg {
  width: 12px;
  height: 12px;
  overflow: visible;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.disclosure.spacer {
  display: inline-block;
}

.done-toggle {
  width: 14px;
  height: 14px;
  flex: none;
  display: grid;
  place-items: center;
  border: 1px solid var(--muted);
  border-radius: 4px;
  padding: 0;
  color: var(--success);
  font-size: 10px;
}

.done-toggle.done {
  border-color: var(--success);
  background: var(--success-soft);
}

.node-label {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 0;
  overflow: hidden;
  text-align: left;
  font-size: 12px;
}

.node-label > span:last-child,
.node-label.group {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node-label.group {
  font-weight: 650;
  color: var(--muted);
}

.note-index {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 9px;
}

.row-action {
  width: 20px;
  height: 20px;
  flex: none;
  display: none;
  border-radius: 4px;
  color: var(--muted);
}

.toc-row:hover > .row-action,
.toc-row:hover > .row-menu > .row-action,
.row-menu[open] > .row-action {
  display: block;
}

.row-action:hover,
.menu-trigger:hover,
.add-note-action:hover {
  background: var(--selected);
  color: var(--accent);
}

.row-menu {
  position: relative;
  flex: none;
}

.row-menu > summary {
  display: none;
  box-sizing: border-box;
  padding: 1px 0 0;
  text-align: center;
  list-style: none;
  font-size: 16px;
  line-height: 18px;
}

.row-menu > summary::-webkit-details-marker {
  display: none;
}

.row-menu-popover {
  position: absolute;
  z-index: 30;
  top: 22px;
  right: 0;
  width: 154px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--raised);
  padding: 5px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
}

.row-menu-popover button {
  min-height: 29px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  text-align: left;
  padding: 0 8px;
  cursor: pointer;
  font-size: 11px;
}

.row-menu-popover button > span {
  width: 16px;
  flex: none;
  color: var(--muted);
  text-align: center;
  font-family: var(--font-mono);
}

.row-menu-popover button:hover {
  background: var(--hover);
}

.row-menu-popover button.danger {
  color: var(--danger);
}

.row-menu-popover button.danger:hover {
  background: var(--danger-soft);
}

.row-menu-popover hr {
  width: calc(100% - 8px);
  border: 0;
  border-top: 1px solid var(--border);
  margin: 4px;
}

.note-context-layer {
  position: fixed;
  z-index: 1000;
  inset: 0;
}

.note-context-menu {
  position: fixed;
  width: 220px;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-strong);
  border-radius: 9px;
  background: var(--raised);
  padding: 6px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.36);
}

.note-context-menu button {
  min-height: 31px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text);
  padding: 0 9px;
  text-align: left;
  cursor: pointer;
  font-size: 11px;
}

.note-context-menu button:hover {
  background: var(--hover);
}

.note-context-menu hr {
  width: calc(100% - 10px);
  border: 0;
  border-top: 1px solid var(--border);
  margin: 5px;
}

:global(.toc-drag-ghost) {
  position: fixed;
  z-index: 9999;
  top: -100px;
  left: -100px;
  max-width: 260px;
  overflow: hidden;
  border: 1px solid var(--accent);
  border-radius: 7px;
  background: var(--raised);
  padding: 7px 12px;
  color: var(--text);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.3);
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}
</style>
