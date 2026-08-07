<script setup lang="ts">
defineProps<{
  path: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  choose: []
  settings: []
}>()
</script>

<template>
  <header class="workspace-bar">
    <div class="brand">TNotes Desk</div>
    <div class="path" :title="path ?? ''">
      <template v-if="path">{{ path }}</template>
      <template v-else>未选择工作区</template>
    </div>
    <button type="button" class="btn" :disabled="loading" @click="emit('choose')">
      {{ path ? '切换工作区' : '选择工作区' }}
    </button>
    <button type="button" class="btn" @click="emit('settings')">配置</button>
  </header>
</template>

<style scoped>
.workspace-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.brand {
  font-weight: 650;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 13px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.btn {
  border: 1px solid var(--border);
  background: var(--bg);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
}

.btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
