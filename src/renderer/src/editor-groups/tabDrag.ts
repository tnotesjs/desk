import { defineStore } from 'pinia'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { SplitPlacement } from './layoutModel'

export const TAB_DRAG_MIME = 'text/x-tnotes-desk-tab'
export type TabDropPlacement = SplitPlacement | 'center'

export function resolveTabDropPlacement(
  bounds: { left: number; top: number; width: number; height: number },
  x: number,
  y: number
): TabDropPlacement | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null
  const horizontal = (x - bounds.left) / bounds.width
  const vertical = (y - bounds.top) / bounds.height
  if (horizontal < 0 || horizontal > 1 || vertical < 0 || vertical > 1) return null
  const edges: [SplitPlacement, number][] = [
    ['left', horizontal],
    ['right', 1 - horizontal],
    ['top', vertical],
    ['bottom', 1 - vertical]
  ]
  const nearest = edges.sort((a, b) => a[1] - b[1])[0]
  return nearest[1] < 0.25 ? nearest[0] : 'center'
}

// One transient drag session across every split group; never persisted.
export const useTabDragStore = defineStore('tab-drag', () => {
  const tabId = ref<string | null>(null)
  const target = ref<{ groupId: string; placement: TabDropPlacement } | null>(null)
  function start(id: string): void {
    target.value = null
    tabId.value = id
  }
  function finish(): void {
    target.value = null
    tabId.value = null
  }
  return { tabId, target, start, finish }
})

/** Mounted once by the workspace, so source/target unmounts cannot strand a hint. */
export function useTabDragLifecycle(): void {
  const drag = useTabDragStore()
  let dropTimer: ReturnType<typeof setTimeout> | null = null
  const finish = (): void => {
    if (dropTimer) clearTimeout(dropTimer)
    dropTimer = null
    drag.finish()
  }
  const afterDrop = (): void => {
    // Capture even if an editor stops propagation, but let its target consume
    // the current drag before releasing the session.
    // Native DOM events may run a microtask checkpoint between listeners.
    // Use the next task, not a microtask, or capture clears the source before
    // the group's drop handler can consume it.
    if (dropTimer) clearTimeout(dropTimer)
    dropTimer = setTimeout(finish, 0)
  }
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') finish()
  }
  const onPointerMove = (event: PointerEvent): void => {
    if (event.buttons === 0) finish()
  }
  const onDragOver = (event: DragEvent): void => {
    if (!(event.target instanceof Element) || !event.target.closest('.editor-group')) {
      drag.target = null
    }
  }
  const onVisibility = (): void => {
    if (document.hidden) finish()
  }
  onMounted(() => {
    window.addEventListener('dragend', finish, true)
    window.addEventListener('drop', afterDrop, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('keydown', onKeydown, true)
    window.addEventListener('pointerup', finish, true)
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('blur', finish)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('dragend', finish, true)
    window.removeEventListener('drop', afterDrop, true)
    window.removeEventListener('dragover', onDragOver, true)
    window.removeEventListener('keydown', onKeydown, true)
    window.removeEventListener('pointerup', finish, true)
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('blur', finish)
    document.removeEventListener('visibilitychange', onVisibility)
    finish()
  })
}
