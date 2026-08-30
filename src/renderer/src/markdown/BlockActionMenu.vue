<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

export type BlockAction = 'delete' | 'copy' | 'cut' | 'add-below'

const props = defineProps<{
  x: number
  y: number
}>()

const emit = defineEmits<{
  action: [action: BlockAction]
  addBelow: []
  close: []
}>()

const root = ref<HTMLElement | null>(null)
const focusedIndex = ref(0)

const actionable = (): HTMLButtonElement[] => [
  ...(root.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
]

function focusAt(index: number): void {
  const buttons = actionable()
  if (!buttons.length) return
  focusedIndex.value = Math.max(0, Math.min(index, buttons.length - 1))
  buttons[focusedIndex.value]?.focus()
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    focusAt((focusedIndex.value + 1) % actionable().length)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    const buttons = actionable()
    focusAt((focusedIndex.value - 1 + buttons.length) % buttons.length)
    return
  }
  if (event.key === 'ArrowRight' && document.activeElement?.matches('[data-add-below]')) {
    event.preventDefault()
    emit('addBelow')
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown, { capture: true })
  void nextTick(() => focusAt(0))
})

onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown, { capture: true }))
</script>

<template>
  <div
    ref="root"
    class="desk-block-action-menu"
    role="menu"
    aria-label="块操作"
    :style="{ left: `${props.x}px`, top: `${props.y}px` }"
    @pointerdown.stop
  >
    <div class="desk-block-action-menu__group">
      <button type="button" role="menuitem" @click="emit('action', 'delete')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"
          />
        </svg>
        <span>删除</span>
      </button>
      <button type="button" role="menuitem" @click="emit('action', 'copy')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M8 3h10a3 3 0 0 1 3 3v10h-2V6a1 1 0 0 0-1-1H8V3Zm-2 4h9a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H6Z"
          />
        </svg>
        <span>复制</span>
      </button>
      <button type="button" role="menuitem" @click="emit('action', 'cut')">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M8.2 3a4 4 0 1 1-2.8 6.8L10.6 15l-1.4 1.4L4 11.2A4 4 0 0 1 8.2 3Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm7.6-2a4 4 0 0 1 2.8 6.8l-4.1 4.1-1.4-1.4 3.9-3.9A2 2 0 1 0 15.8 5a2 2 0 0 0-1.4.6L5.6 14.4 4.2 13l8.8-8.8A4 4 0 0 1 15.8 3ZM12 15.6l7 7h-2.8l-5.6-5.6 1.4-1.4Z"
          />
        </svg>
        <span>剪切</span>
      </button>
    </div>

    <div class="desk-block-action-menu__group">
      <button
        type="button"
        role="menuitem"
        data-add-below
        @mouseenter="emit('addBelow')"
        @focus="emit('addBelow')"
        @click="emit('action', 'add-below')"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z" />
        </svg>
        <span>在下方添加</span><span class="desk-block-action-menu__arrow">›</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.desk-block-action-menu {
  position: fixed;
  z-index: 80;
  box-sizing: border-box;
  width: 224px;
  padding: 6px;
  color: var(--editor-text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--crepe-shadow-2, 0 10px 28px rgba(0, 0, 0, 0.28));
}

.desk-block-action-menu__group {
  padding: 4px 0;
}

.desk-block-action-menu__group + .desk-block-action-menu__group {
  border-top: 1px solid var(--border);
}

button {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 34px;
  padding: 6px 9px;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  background: transparent;
  border: 0;
  border-radius: 6px;
  cursor: pointer;
}

button:hover,
button:focus-visible {
  outline: none;
  background: var(--hover);
}

button:disabled {
  color: var(--muted);
  cursor: not-allowed;
  opacity: 0.6;
}

svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
  color: var(--text);
}

.desk-block-action-menu__arrow {
  color: var(--muted);
  font-size: 11px;
}

.desk-block-action-menu__arrow {
  font-size: 20px;
  line-height: 1;
}
</style>
