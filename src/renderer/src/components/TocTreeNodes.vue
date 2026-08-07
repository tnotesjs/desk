<script setup lang="ts">
import type { TocNode } from '../types'

defineProps<{
  nodes: TocNode[]
  selectedNoteDir: string | null
  collapsed: Record<string, boolean>
  openMenu: string | null
  dragSourceId: string | null
  dropTargetId: string | null
  dropAction: 'moveAfter' | 'prependChild'
  iconOpened: string
  iconCollapsed: string
  busy: boolean
  depth?: number
}>()

const emit = defineEmits<{
  select: [noteDir: string]
  'toggle-collapse': [nodeId: string]
  'toggle-menu': [key: string]
  'create-note': [node: TocNode]
  'create-notes': [node: TocNode]
  'create-folder': [node: TocNode]
  'rename-note': [node: Extract<TocNode, { type: 'note' }>]
  'rename-folder': [node: Extract<TocNode, { type: 'group' }>]
  'delete-note': [node: Extract<TocNode, { type: 'note' }>]
  'delete-entry': [node: TocNode]
  'create-around': [node: Extract<TocNode, { type: 'note' }>, placement: 'before' | 'after']
  'drag-start': [nodeId: string, e: DragEvent]
  'drag-over': [nodeId: string, e: DragEvent]
  'drag-leave': [nodeId: string]
  drop: [nodeId: string, e: DragEvent]
  'drag-end': []
}>()

function displayTitle(node: TocNode): string {
  if (node.type === 'group') return node.title
  return node.title.replace(/^\d{4}\.\s*/, '')
}
</script>

<template>
  <ul class="nodes" :style="{ '--depth': depth ?? 0 }">
    <li v-for="node in nodes" :key="node.nodeId" class="node">
      <!-- Folder / group -->
      <div
        v-if="node.type === 'group'"
        class="row"
        :class="{
          'drop-after': dropTargetId === node.nodeId && dropAction === 'moveAfter',
          'drop-inside': dropTargetId === node.nodeId && dropAction === 'prependChild',
          dragging: dragSourceId === node.nodeId
        }"
        draggable="true"
        @click.stop
        @dragstart="emit('drag-start', node.nodeId, $event)"
        @dragover="emit('drag-over', node.nodeId, $event)"
        @dragleave="emit('drag-leave', node.nodeId)"
        @drop="emit('drop', node.nodeId, $event)"
        @dragend="emit('drag-end')"
      >
        <button
          type="button"
          class="arrow"
          :title="collapsed[node.nodeId] ? '展开' : '折叠'"
          @click="emit('toggle-collapse', node.nodeId)"
        >
          <img :src="collapsed[node.nodeId] ? iconCollapsed : iconOpened" alt="" />
        </button>
        <span class="label group">{{ displayTitle(node) }}</span>
        <div class="actions" :class="{ open: openMenu === `${node.nodeId}:more` || openMenu === `${node.nodeId}:add` }">
          <button type="button" class="action" :disabled="busy" @click="emit('toggle-menu', `${node.nodeId}:more`)">
            …
          </button>
          <div v-if="openMenu === `${node.nodeId}:more`" class="menu">
            <button type="button" @click="emit('rename-folder', node)">重命名</button>
            <button type="button" class="danger" @click="emit('delete-entry', node)">删除分组</button>
          </div>
          <button type="button" class="action" :disabled="busy" @click="emit('toggle-menu', `${node.nodeId}:add`)">
            +
          </button>
          <div v-if="openMenu === `${node.nodeId}:add`" class="menu">
            <button type="button" @click="emit('create-note', node)">新增笔记</button>
            <button type="button" @click="emit('create-notes', node)">新增多篇笔记</button>
            <button type="button" @click="emit('create-folder', node)">新建子目录</button>
          </div>
        </div>
      </div>

      <!-- Note row -->
      <div
        v-else
        class="row"
        :class="{
          active: node.noteDir === selectedNoteDir,
          'drop-after': dropTargetId === node.nodeId && dropAction === 'moveAfter',
          'drop-inside': dropTargetId === node.nodeId && dropAction === 'prependChild',
          dragging: dragSourceId === node.nodeId
        }"
        draggable="true"
        @click.stop
        @dragstart="emit('drag-start', node.nodeId, $event)"
        @dragover="emit('drag-over', node.nodeId, $event)"
        @dragleave="emit('drag-leave', node.nodeId)"
        @drop="emit('drop', node.nodeId, $event)"
        @dragend="emit('drag-end')"
      >
        <button
          v-if="node.children.length"
          type="button"
          class="arrow"
          :title="collapsed[node.nodeId] ? '展开' : '折叠'"
          @click="emit('toggle-collapse', node.nodeId)"
        >
          <img :src="collapsed[node.nodeId] ? iconCollapsed : iconOpened" alt="" />
        </button>
        <span v-else class="arrow spacer" />
        <button type="button" class="note-btn" @click="emit('select', node.noteDir)">
          <span class="mark">{{ node.completed ? '✓' : '·' }}</span>
          <span class="label">{{ displayTitle(node) }}</span>
        </button>
        <div class="actions" :class="{ open: openMenu === `${node.nodeId}:more` || openMenu === `${node.nodeId}:add` }">
          <button type="button" class="action" :disabled="busy" @click="emit('toggle-menu', `${node.nodeId}:more`)">
            …
          </button>
          <div v-if="openMenu === `${node.nodeId}:more`" class="menu">
            <button type="button" @click="emit('rename-note', node)">重命名</button>
            <button type="button" @click="emit('create-around', node, 'before')">上方插入</button>
            <button type="button" @click="emit('create-around', node, 'after')">下方插入</button>
            <button type="button" class="danger" @click="emit('delete-note', node)">删除笔记</button>
          </div>
          <button type="button" class="action" :disabled="busy" @click="emit('toggle-menu', `${node.nodeId}:add`)">
            +
          </button>
          <div v-if="openMenu === `${node.nodeId}:add`" class="menu">
            <button type="button" @click="emit('create-note', node)">新增子笔记</button>
            <button type="button" @click="emit('create-notes', node)">新增多篇子笔记</button>
            <button type="button" @click="emit('create-folder', node)">新建子目录</button>
          </div>
        </div>
      </div>

      <TocTreeNodes
        v-if="node.children.length && !collapsed[node.nodeId]"
        :nodes="node.children"
        :selected-note-dir="selectedNoteDir"
        :collapsed="collapsed"
        :open-menu="openMenu"
        :drag-source-id="dragSourceId"
        :drop-target-id="dropTargetId"
        :drop-action="dropAction"
        :icon-opened="iconOpened"
        :icon-collapsed="iconCollapsed"
        :busy="busy"
        :depth="(depth ?? 0) + 1"
        @select="emit('select', $event)"
        @toggle-collapse="emit('toggle-collapse', $event)"
        @toggle-menu="emit('toggle-menu', $event)"
        @create-note="emit('create-note', $event)"
        @create-notes="emit('create-notes', $event)"
        @create-folder="emit('create-folder', $event)"
        @rename-note="emit('rename-note', $event)"
        @rename-folder="emit('rename-folder', $event)"
        @delete-note="emit('delete-note', $event)"
        @delete-entry="emit('delete-entry', $event)"
        @create-around="(n, p) => emit('create-around', n, p)"
        @drag-start="(id, e) => emit('drag-start', id, e)"
        @drag-over="(id, e) => emit('drag-over', id, e)"
        @drag-leave="emit('drag-leave', $event)"
        @drop="(id, e) => emit('drop', id, e)"
        @drag-end="emit('drag-end')"
      />
    </li>
  </ul>
