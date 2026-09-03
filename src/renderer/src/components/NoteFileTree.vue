<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  clampSidebarWidth,
  NOTE_FILE_SIDEBAR_MAX,
  NOTE_FILE_SIDEBAR_MIN,
  useEditorStore
} from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

import type { NoteFileEntryDto, NoteFileKind } from '../../../shared/contracts'

interface TreeRow extends NoteFileEntryDto {
  depth: number
  expanded: boolean
}

const editor = useEditorStore()
const workspace = useWorkspaceStore()
const children = ref<Record<string, NoteFileEntryDto[]>>({})
const loadingDirectories = ref<string[]>([])
const loadError = ref<string | null>(null)
let loadGeneration = 0

const scope = computed(() => editor.activeNoteScope)
const scopeKey = computed(() => {
  if (!editor.activeKnowledgeBaseId || !scope.value) return null
  return `${editor.activeKnowledgeBaseId}:${scope.value.noteUuid}`
})
const expanded = computed(
  () => new Set(scopeKey.value ? (editor.expandedNoteFileDirectories[scopeKey.value] ?? []) : [])
)
const activePath = computed(() => {
  const tab = editor.activeTab
  if (tab?.type === 'note') return 'README.md'
  if (tab?.type === 'note-file') return tab.path
  return null
})
const rows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = []
  const append = (directory: string, depth: number): void => {
    for (const entry of children.value[directory] ?? []) {
      const isExpanded = entry.kind === 'directory' && expanded.value.has(entry.path)
      result.push({ ...entry, depth, expanded: isExpanded })
      if (isExpanded) append(entry.path, depth + 1)
    }
  }
  append('', 0)
  return result
})

function setExpanded(paths: Set<string>): void {
  const key = scopeKey.value
  if (!key) return
  editor.expandedNoteFileDirectories = {
    ...editor.expandedNoteFileDirectories,
    [key]: [...paths]
  }
}

async function loadDirectory(directory: string, generation = loadGeneration): Promise<void> {
  if (!editor.activeKnowledgeBaseId || !scope.value) return
  if (loadingDirectories.value.includes(directory)) return
  loadingDirectories.value = [...loadingDirectories.value, directory]
  try {
    const entries = await workspace.listNoteFiles(
      editor.activeKnowledgeBaseId,
      scope.value.noteUuid,
      directory || undefined
    )
    if (generation !== loadGeneration) return
    children.value = { ...children.value, [directory]: entries }
    await Promise.all(
      entries
        .filter((entry) => entry.kind === 'directory' && expanded.value.has(entry.path))
        .map((entry) => loadDirectory(entry.path, generation))
    )
  } catch (cause) {
    if (generation === loadGeneration) {
      loadError.value = cause instanceof Error ? cause.message : String(cause)
    }
  } finally {
    loadingDirectories.value = loadingDirectories.value.filter((item) => item !== directory)
  }
}

async function activateRow(row: TreeRow): Promise<void> {
  if (row.kind === 'directory') {
    const next = new Set(expanded.value)
    if (next.has(row.path)) next.delete(row.path)
    else {
      next.add(row.path)
      if (!children.value[row.path]) await loadDirectory(row.path)
    }
    setExpanded(next)
    return
  }
  await workspace.openNoteFile(row.path, row.fileKind as NoteFileKind)
}

function beginResize(event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = editor.noteFileSidebarWidth
  const move = (next: PointerEvent): void => {
    editor.noteFileSidebarWidth = clampSidebarWidth(
      startWidth + next.clientX - startX,
      NOTE_FILE_SIDEBAR_MIN,
      NOTE_FILE_SIDEBAR_MAX
    )
  }
  const up = (): void => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up, { once: true })
}

watch(
  [scopeKey, () => workspace.noteFileTreeRevision],
  () => {
    loadGeneration += 1
    children.value = {}
    loadingDirectories.value = []
    loadError.value = null
    if (scopeKey.value) void loadDirectory('', loadGeneration)
  },
  { immediate: true }
)
</script>

