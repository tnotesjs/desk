<script setup lang="ts">
import { useWorkspaceStore } from '../stores/workspace'

const store = useWorkspaceStore()

function showContextMenu(knowledgeBaseId: string): void {
  void window.desk.ide.showKnowledgeBaseMenu(knowledgeBaseId)
}
</script>

<template>
  <aside class="knowledge-sidebar">
    <header class="column-header">
      <div>
        <span class="eyebrow">工作区</span>
        <strong>知识库</strong>
      </div>
      <button
        type="button"
        class="icon-button"
        title="重新扫描"
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
          <img v-if="item.icon?.src" :src="item.icon.src" alt="" />
          <span v-else>{{ item.displayName.slice(0, 1).toUpperCase() }}</span>
        </span>
        <span class="knowledge-copy">
          <strong>{{ item.displayName }}</strong>
          <small>{{ item.name }}</small>
        </span>
        <span class="knowledge-state">
          <small v-if="store.gitStates[item.id]?.behind" class="behind" title="本地落后于远端">
            ↓{{ store.gitStates[item.id].behind }}
          </small>
          <span
            class="knowledge-badge"
            :class="{
              danger: item.health !== 'ready' || store.gitStates[item.id]?.conflict,
              changed: Boolean(store.gitStates[item.id]?.changes.length)
            }"
            :title="
              item.health === 'ready'
                ? `${store.gitStates[item.id]?.changes.length ?? 0} 个变更文件`
                : item.diagnostics.map((diagnostic) => diagnostic.message).join('\n')
            "
          >
            {{ item.health === 'ready' ? (store.gitStates[item.id]?.changes.length ?? 0) : '!' }}
          </span>
        </span>
      </button>
    </div>
    <div v-else class="column-empty">
      <strong>没有扫描到知识库</strong>
      <span>工作区的直接子目录中需要存在 TNotes.*</span>
    </div>

    <footer class="workspace-footer" :title="store.overview.path ?? ''">
      <span>{{ store.overview.path ?? '尚未选择工作区' }}</span>
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
  height: 64px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 9px 14px;
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

.eyebrow {
  color: var(--muted);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.knowledge-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 7px;
}

.knowledge-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text);
  padding: 7px;
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
  width: 28px;
  height: 28px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 7px;
  overflow: hidden;
  background: var(--raised);
  color: var(--accent);
  font-size: 12px;
  font-weight: 700;
}

.knowledge-icon img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.knowledge-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.knowledge-copy strong,
.knowledge-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-copy strong {
  font-size: 12.5px;
  font-weight: 600;
}

.knowledge-copy small {
  color: var(--muted);
  font-size: 10px;
}

.knowledge-badge {
  min-width: 19px;
  height: 19px;
  padding: 0 5px;
  border-radius: 9px;
  display: inline-grid;
  place-items: center;
  background: var(--raised);
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
}

.knowledge-state {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
}

.knowledge-state .behind {
  color: var(--warning);
  font-size: 9px;
  font-weight: 700;
}

.knowledge-badge.changed {
  background: var(--warning-soft);
  color: var(--warning);
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
