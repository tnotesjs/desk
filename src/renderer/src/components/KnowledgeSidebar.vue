<script setup lang="ts">
import { computed } from 'vue'

import KnowledgeBaseIcon from './KnowledgeBaseIcon.vue'
import { useEditorStore, KNOWLEDGE_SIDEBAR_COMPACT } from '../stores/editor'
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()
const editor = useEditorStore()
const compact = computed(() => editor.knowledgeSidebarWidth <= KNOWLEDGE_SIDEBAR_COMPACT)

function showContextMenu(knowledgeBaseId: string): void {
  void window.desk.ide.showKnowledgeBaseMenu(knowledgeBaseId)
}
</script>

<template>
  <aside class="knowledge-sidebar" :class="{ compact }">
    <header class="column-header">
      <div v-if="!compact">
        <strong>知识库</strong>
      </div>
      <button
        type="button"
        class="icon-button"
        aria-label="重新扫描知识库"
        data-tooltip="重新扫描知识库"
        :disabled="store.loading"
        @click="store.refreshWorkspace"
      >
        ↻
      </button>
    </header>

    <div v-if="store.overview.knowledgeBases.length" class="knowledge-list">
      <button
        v-for="item in store.overview.knowledgeBases"
        :key="item.id"
        type="button"
        class="knowledge-item"
        :class="{ active: store.selectedKnowledgeBaseId === item.id }"
        @click="store.selectKnowledgeBase(item.id)"
        @contextmenu.prevent="showContextMenu(item.id)"
      >
        <span class="knowledge-icon">
          <KnowledgeBaseIcon :icon="item.icon" :fallback="item.displayName" />
        </span>
        <span v-if="!compact" class="knowledge-copy">
          <strong>{{ item.displayName }}</strong>
        </span>
      </button>
    </div>
    <div v-else class="column-empty">
      <strong>没有扫描到知识库</strong>
      <span>工作区的直接子目录中需要存在 TNotes.*</span>
    </div>

    <footer class="workspace-footer" :title="store.overview.path ?? ''">
      <span v-if="!compact">{{ store.overview.path ?? '尚未选择工作区' }}</span>
      <button type="button" class="link-button" @click="store.chooseWorkspace">更换</button>
    </footer>
  </aside>
</template>

<style scoped>
.knowledge-sidebar {
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
  border-right: 1px solid var(--border);
}

.column-header {
  height: 42px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 14px;
  border-bottom: 1px solid var(--border);
}

.column-header > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.column-header strong {
  font-size: 14px;
  font-weight: 650;
}

.knowledge-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 7px;
}

.knowledge-item {
  width: 100%;
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text);
  padding: 2px 5px;
  text-align: left;
  cursor: pointer;
}

.knowledge-item:hover {
  background: var(--hover);
}

.knowledge-item.active {
  background: var(--selected);
}

.knowledge-icon {
  width: 20px;
  height: 20px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 5px;
  overflow: hidden;
  background: var(--raised);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
}

.knowledge-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
}

.knowledge-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 600;
}

.knowledge-sidebar.compact .column-header {
  justify-content: center;
}

.knowledge-sidebar.compact .knowledge-item {
  justify-content: center;
  gap: 0;
}

.knowledge-badge.danger {
  background: var(--danger-soft);
  color: var(--danger);
}

.column-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  padding: 20px;
  text-align: center;
  color: var(--muted);
  font-size: 11px;
}

.column-empty strong {
  color: var(--text);
  font-size: 12px;
}

.workspace-footer {
  height: 36px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px 0 14px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 10px;
}

.workspace-footer > span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.icon-button,
.link-button {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.icon-button {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  font-size: 17px;
}

.icon-button:hover,
.link-button:hover {
  color: var(--text);
  background: var(--hover);
}

.link-button {
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--accent);
  font-size: 10px;
}
</style>
