<script setup lang="ts">
import { ref } from 'vue'

withDefaults(
  defineProps<{
    modelValue: string
    disabled?: boolean
    placeholder?: string
  }>(),
  { disabled: false, placeholder: '选择或输入' }
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const open = ref(false)

const emojis = [
  '✅',
  '⏰',
  '✔',
  '☑',
  '✘',
  '❌',
  '⚠',
  '⭐',
  '🔥',
  '📌',
  '📝',
  '🔖',
  '🏁',
  '🎯',
  '💡',
  '🧩',
  '🔗',
  '🔔',
  '💤',
  '🌙',
  '☀',
  '⚡',
  '❄',
  '💧',
  '🟢',
  '🟡',
  '🔴',
  '🔵',
  '⚪',
  '⚫',
  '♻',
  '⏳',
  '⌛',
  '🔥',
  '🎉',
  '🎊',
  '💯',
  '📎',
  '🔍'
].filter((emoji, index, list) => list.indexOf(emoji) === index)

function onInput(event: Event): void {
  const target = event.target as HTMLInputElement
  const value = target.value
  if (value.length > 1) {
    const first = Array.from(value)[0] ?? ''
    target.value = first
    emit('update:modelValue', first)
    return
  }
  emit('update:modelValue', value)
}

function onBlur(event: Event): void {
  const target = event.target as HTMLInputElement
  if (target.value.length > 1) {
    const first = Array.from(target.value)[0] ?? ''
    target.value = first
    emit('update:modelValue', first)
  }
}

function pick(emoji: string): void {
  emit('update:modelValue', emoji)
  open.value = false
}
</script>

<template>
  <div class="emoji-input" :class="{ disabled, 'is-open': open }">
    <input
      :value="modelValue"
      :disabled="disabled"
      :placeholder="placeholder"
      spellcheck="false"
      @input="onInput"
      @blur="onBlur"
    />
    <button
      type="button"
      class="emoji-trigger"
      :disabled="disabled"
      aria-label="选择 emoji"
      @click="open = !open"
    >
      ▾
    </button>
    <div v-if="open && !disabled" class="emoji-popover">
      <button
        v-for="emoji in emojis"
        :key="emoji"
        type="button"
        class="emoji-option"
        @click="pick(emoji)"
      >
        {{ emoji }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.emoji-input {
  position: relative;
  display: flex;
  align-items: center;
  height: 32px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--input-bg);
}

.emoji-input:focus-within {
  border-color: var(--accent);
}

.emoji-input input {
  flex: 1;
  min-width: 0;
  width: auto;
  height: 100% !important;
  border: 0 !important;
  background: transparent !important;
  outline: none;
  color: var(--text);
  padding: 0 8px 0 10px !important;
  font-size: 14px !important;
}

.emoji-trigger {
  flex: none;
  width: 26px;
  height: 100%;
  border: 0;
  border-left: 1px solid var(--border);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: 11px;
}

.emoji-trigger:hover:not(:disabled) {
  color: var(--text);
}

.emoji-input.disabled {
  opacity: 0.45;
}

.emoji-input.disabled .emoji-trigger {
  cursor: default;
}

.emoji-popover {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 4px;
  width: 220px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--raised);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.34);
  padding: 6px;
}

.emoji-option {
  border: 0;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  padding: 4px;
}

.emoji-option:hover {
  background: var(--hover);
}
</style>