<template>
  <aside
    v-if="scope"
    class="note-file-sidebar"
    :class="{ collapsed: editor.noteFileSidebarCollapsed }"
    :style="
      editor.noteFileSidebarCollapsed ? undefined : { width: `${editor.noteFileSidebarWidth}px` }
    "
  >
    <template v-if="editor.noteFileSidebarCollapsed">
      <button
        type="button"
        class="collapsed-button"
        title="展开笔记文件"
        aria-label="展开笔记文件"
        @click="editor.noteFileSidebarCollapsed = false"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h6l2 2h8v12H4V5Z" />
        </svg>
      </button>
    </template>
    <template v-else>
      <header class="tree-header">
        <div>
          <span>笔记文件</span>
          <strong :title="scope.noteTitle">{{ scope.noteTitle }}</strong>
        </div>
        <button
          type="button"
          title="折叠笔记文件"
          aria-label="折叠笔记文件"
          @click="editor.noteFileSidebarCollapsed = true"
        >
          ‹
        </button>
      </header>
      <div class="tree-body" role="tree" aria-label="笔记文件">
        <button
          v-for="row in rows"
          :key="row.path"
          type="button"
          class="tree-row"
          :class="{ active: row.path === activePath, directory: row.kind === 'directory' }"
          :style="{ paddingLeft: `${9 + row.depth * 14}px` }"
          :title="row.path"
          role="treeitem"
          :aria-expanded="row.kind === 'directory' ? row.expanded : undefined"
          @click="activateRow(row)"
        >
          <span class="chevron">{{
            row.kind === 'directory' ? (row.expanded ? '⌄' : '›') : ''
          }}</span>
          <svg v-if="row.kind === 'directory'" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3.5 6h6l2 2h9v10.5h-17V6Z" />
          </svg>
          <span v-else class="file-glyph">{{ row.fileKind === 'image' ? '◇' : '#' }}</span>
          <span class="row-label">{{ row.name }}</span>
        </button>
        <span v-if="loadingDirectories.includes('') && rows.length === 0" class="tree-message">
          正在读取…
        </span>
        <span v-else-if="loadError" class="tree-message error">{{ loadError }}</span>
        <span v-else-if="rows.length === 0" class="tree-message">目录为空</span>
      </div>
      <div class="resize-handle" @pointerdown="beginResize" />
    </template>
  </aside>
</template>

<style scoped>
.note-file-sidebar {
  position: relative;
  min-width: 180px;
  min-height: 0;
  flex: none;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
  background: color-mix(in srgb, var(--sidebar-bg) 86%, var(--editor-bg));
}

.note-file-sidebar.collapsed {
  width: 36px;
  min-width: 36px;
  align-items: center;
  padding-top: 5px;
}

.collapsed-button,
.tree-header button {
  width: 27px;
  height: 27px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.collapsed-button:hover,
.tree-header button:hover {
  background: var(--hover);
  color: var(--text);
}

.collapsed-button svg {
  width: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
}

.tree-header {
  min-height: 47px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  border-bottom: 1px solid var(--border);
  padding: 5px 5px 5px 10px;
}

.tree-header div {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--muted);
  font-size: 9px;
}

.tree-header strong {
  overflow: hidden;
  color: var(--text);
  font-size: 10px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 5px 0 10px;
}

.tree-row {
  width: 100%;
  height: 25px;
  display: flex;
  align-items: center;
  gap: 4px;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding-right: 7px;
  cursor: default;
  font-size: 10px;
  text-align: left;
}

.tree-row:hover {
  background: var(--hover);
  color: var(--text);
}

.tree-row.active {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  color: var(--text);
}

.tree-row svg {
  width: 13px;
  height: 13px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.55;
}

.chevron {
  width: 8px;
  flex: none;
  text-align: center;
}

.file-glyph {
  width: 13px;
  flex: none;
  color: var(--accent);
  font-family: var(--font-mono);
  text-align: center;
}

.row-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-message {
  display: block;
  padding: 12px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
}

.tree-message.error {
  color: var(--danger);
}

.resize-handle {
  position: absolute;
  z-index: 3;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
}
</style>
