import {
  NodeSelection,
  TextSelection,
  type EditorState,
  type Transaction
} from '@milkdown/kit/prose/state'
import { Fragment, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model'
import type { EditorView } from '@milkdown/kit/prose/view'

/** Generated navigation and level-one titles have no block editing controls. */
export function canShowBlockHandle(node: ProseMirrorNode): boolean {
  if (node.type.name === 'heading' && node.attrs.level === 1) return false
  return !(
    node.type.name === 'deskRawBlock' &&
    ['raw-generated-title', 'raw-generated-toc'].includes(node.attrs.kind)
  )
}

export interface BlockHandleClickTarget {
  dom: HTMLElement
  position: number
  handleRect: DOMRect
}

function isBlockMenuTarget(node: ProseMirrorNode): boolean {
  return node.isBlock && node.attrs.hidden !== true && canShowBlockHandle(node)
}

/** Resolve the same DOM block after edits have shifted its document position. */
export function resolveBlockActionTarget(
  view: EditorView,
  target: Pick<BlockHandleClickTarget, 'dom' | 'position'>
): { position: number; node: ProseMirrorNode; dom: HTMLElement } | null {
  if (!view.dom.contains(target.dom)) return null
  let position = target.position
  if (
    position < 0 ||
    position > view.state.doc.content.size ||
    view.nodeDOM(position) !== target.dom
  ) {
    position = -1
    view.state.doc.descendants((node, candidate) => {
      if (position >= 0) return false
      if (node.isBlock && view.nodeDOM(candidate) === target.dom) position = candidate
      return position < 0
    })
  }
  const node = position >= 0 ? view.state.doc.nodeAt(position) : null
  return node && isBlockMenuTarget(node) ? { position, node, dom: target.dom } : null
}

export function serializeBlockForClipboard(
  state: EditorState,
  position: number,
  serialize: (document: ProseMirrorNode) => string
): string | null {
  const node = state.doc.nodeAt(position)
  if (!node || !isBlockMenuTarget(node)) return null
  if (node.type.name === 'deskRawBlock') return String(node.attrs.source ?? '')

  // A list item cannot be serialized at the document root: retain its list
  // type (including task state / ordered numbering) without copying siblings.
  let content = Fragment.from(node)
  const $pos = state.doc.resolve(position)
  for (let depth = $pos.depth; !state.doc.type.validContent(content) && depth > 0; depth -= 1) {
    const parent = $pos.node(depth)
    const attrs =
      parent.type.name === 'ordered_list'
        ? { ...parent.attrs, order: parent.attrs.order + $pos.index(depth) }
        : parent.attrs
    content = Fragment.from(parent.type.create(attrs, content))
  }
  return serialize(state.doc.type.create(state.doc.attrs, content))
}

export function createBlockDeleteTransaction(
  state: EditorState,
  position: number
): Transaction | null {
  const node = state.doc.nodeAt(position)
  if (!node || !isBlockMenuTarget(node)) return null
  let from = position
  let to = position + node.nodeSize
  const $pos = state.doc.resolve(position)
  // Deleting a list's last item should remove its now-empty list, not let
  // ProseMirror synthesize a replacement empty item to satisfy listItem+.
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const parent = $pos.node(depth)
    if (parent.childCount !== 1 || parent.type.validContent(Fragment.empty)) break
    from = $pos.before(depth)
    to = $pos.after(depth)
  }
  const transaction = state.tr.delete(from, to)
  transaction.setSelection(
    TextSelection.near(transaction.doc.resolve(Math.min(from, transaction.doc.content.size)), -1)
  )
  return transaction.scrollIntoView()
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
    if (!isBlockMenuTarget(node)) return
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
