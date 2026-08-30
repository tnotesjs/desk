import { NodeSelection } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'

export interface BlockHandleClickTarget {
  dom: HTMLElement
  position: number
  handleRect: DOMRect
}

export interface BlockHandleClickControllerOptions {
  root: HTMLElement
  getView: () => EditorView | null
  onClick: (target: BlockHandleClickTarget) => void
}

/**
 * Separates a short six-dot click from native handle dragging. No default is
 * prevented: Milkdown still owns mousedown, dragstart, ghost and drop.
 */
export function installBlockHandleClickController(
  options: BlockHandleClickControllerOptions
): () => void {
  let pointerStart: { x: number; y: number; grip: Element } | null = null
  let dragged = false

  const gripFrom = (target: EventTarget | null): Element | null => {
    const element = target instanceof Element ? target : null
    const item = element?.closest('.milkdown-block-handle .operation-item:last-child') ?? null
    return item && options.root.contains(item) ? item : null
  }

  const onPointerDown = (event: PointerEvent): void => {
    const grip = gripFrom(event.target)
    if (!grip || event.button !== 0) return
    pointerStart = { x: event.clientX, y: event.clientY, grip }
    dragged = false
  }

  const onPointerMove = (event: PointerEvent): void => {
    if (!pointerStart) return
    if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >= 5) {
      dragged = true
    }
  }

  const onDragStart = (): void => {
    dragged = true
  }

  const onPointerUp = (event: PointerEvent): void => {
    const start = pointerStart
    pointerStart = null
    if (!start || dragged || !start.grip.contains(event.target as Node)) return
    const view = options.getView()
    const selection = view?.state.selection
    if (!view || !(selection instanceof NodeSelection)) return
    const node = selection.node
    if (node.type.name !== 'deskRawBlock' || node.attrs.hidden === true) return
    const dom = view.nodeDOM(selection.from)
    if (!(dom instanceof HTMLElement)) return
    const handle = start.grip.closest('.milkdown-block-handle')
    if (!(handle instanceof HTMLElement)) return
    options.onClick({ dom, position: selection.from, handleRect: handle.getBoundingClientRect() })
  }

  options.root.addEventListener('pointerdown', onPointerDown, { capture: true })
  options.root.addEventListener('pointermove', onPointerMove, { capture: true })
  options.root.addEventListener('pointerup', onPointerUp, { capture: true })
  options.root.addEventListener('dragstart', onDragStart, { capture: true })
  return () => {
    options.root.removeEventListener('pointerdown', onPointerDown, { capture: true })
    options.root.removeEventListener('pointermove', onPointerMove, { capture: true })
    options.root.removeEventListener('pointerup', onPointerUp, { capture: true })
    options.root.removeEventListener('dragstart', onDragStart, { capture: true })
  }
}
