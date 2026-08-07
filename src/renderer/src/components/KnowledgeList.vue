<script setup lang="ts">
import { computed } from 'vue'
import type { GitStatus } from '../types'

const props = defineProps<{
  items: string[]
  selected: string | null
  statuses: Record<string, GitStatus>
  gitBusy: boolean
  selectedStatus: GitStatus | null
}>()

const emit = defineEmits<{
  select: [repo: string]
  refresh: []
  pull: []
  push: []
}>()

function badge(status: GitStatus | undefined): { text: string; kind: string; title: string } {
  if (!status) return { text: '…', kind: 'pending', title: '状态加载中' }
  if (status.error) return { text: '!', kind: 'error', title: status.error }
  if (!status.isRepo) return { text: '—', kind: 'none', title: '不是 git 仓库' }

  const parts: string[] = []
  if (status.changed > 0) parts.push(`${status.changed} 改动`)
  if (status.ahead > 0) parts.push(`↑${status.ahead}`)
  if (status.behind > 0) parts.push(`↓${status.behind}`)

  if (parts.length === 0) {
    return {
      text: '✓',
      kind: 'clean',
      title: status.branch ? `${status.branch} · clean` : 'clean'
    }
  }

  const kind = status.changed > 0 ? 'dirty' : 'sync'
  return {
    text: status.changed > 0 ? String(status.changed) : `↑${status.ahead}↓${status.behind}`,
    kind,
    title: [status.branch, ...parts].filter(Boolean).join(' · ')
  }
}

const selectedSummary = computed(() => {
  const s = props.selectedStatus
  if (!s) return '未选择知识库'
  if (s.error) return s.error
  const bits = [s.branch || 'detached']
  if (s.clean) bits.push('clean')
  else bits.push(`${s.changed} 改动`)
  if (s.ahead) bits.push(`ahead ${s.ahead}`)
  if (s.behind) bits.push(`behind ${s.behind}`)
  return bits.join(' · ')
})
</script>

<template>
  <aside class="col">
    <div class="col-title">
      <span>知识库</span>
      <button type="button" class="link" :disabled="gitBusy" @click="emit('refresh')">刷新</button>
    </div>

    <ul v-if="items.length" class="list">
      <li
        v-for="item in items"
        :key="item"
        :class="{ active: item === selected }"
        @click="emit('select', item)"
      >
        <span class="name" :title="item">{{ item.replace(/^TNotes\./, '') }}</span>
        <span
          class="badge"
          :class="badge(statuses[item]).kind"
          :title="badge(statuses[item]).title"
        >
          {{ badge(statuses[item]).text }}
        </span>
      </li>
    </ul>
    <div v-else class="empty">扫描结果为空</div>

    <div class="footer">
      <div class="summary" :title="selectedSummary">{{ selectedSummary }}</div>
      <div class="actions">
        <button type="button" class="btn" :disabled="!selected || gitBusy" @click="emit('pull')">
          Pull
        </button>
        <button type="button" class="btn" :disabled="!selected || gitBusy" @click="emit('push')">
          Push
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.col {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-right: 1px solid var(--border);
  background: var(--panel);
}

.col-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
  border-bottom: 1px solid var(--border);
}

.link {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 600;
  padding: 0;
}

.link:disabled {
  opacity: 0.5;
  cursor: default;
}

.list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow: auto;
  flex: 1;
}

.list li {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  line-height: 1.3;
}

.list li:hover {
  background: var(--hover);
}

.list li.active {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.badge {
  flex: none;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  background: #243041;
  color: var(--muted);
}

.badge.clean {
  background: #1c3a2a;
  color: #8fe0b0;
}

.badge.dirty {
  background: #3a2c14;
  color: #f0c27a;
}

.badge.sync {
  background: #1c2f45;
  color: #8ec5ff;
}

.badge.error {
  background: #3b1515;
  color: #ffb4b4;
}

.badge.pending,
.badge.none {
  background: #243041;
  color: var(--muted);
}

.empty {
  padding: 16px 12px;
  color: var(--muted);
  font-size: 13px;
  flex: 1;
}

.footer {
  border-top: 1px solid var(--border);
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary {
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.actions {
  display: flex;
  gap: 8px;
}

.btn {
  flex: 1;
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