</template>

<script lang="ts">
export default { name: 'TocTreeNodes' }
</script>

<style scoped>
.nodes {
  list-style: none;
  margin: 0;
  padding: 0;
}

.node {
  margin: 0;
}

.row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 2px 4px;
  padding-left: calc(4px + var(--depth) * 12px);
  border-radius: 6px;
  position: relative;
}

.row:hover,
.row.active {
  background: var(--hover);
}

.row.active {
  background: var(--accent-soft);
}

.row.dragging {
  opacity: 0.45;
}

.row.drop-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  background: var(--accent);
}

.row.drop-inside {
  outline: 1px solid var(--accent);
}

.arrow {
  width: 18px;
  height: 18px;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  flex: none;
  display: grid;
  place-items: center;
}

.arrow img {
  width: 12px;
  height: 12px;
  opacity: 0.7;
}

.arrow.spacer {
  cursor: default;
}

.note-btn {
  flex: 1;
  min-width: 0;
  display: flex;
  gap: 6px;
  align-items: flex-start;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  padding: 2px 0;
  font-size: 13px;
  line-height: 1.35;
}

.label {
  min-width: 0;
  word-break: break-word;
}

.label.group {
  flex: 1;
  font-size: 12px;
  font-weight: 650;
  color: var(--muted);
  padding: 2px 0;
}

.mark {
  width: 12px;
  flex: none;
  opacity: 0.75;
}

.actions {
  position: relative;
  display: none;
  gap: 2px;
  flex: none;
}

.row:hover .actions,
.actions.open {
  display: inline-flex;
}

.action {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 12px;
}

.action:hover {
  background: var(--bg);
  color: var(--text);
}

.menu {
  position: absolute;
  top: 100%;
  right: 0;
  z-index: 20;
  min-width: 140px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
}

.menu button {
  border: 0;
  background: transparent;
  text-align: left;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--text);
  font-size: 12px;
}

.menu button:hover {
  background: var(--hover);
}

.menu button.danger {
  color: #c44;
}
</style>
