<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'

type HeadingLevel = 0 | 2 | 3 | 4 | 5 | 6

const props = defineProps<{
  level: number | null
  disabled: boolean
  active: boolean
  platform: string
}>()
const emit = defineEmits<{ select: [level: HeadingLevel] }>()
const levels: HeadingLevel[] = [0, 2, 3, 4, 5, 6]
const menuId = useId()
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)
let openedBy: 'hover' | 'interaction' = 'hover'
let closeTimer: ReturnType<typeof setTimeout> | null = null
const position = ref({ left: '0px', top: '0px', maxHeight: '320px' })
const shortcut = computed(() => (props.platform === 'darwin' ? '⌥ ⌘' : 'Alt Ctrl'))
const label = computed(() =>
  props.level === 0
    ? '正文'
    : levels.includes(props.level as HeadingLevel)
      ? `H${props.level}`
      : '标题'
)

function close(restoreFocus = false): void {
  cancelClose()
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function cancelClose(): void {
  if (closeTimer !== null) clearTimeout(closeTimer)
  closeTimer = null
}

function scheduleClose(): void {
  if (openedBy !== 'hover') return
  cancelClose()
  // Bridge the gap between the trigger and its teleported dropdown.
  closeTimer = setTimeout(() => close(), 200)
}

function focusAt(index: number): void {
  menu.value?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus()
}

async function show(focusMenu = false): Promise<void> {
  cancelClose()
  if (props.disabled || !trigger.value) return
  if (focusMenu) openedBy = 'interaction'
  else if (!open.value) openedBy = 'hover'
  if (open.value) {
    if (focusMenu) focusAt(Math.max(0, levels.indexOf(props.level as HeadingLevel)))
    return
  }
  const rect = trigger.value.getBoundingClientRect()
  position.value = {
    left: `${Math.max(8, Math.min(rect.right - 232, window.innerWidth - 240))}px`,
    top: `${rect.bottom + 6}px`,
    maxHeight: `${Math.max(0, window.innerHeight - rect.bottom - 14)}px`
  }
  open.value = true
  await nextTick()
  if (open.value && focusMenu) focusAt(Math.max(0, levels.indexOf(props.level as HeadingLevel)))
}

function onTriggerClick(): void {
  if (open.value && openedBy === 'interaction') close(true)
  else void show(true)
}

function select(level: HeadingLevel): void {
  close()
  emit('select', level)
}

function onKeydown(event: KeyboardEvent): void {
  const buttons = [...(menu.value?.querySelectorAll('button') ?? [])]
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(true)
  } else if (event.key === 'Tab') {
    close(true)
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault()
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? levels.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + levels.length) % levels.length
    focusAt(index)
  }
}

function onOutside(event: Event): void {
  const target = event.target as Node | null
  if (!menu.value?.contains(target) && !trigger.value?.contains(target)) close()
}

function onDocumentKeydown(event: KeyboardEvent): void {
  if (!open.value) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close(openedBy === 'interaction')
  } else if (openedBy === 'hover') {
    onOutside(event)
  }
}

function onViewportChange(event: Event): void {
  if (event.target instanceof Node && menu.value?.contains(event.target)) return
  close()
}

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) close()
  }
)

watch(
  () => props.active,
  (active) => {
    if (!active) close()
  }
)

onMounted(() => {
  document.addEventListener('pointerdown', onOutside, true)
  document.addEventListener('focusin', onOutside)
  document.addEventListener('keydown', onDocumentKeydown, true)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
  window.addEventListener('blur', onViewportChange)
})
onBeforeUnmount(() => {
  cancelClose()
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('focusin', onOutside)
  document.removeEventListener('keydown', onDocumentKeydown, true)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
  window.removeEventListener('blur', onViewportChange)
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="heading-trigger"
    aria-label="标题级别"
    aria-haspopup="menu"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    :disabled="disabled"
    @mousedown.prevent
    @mouseenter="show()"
    @mouseleave="scheduleClose"
    @click="onTriggerClick"
    @keydown.down.prevent="show(true)"
    @keydown.up.prevent="show(true)"
  >
    <span>{{ label }}</span>
    <svg viewBox="0 0 12 12" aria-hidden="true"><path d="m3 4.5 3 3 3-3" /></svg>
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      class="heading-menu"
      role="menu"
      aria-label="标题级别"
      :style="position"
      @mousedown.prevent
      @keydown="onKeydown"
      @mouseenter="cancelClose"
      @mouseleave="scheduleClose"
    >
      <button
        v-for="option in levels"
        :key="option"
        type="button"
        role="menuitemradio"
        :aria-label="option === 0 ? '正文' : `标题 ${option}`"
        :aria-checked="level === option"
        @click="select(option)"
      >
        <span :class="`heading-label level-${option}`">{{
          option === 0 ? '正文' : `标题 ${option}`
        }}</span>
        <kbd>{{ shortcut }} {{ option }}</kbd>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.heading-trigger {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 5px;
  width: 64px;
  height: 32px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted);
  font: 14px var(--font-mono);
  cursor: pointer;
}

.heading-trigger > span {
  width: 32px;
  text-align: center;
}

.heading-trigger:hover {
  background: var(--hover);
  color: var(--text);
}

.heading-trigger svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.3;
}

.heading-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.heading-menu {
  position: fixed;
  z-index: 1000;
  box-sizing: border-box;
  width: 232px;
  max-width: calc(100vw - 16px);
  overflow-y: auto;
  padding: 6px;
  color: var(--text);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgb(0 0 0 / 28%);
}

.heading-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  width: 100%;
  min-height: 40px;
  padding: 7px 10px;
  border: 0;
  border-radius: 5px;
  color: inherit;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.heading-menu button:hover,
.heading-menu button:focus-visible {
  outline: none;
  background: var(--hover);
}

.heading-menu button[aria-checked='true'] {
  color: var(--accent-strong);
}

.heading-label {
  font-family: var(--font-sans);
  font-weight: 600;
  line-height: 1.3;
}

.level-0 {
  font-size: 14px;
  font-weight: 400;
}
.level-2 {
  font-size: 24px;
}
.level-3 {
  font-size: 21px;
}
.level-4 {
  font-size: 18px;
}
.level-5 {
  font-size: 16px;
}
.level-6 {
  font-size: 14px;
}

.heading-menu kbd {
  flex: none;
  font: 11px var(--font-sans);
  color: var(--muted);
}
</style>
