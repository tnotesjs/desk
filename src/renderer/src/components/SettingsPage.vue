<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

const emit = defineEmits<{
  back: []
  saved: []
}>()

const scanned = ref<string[]>([])
const blacklist = ref<string[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref<string | null>(null)
const draftName = ref('')

const blacklistSet = computed(() => new Set(blacklist.value))

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const [settings, all] = await Promise.all([
      window.api.getSettings(),
      window.api.scanKnowledge().catch(() => [] as string[])
    ])
    blacklist.value = [...settings.blacklist]
    scanned.value = all
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggle(repo: string, checked: boolean): void {
  const set = new Set(blacklist.value)
  if (checked) set.add(repo)
  else set.delete(repo)
  blacklist.value = [...set].sort((a, b) => a.localeCompare(b))
}

function addManual(): void {
  const name = draftName.value.trim()
  if (!name) return
  toggle(name, true)
  draftName.value = ''
}

async function save(): Promise<void> {
  saving.value = true
  error.value = null
  try {
    // Electron IPC cannot clone Vue reactive proxies — pass a plain array.
    await window.api.setSettings({ blacklist: [...blacklist.value] })
    emit('saved')
    emit('back')
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <section class="settings">
    <header class="header">
      <button type="button" class="btn" @click="emit('back')">返回</button>
      <h1>配置</h1>
      <button type="button" class="btn primary" :disabled="saving || loading" @click="save">
        保存
      </button>
    </header>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="loading" class="hint">加载中…</div>

    <div v-else class="body">
      <div class="block">
        <h2>黑名单</h2>
        <p class="desc">勾选后，对应知识库不会出现在左侧列表中，也不会参与 Git 状态扫描。</p>

        <ul v-if="scanned.length" class="repo-list">
          <li v-for="repo in scanned" :key="repo">
            <label>
              <input
                type="checkbox"
                :checked="blacklistSet.has(repo)"
                @change="toggle(repo, ($event.target as HTMLInputElement).checked)"
              />
              <span>{{ repo }}</span>
            </label>
          </li>
        </ul>
        <p v-else class="hint">当前没有可选工作区，或尚未扫描到 `TNotes.*` 目录。仍可手动添加黑名单项。</p>

        <div class="manual">
          <input
            v-model="draftName"
            type="text"
            placeholder="手动添加，例如 TNotes.en-words"
            @keydown.enter.prevent="addManual"
          />
          <button type="button" class="btn" @click="addManual">添加</button>
        </div>

        <div v-if="blacklist.length" class="current">
          <div class="current-title">当前黑名单（{{ blacklist.length }}）</div>
          <div class="tags">
            <span v-for="item in blacklist" :key="item" class="tag">
              {{ item }}
              <button type="button" class="x" @click="toggle(item, false)">×</button>
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  background: var(--panel);
}

.header h1 {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.body {
  flex: 1;
  overflow: auto;
  padding: 20px;
}

.block {
  max-width: 720px;
  margin: 0 auto;
}

.block h2 {
  margin: 0 0 8px;
  font-size: 15px;
}

.desc,
.hint {
  margin: 0 0 16px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.error {
  margin: 12px 16px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #3b1515;
  color: #ffb4b4;
  font-size: 13px;
}

.repo-list {
  list-style: none;
  margin: 0 0 16px;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--panel);
}

.repo-list li + li {
  border-top: 1px solid var(--border);
}

.repo-list label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  font-size: 13px;
}

.repo-list label:hover {
  background: var(--hover);
}

.manual {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.manual input {
  flex: 1;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 13px;
}

.current-title {
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 8px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  border-radius: 999px;
  padding: 4px 8px 4px 10px;
  font-size: 12px;
}

.x {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
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

.btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #081018;
  font-weight: 650;
}

.btn:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
