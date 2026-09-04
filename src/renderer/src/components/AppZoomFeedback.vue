<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import { APP_ZOOM_MAX, APP_ZOOM_MIN } from '../../../shared/appZoom'

const props = defineProps<{ percent: number; sequence: number }>()
const emit = defineEmits<{ decrease: []; increase: []; reset: [] }>()
const visible = ref(false)
let hovered = false
let hideTimer: ReturnType<typeof setTimeout> | null = null

function stopTimer(): void {
  if (hideTimer !== null) clearTimeout(hideTimer)
  hideTimer = null
}

function startTimer(): void {
  stopTimer()
  if (hovered) return
  hideTimer = setTimeout(() => {
    hideTimer = null
    visible.value = false
  }, 3000)
}

function enter(): void {
  hovered = true
  stopTimer()
}

function leave(): void {
  hovered = false
  startTimer()
}

watch([() => props.percent, () => props.sequence], () => {
  visible.value = true
  startTimer()
})

onBeforeUnmount(stopTimer)
</script>

<template>
  <div
    v-if="visible"
    class="app-zoom-feedback"
    role="group"
    aria-label="应用缩放"
    @mouseenter="enter"
    @mouseleave="leave"
  >
    <output class="zoom-percentage" aria-live="polite" aria-atomic="true">{{ percent }}%</output>
    <button
      type="button"
      aria-label="缩小应用"
      title="缩小"
      :disabled="percent <= APP_ZOOM_MIN"
      @click="emit('decrease')"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12" /></svg>
    </button>
    <button
      type="button"
      aria-label="放大应用"
      title="放大"
      :disabled="percent >= APP_ZOOM_MAX"
      @click="emit('increase')"
    >
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12M10 4v12" /></svg>
    </button>
    <span class="zoom-divider" aria-hidden="true" />
    <button type="button" class="zoom-reset" aria-label="重置应用缩放" @click="emit('reset')">
      重置
    </button>
  </div>
</template>

<style scoped>
.app-zoom-feedback {
  position: fixed;
  top: 50px;
  right: 16px;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 5px;
  height: 44px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  padding: 0 14px 0 18px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--raised);
  color: var(--text);
  box-shadow: 0 6px 22px rgb(0 0 0 / 12%);
  -webkit-app-region: no-drag;
}

.zoom-percentage {
  min-width: 52px;
  margin-right: 5px;
  font-size: 16px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
}

.app-zoom-feedback button {
  display: grid;
  place-items: center;
  flex: none;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
}

.app-zoom-feedback button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}

.app-zoom-feedback button:disabled {
  opacity: 0.35;
  cursor: default;
}

.app-zoom-feedback svg {
  width: 20px;
  height: 20px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
  stroke-linecap: round;
}

.zoom-divider {
  width: 1px;
  height: 20px;
  margin: 0 6px;
  background: var(--border);
}

.app-zoom-feedback .zoom-reset {
  width: auto;
  padding: 0 7px;
  border-radius: 15px;
  font-size: 14px;
  font-weight: 600;
}
</style>
