<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'

import {
  clampAppZoom,
  APP_ZOOM_MAX,
  APP_ZOOM_MIN,
  APP_ZOOM_STEP,
  parseAppZoomInput
} from '../../../../shared/appZoom'

const props = defineProps<{ modelValue: number }>()
const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const input = ref(String(props.modelValue))
let inputDirty = false

function markInputDirty(): void {
  inputDirty = true
}

watch(
  () => props.modelValue,
  (value) => {
    input.value = String(value)
    inputDirty = false
  }
)

function commitInput(): void {
  inputDirty = false
  const value = parseAppZoomInput(input.value)
  input.value = String(value ?? props.modelValue)
  if (value !== null && value !== props.modelValue) emit('update:modelValue', value)
}

function step(direction: -1 | 1): void {
  inputDirty = false
  const value = clampAppZoom(props.modelValue + direction * APP_ZOOM_STEP)
  input.value = String(value)
  if (value !== props.modelValue) emit('update:modelValue', value)
}

onBeforeUnmount(() => {
  // Closing the backdrop on mousedown can remove the input before the browser emits blur.
  if (inputDirty) commitInput()
})
</script>

<template>
  <div class="field">
    <label for="app-zoom-percent">应用缩放</label>
    <div class="app-zoom-control">
      <button
        type="button"
        aria-label="缩小应用"
        :disabled="modelValue <= APP_ZOOM_MIN"
        @click="step(-1)"
      >
        −
      </button>
      <span class="zoom-input">
        <input
          id="app-zoom-percent"
          v-model="input"
          type="text"
          inputmode="decimal"
          autocomplete="off"
          aria-label="应用缩放百分比"
          @input="markInputDirty"
          @blur="commitInput"
          @keydown.enter="($event.target as HTMLInputElement).blur()"
        />
        <span aria-hidden="true">%</span>
      </span>
      <button
        type="button"
        aria-label="放大应用"
        :disabled="modelValue >= APP_ZOOM_MAX"
        @click="step(1)"
      >
        +
      </button>
    </div>
  </div>
</template>

<style scoped>
.field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  color: var(--muted);
  font-size: 10px;
}

.app-zoom-control {
  display: flex;
  height: 32px;
  gap: 5px;
}

.app-zoom-control button,
.zoom-input {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
  color: var(--text);
}

.app-zoom-control button {
  flex: none;
  width: 30px;
  padding: 0;
  cursor: pointer;
  font-size: 16px;
}

.app-zoom-control button:hover:not(:disabled) {
  background: var(--hover);
  border-color: var(--accent);
}

.app-zoom-control button:disabled {
  opacity: 0.4;
  cursor: default;
}

.zoom-input {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding-right: 8px;
}

.zoom-input:focus-within {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.zoom-input input {
  width: 100%;
  min-width: 0;
  height: 100%;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  text-align: center;
  font: inherit;
  font-size: 11px;
}
</style>
