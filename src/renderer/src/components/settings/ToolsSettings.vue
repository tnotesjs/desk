<script setup lang="ts">
import { computed } from 'vue'

import { useWorkspaceStore } from '../../stores/workspace'

import type { AppSettings } from '../../../../shared/contracts'

const props = defineProps<{ draft: AppSettings }>()
const emit = defineEmits<{ reset: [] }>()
const store = useWorkspaceStore()

const currentKnowledgeBaseName = computed(() => store.selectedKnowledgeBase?.displayName ?? null)

const autoPushEnabled = computed({
  get: () => {
    const configId = store.selectedKnowledgeBase?.configId
    return configId ? Boolean(props.draft.knowledgeBases[configId]?.autoPush?.enabled) : false
  },
  set: (enabled: boolean) => {
    const configId = store.selectedKnowledgeBase?.configId
    if (!configId) return
    const current = props.draft.knowledgeBases[configId] ?? {}
    props.draft.knowledgeBases[configId] = {
      ...current,
      autoPush: {
        enabled,
        idleMinutes: current.autoPush?.idleMinutes ?? 10
      }
    }
  }
})

const autoPushIdleMinutes = computed({
  get: () => {
    const configId = store.selectedKnowledgeBase?.configId
    return configId ? (props.draft.knowledgeBases[configId]?.autoPush?.idleMinutes ?? 10) : 10
  },
  set: (idleMinutes: number) => {
    const configId = store.selectedKnowledgeBase?.configId
    if (!configId) return
    const current = props.draft.knowledgeBases[configId] ?? {}
    props.draft.knowledgeBases[configId] = {
      ...current,
      autoPush: {
        enabled: current.autoPush?.enabled ?? false,
        idleMinutes
      }
    }
  }
})
</script>

<template>
  <section class="settings-section">
    <header class="section-heading">
      <strong>外部工具</strong>
      <span>冲突处理和右键快捷入口会使用这里的 IDE</span>
    </header>
    <button type="button" class="reset-group" @click="emit('reset')">重置</button>
    <div class="field-grid cols-3">
      <label class="field">
        <span>默认 IDE</span>
        <select v-model="draft.ide">
          <option value="vscode">VSCode</option>
          <option value="cursor">Cursor</option>
        </select>
      </label>
      <label class="field">
        <span>Git 可执行文件（可选）</span>
        <input v-model="draft.gitPath" placeholder="自动检测" />
      </label>
      <label class="field">
        <span>Node 可执行文件（可选）</span>
        <input v-model="draft.nodePath" placeholder="自动检测" />
      </label>
    </div>
    <div class="settings-row">
      <label class="switch-field">
        <input v-model="draft.confirmBeforeCommit" type="checkbox" />
        <span>提交前再次弹窗确认变更</span>
      </label>
    </div>
    <div v-if="currentKnowledgeBaseName" class="knowledge-git-setting">
      <header class="sub-heading">
        <strong>{{ currentKnowledgeBaseName }}</strong>
        <span>空闲后自动提交并推送</span>
      </header>
      <div class="settings-row">
        <label class="switch-field">
          <input v-model="autoPushEnabled" type="checkbox" />
          <span>启用自动推送</span>
        </label>
        <label class="field inline-number">
          <span>连续无内容更新</span>
          <span class="input-with-unit">
            <input v-model.number="autoPushIdleMinutes" type="number" min="1" max="1440" />
            <em>分钟</em>
          </span>
        </label>
      </div>
    </div>
  </section>
</template>

<style src="./settingsShared.css" scoped></style>
