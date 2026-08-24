<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useEditorStore } from '../stores/editor'

import type { DeskResult, WebEditorTab, WebTabState } from '../../../shared/contracts'

const props = defineProps<{ tab: WebEditorTab; active: boolean }>()
const editor = useEditorStore()
const address = ref(props.tab.url)
const viewport = ref<HTMLElement | null>(null)
const ready = ref(false)
const error = ref<string | null>(null)
let resizeObserver: ResizeObserver | null = null

const state = computed(() => editor.webStates[props.tab.id] ?? null)

watch(
  () => state.value?.url,
  (url) => {
    if (url) address.value = url
  }
)

function value<T>(result: DeskResult<T>): T {
  if (result.ok) return result.value
  throw new Error(result.error.message)
}

function applyState(next: WebTabState): void {
  editor.webStates = { ...editor.webStates, [next.tabId]: next }
  address.value = next.url
}

async function updateLayout(): Promise<void> {
  if (!ready.value || !viewport.value) return
  const rect = viewport.value.getBoundingClientRect()
  await window.desk.web.layout({
    tabId: props.tab.id,
    visible: props.active && rect.width > 0 && rect.height > 0,
    bounds: { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
  })
}

async function createView(): Promise<void> {
  error.value = null
  try {
    applyState(value(await window.desk.web.create({ tabId: props.tab.id, url: props.tab.url })))
    ready.value = true
    await nextTick()
    await updateLayout()
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

async function navigate(): Promise<void> {
  error.value = null
  try {
    applyState(value(await window.desk.web.navigate({ tabId: props.tab.id, url: address.value })))
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
}

function goBack(): void {
  void window.desk.web.goBack(props.tab.id)
}

function goForward(): void {
  void window.desk.web.goForward(props.tab.id)
}

function stop(): void {
  void window.desk.web.stop(props.tab.id)
}

function reload(): void {
  void window.desk.web.reload(props.tab.id)
}

function openExternal(): void {
  void window.desk.web.openExternal(state.value?.url ?? address.value)
}

function onWindowResize(): void {
  void updateLayout()
}

watch(
  () => props.active,
  async (active) => {
    if (active && !ready.value) {
      await createView()
      return
    }
    await nextTick()
    await updateLayout()
  }
)

onMounted(() => {
  resizeObserver = new ResizeObserver(() => void updateLayout())
  if (viewport.value) resizeObserver.observe(viewport.value)
  window.addEventListener('resize', onWindowResize)
  if (props.active) void createView()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', onWindowResize)
  if (ready.value) void window.desk.web.layout({ tabId: props.tab.id, visible: false })
})
</script>

<template>
  <div class="web-pane">
    <form class="browser-toolbar" @submit.prevent="navigate">
      <button
        type="button"
        aria-label="后退"
        data-tooltip="后退"
        :disabled="!state?.canGoBack"
        @click="goBack"
      >
        ←
      </button>
      <button
        type="button"
        aria-label="前进"
        data-tooltip="前进"
        :disabled="!state?.canGoForward"
        @click="goForward"
      >
        →
      </button>
      <button
        v-if="state?.loading"
        type="button"
        aria-label="停止加载"
        data-tooltip="停止加载"
        @click="stop"
      >
        ×
      </button>
      <button v-else type="button" aria-label="刷新网页" data-tooltip="刷新网页" @click="reload">
        ↻
      </button>
      <input v-model="address" aria-label="网页地址" spellcheck="false" />
      <button type="submit" aria-label="打开地址" data-tooltip="打开地址">前往</button>
      <button
        type="button"
        aria-label="使用系统浏览器打开"
        data-tooltip="使用系统浏览器打开"
        @click="openExternal"
      >
        ↗
      </button>
    </form>
    <div v-if="error || state?.error" class="web-error">
      {{ error ?? state?.error }}
    </div>
    <div ref="viewport" class="web-viewport">
      <span v-if="!ready">正在创建安全网页视图…</span>
    </div>
  </div>
</template>

<style scoped>
.web-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--editor-bg);
}

.browser-toolbar {
  height: 40px;
  flex: none;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 8px;
  border-bottom: 1px solid var(--border);
  background: var(--raised);
}

.browser-toolbar button {
  height: 26px;
  min-width: 27px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
}

.browser-toolbar button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.browser-toolbar button:disabled {
  opacity: 0.35;
}

.browser-toolbar input {
  min-width: 80px;
  height: 27px;
  flex: 1;
  border: 1px solid var(--border);
  border-radius: 6px;
  outline: none;
  background: var(--input-bg);
  color: var(--text);
  padding: 0 9px;
  font-size: 10px;
}

.browser-toolbar input:focus {
  border-color: var(--accent);
}

.web-error {
  min-height: 30px;
  flex: none;
  padding: 7px 10px;
  border-bottom: 1px solid var(--border);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 9px;
}

.web-viewport {
  flex: 1;
  min-height: 0;
  position: relative;
  display: grid;
  place-items: center;
  background: #fff;
  color: #68707d;
  font-size: 10px;
}
</style>
