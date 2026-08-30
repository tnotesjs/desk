import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export type RawBlockArrowDirection = 'up' | 'down'
export type RawBlockBoundarySide = 'before' | 'after'

interface RawBlockBoundary {
  position: number
  side: RawBlockBoundarySide
}

interface RawBlockPointerRange {
  from: number
  to: number
}

interface RawBlockPointerAnchor {
  pointerId: number
  position: number
  startX: number
  startY: number
}

const rawBlockBoundaryKey = new PluginKey<RawBlockBoundary | null>('tnotes-raw-block-boundary')
const rawBlockPointerRangeKey = new PluginKey<RawBlockPointerRange | null>(
  'tnotes-raw-block-pointer-range'
)

function isVisibleRawBlock(node: {
  type: { name: string }
  attrs: Record<string, unknown>
}): boolean {
  return node.type.name === 'deskRawBlock' && node.attrs.hidden !== true
}

function needsRangeSelectionSurface(node: {
  type: { name: string }
  attrs: Record<string, unknown>
}): boolean {
  // Every visible atom needs range-selection semantics. A standalone break is
  // still decorated here, but its CSS renders only a short line-start marker
  // instead of the generic full-width raw-block surface.
  return isVisibleRawBlock(node)
}

/**
 * Finds the position of a raw atom immediately above/below a root text block.
 * Restricting this to root text blocks avoids changing list/table navigation.
 */
export function adjacentRawBlockSelectionPosition(
  state: EditorState,
  direction: RawBlockArrowDirection
): number | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const { $head } = selection
  if ($head.depth !== 1 || !$head.parent.isTextblock) return null

  if (direction === 'down') {
    if ($head.parentOffset !== $head.parent.content.size) return null
    const boundary = $head.after(1)
    const next = state.doc.resolve(boundary).nodeAfter
    return next && isVisibleRawBlock(next) ? boundary : null
  }

  if ($head.parentOffset !== 0) return null
  const boundary = $head.before(1)
  const previous = state.doc.resolve(boundary).nodeBefore
  return previous && isVisibleRawBlock(previous) ? boundary - previous.nodeSize : null
}

function selectedRawBlockDecorations(state: EditorState): DecorationSet | null {
  const { selection } = state
  const decorations: Decoration[] = []
  const pointerRange = rawBlockPointerRangeKey.getState(state)
  const range =
    pointerRange ??
    (!selection.empty && !(selection instanceof NodeSelection)
      ? { from: selection.from, to: selection.to }
      : null)
  if (range) {
    state.doc.nodesBetween(range.from, range.to, (node, position) => {
      if (!needsRangeSelectionSurface(node)) return
      if (range.from < position + node.nodeSize && range.to > position) {
        decorations.push(
          Decoration.node(position, position + node.nodeSize, {
            class: 'desk-raw-block--range-selected'
          })
        )
      }
    })
  }

  const boundary = rawBlockBoundaryKey.getState(state)
  const boundaryNode = boundary ? state.doc.nodeAt(boundary.position) : null
  if (
    !pointerRange &&
    boundary &&
    boundaryNode &&
    isVisibleRawBlock(boundaryNode) &&
    selection instanceof NodeSelection &&
    selection.from === boundary.position
  ) {
    const cursorPosition =
      boundary.side === 'before' ? boundary.position : boundary.position + boundaryNode.nodeSize
    decorations.push(
      Decoration.node(boundary.position, boundary.position + boundaryNode.nodeSize, {
        class: 'desk-raw-block--boundary-active'
      }),
      Decoration.widget(
        cursorPosition,
        () => {
          const cursor = document.createElement('span')
          cursor.className = 'desk-raw-boundary-cursor'
          cursor.dataset.side = boundary.side
          cursor.contentEditable = 'false'
          return cursor
        },
        {
          key: `raw-boundary-${boundary.position}-${boundary.side}`,
          side: boundary.side === 'before' ? -1 : 1
        }
      )
    )
  } else if (
    !pointerRange &&
    selection instanceof NodeSelection &&
    selection.node.type.name === 'deskRawBlock' &&
    selection.node.attrs.kind === 'raw-break'
  ) {
    // Keep the empty-line caret derived from the authoritative editor state.
    // A NodeView's `ProseMirror-selectednode` DOM class is an imperative hook
    // and can briefly outlive its selection while views are remounted/HMR'd;
    // using that class to paint a pseudo-element can therefore leave more than
    // one visible caret. A DecorationSet can contain exactly one widget for the
    // current NodeSelection and is replaced atomically with every transaction.
    decorations.push(
      Decoration.widget(
        selection.from,
        () => {
          const cursor = document.createElement('span')
          cursor.className = 'desk-raw-selection-cursor'
          cursor.contentEditable = 'false'
          return cursor
        },
        {
          key: `raw-selection-${selection.from}`,
          side: -1
        }
      )
    )
  }
  return decorations.length ? DecorationSet.create(state.doc, decorations) : null
}

function rawBreakPositionFromTarget(view: EditorView, target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null
  const element = target.closest<HTMLElement>('[data-kind="raw-break"]')
  if (!element || !view.dom.contains(element)) return null
  try {
    const position = view.posAtDOM(element, 0)
    const node = view.state.doc.nodeAt(position)
    return node?.type.name === 'deskRawBlock' && node.attrs.kind === 'raw-break' ? position : null
  } catch {
    return null
  }
}

function pointerRangeBetween(
  state: EditorState,
  anchorPosition: number,
  headPosition: number
): RawBlockPointerRange | null {
  const anchorNode = state.doc.nodeAt(anchorPosition)
  const headNode = state.doc.nodeAt(headPosition)
  if (!anchorNode || !headNode) return null
  const from = Math.min(anchorPosition, headPosition)
  const to =
    anchorPosition <= headPosition
      ? headPosition + headNode.nodeSize
      : anchorPosition + anchorNode.nodeSize
  return from < to ? { from, to } : null
}

function setRawBlockBoundary(
  view: EditorView,
  position: number,
  side: RawBlockBoundarySide
): boolean {
  const node = view.state.doc.nodeAt(position)
  if (!node || !isVisibleRawBlock(node)) return false
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .setMeta(rawBlockBoundaryKey, { position, side } satisfies RawBlockBoundary)
      .scrollIntoView()
  )
  view.focus()
  return true
}

export interface RawBlockBoundaryControlsOptions {
  dom: HTMLElement
  view: EditorView
  getPos: () => number | undefined
}

/** Adds slim mouse hit areas without changing the atom's document size. */
export function attachRawBlockBoundaryControls(
  options: RawBlockBoundaryControlsOptions
): () => void {
  const controls = (['before', 'after'] as const).map((side) => {
    const control = document.createElement('span')
    control.className = 'desk-raw-block__boundary-hit'
    control.dataset.side = side
    control.contentEditable = 'false'
    control.setAttribute('aria-label', side === 'before' ? '光标置于块前' : '光标置于块后')
    const select = (event: PointerEvent): void => {
      if (!options.view.editable) return
      const position = options.getPos()
      if (position == null) return
      event.preventDefault()
      event.stopPropagation()
      setRawBlockBoundary(options.view, position, side)
    }
    control.addEventListener('pointerdown', select)
    options.dom.append(control)
    return { control, select }
  })
  return () => {
    controls.forEach(({ control, select }) => {
      control.removeEventListener('pointerdown', select)
      control.remove()
    })
  }
}

/** Clears raw-atom selection state when the editor crosses into readonly mode. */
export function clearRawBlockSelectionState(view: EditorView): void {
  const { selection } = view.state
  const transaction = view.state.tr.setMeta(rawBlockBoundaryKey, null)
  if (selection instanceof NodeSelection && isVisibleRawBlock(selection.node)) {
    transaction.setSelection(
      TextSelection.near(
        transaction.doc.resolve(Math.min(selection.from, transaction.doc.content.size)),
        1
      )
    )
  }
  view.dispatch(transaction)
}

function clearBoundarySelection(view: EditorView, position: number, bias: number): void {
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.near(view.state.doc.resolve(position), bias))
      .setMeta(rawBlockBoundaryKey, null)
      .scrollIntoView()
  )
}

function handleActiveBoundary(view: EditorView, event: KeyboardEvent): boolean {
  const boundary = rawBlockBoundaryKey.getState(view.state)
  if (!boundary) return false
  const node = view.state.doc.nodeAt(boundary.position)
  if (!node || !isVisibleRawBlock(node)) return false
  const end = boundary.position + node.nodeSize

  if (
    (boundary.side === 'before' && event.key === 'Delete') ||
    (boundary.side === 'after' && event.key === 'Backspace')
  ) {
    const tr = view.state.tr.delete(boundary.position, end)
    tr.setSelection(
      TextSelection.near(tr.doc.resolve(Math.min(boundary.position, tr.doc.content.size)), -1)
    )
    view.dispatch(tr.setMeta(rawBlockBoundaryKey, null).scrollIntoView())
    return true
  }

  if (boundary.side === 'before') {
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      return setRawBlockBoundary(view, boundary.position, 'after')
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      clearBoundarySelection(view, boundary.position, -1)
      return true
    }
  } else {
    if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
      return setRawBlockBoundary(view, boundary.position, 'before')
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
      clearBoundarySelection(view, end, 1)
      return true
    }
  }
  return false
}

/** A blank raw-break has no visible child content, so own its delete keys. */
function handleSelectedRawBreak(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return false
  const { selection } = view.state
  if (!(selection instanceof NodeSelection)) return false
  if (selection.node.type.name !== 'deskRawBlock' || selection.node.attrs.kind !== 'raw-break') {
    return false
  }

  const deletionPosition = selection.from
  const tr = view.state.tr.delete(selection.from, selection.to)
  tr.setSelection(
    TextSelection.near(
      tr.doc.resolve(Math.min(deletionPosition, tr.doc.content.size)),
      event.key === 'Backspace' ? -1 : 1
    )
  )
  view.dispatch(tr.setMeta(rawBlockBoundaryKey, null).scrollIntoView())
  return true
}

function handlePointerRangeDeletion(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return false
  const range = rawBlockPointerRangeKey.getState(view.state)
  if (!range) return false
  const transaction = view.state.tr.delete(range.from, range.to)
  transaction.setSelection(
    TextSelection.near(
      transaction.doc.resolve(Math.min(range.from, transaction.doc.content.size)),
      event.key === 'Backspace' ? -1 : 1
    )
  )
  view.dispatch(
    transaction
      .setMeta(rawBlockPointerRangeKey, null)
      .setMeta(rawBlockBoundaryKey, null)
      .scrollIntoView()
  )
  return true
}

/** Keyboard and visual selection semantics for selectable raw block atoms. */
export function createRawBlockSelectionPlugin(): MilkdownPlugin[] {
  let pointerAnchor: RawBlockPointerAnchor | null = null
  const selectionPlugin = $prose(
    () =>
      new Plugin<RawBlockBoundary | null>({
        key: rawBlockBoundaryKey,
        state: {
          init: () => null,
          apply: (transaction, value) => {
            const meta = transaction.getMeta(rawBlockBoundaryKey) as
              RawBlockBoundary | null | undefined
            if (meta !== undefined) return meta
            if (transaction.docChanged || transaction.selectionSet) return null
            return value
          }
        },
        props: {
          decorations: selectedRawBlockDecorations,
          handleKeyDown: (view, event) => {
            if (!view.editable) return false
            const target = event.target as Element | null
            if (target?.closest('.cm-editor')) return false
            if (
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.isComposing &&
              (handlePointerRangeDeletion(view, event) ||
                handleActiveBoundary(view, event) ||
                handleSelectedRawBreak(view, event))
            ) {
              return true
            }

            if (
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.isComposing &&
              ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)
            ) {
              const down = event.key === 'ArrowDown' || event.key === 'ArrowRight'
              const position = adjacentRawBlockSelectionPosition(view.state, down ? 'down' : 'up')
              if (position != null) {
                return setRawBlockBoundary(view, position, down ? 'before' : 'after')
              }
            }

            if (
              !event.shiftKey ||
              event.altKey ||
              event.ctrlKey ||
              event.metaKey ||
              event.isComposing ||
              (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')
            ) {
              return false
            }
            const position = adjacentRawBlockSelectionPosition(
              view.state,
              event.key === 'ArrowDown' ? 'down' : 'up'
            )
            if (position == null) return false
            view.dispatch(
              view.state.tr
                .setSelection(NodeSelection.create(view.state.doc, position))
                .scrollIntoView()
            )
            return true
          }
        }
      })
  )

  const pointerRangePlugin = $prose(
    () =>
      new Plugin<RawBlockPointerRange | null>({
        key: rawBlockPointerRangeKey,
        state: {
          init: () => null,
          apply: (transaction, value) => {
            const meta = transaction.getMeta(rawBlockPointerRangeKey) as
              RawBlockPointerRange | null | undefined
            if (meta !== undefined) return meta
            if (transaction.docChanged || transaction.selectionSet) return null
            return value
          }
        },
        props: {
          handleDOMEvents: {
            pointerdown: (view, event) => {
              if (!view.editable || event.button !== 0) return false
              const position = rawBreakPositionFromTarget(view, event.target)
              if (position == null) return false
              pointerAnchor = {
                pointerId: event.pointerId,
                position,
                startX: event.clientX,
                startY: event.clientY
              }
              view.dispatch(
                view.state.tr
                  .setSelection(NodeSelection.create(view.state.doc, position))
                  .setMeta(rawBlockPointerRangeKey, null)
                  .setMeta(rawBlockBoundaryKey, null)
              )
              view.focus()
              event.preventDefault()
              return true
            }
          }
        },
        view: (view) => {
          const ownerDocument = view.dom.ownerDocument
          const move = (event: PointerEvent): void => {
            if (!pointerAnchor || event.pointerId !== pointerAnchor.pointerId) return
            if ((event.buttons & 1) === 0) {
              pointerAnchor = null
              return
            }
            const moved =
              Math.abs(event.clientX - pointerAnchor.startX) >= 3 ||
              Math.abs(event.clientY - pointerAnchor.startY) >= 3
            if (!moved) return
            const target = ownerDocument.elementFromPoint(event.clientX, event.clientY)
            const headPosition = rawBreakPositionFromTarget(view, target)
            if (headPosition == null) return
            const range = pointerRangeBetween(view.state, pointerAnchor.position, headPosition)
            if (!range) return
            const current = rawBlockPointerRangeKey.getState(view.state)
            if (current?.from === range.from && current.to === range.to) return
            view.dispatch(
              view.state.tr
                .setMeta(rawBlockPointerRangeKey, range)
                .setMeta(rawBlockBoundaryKey, null)
            )
          }
          const finish = (event: PointerEvent): void => {
            if (pointerAnchor && event.pointerId === pointerAnchor.pointerId) pointerAnchor = null
          }
          ownerDocument.addEventListener('pointermove', move, true)
          ownerDocument.addEventListener('pointerup', finish, true)
          ownerDocument.addEventListener('pointercancel', finish, true)
          return {
            destroy: () => {
              pointerAnchor = null
              ownerDocument.removeEventListener('pointermove', move, true)
              ownerDocument.removeEventListener('pointerup', finish, true)
              ownerDocument.removeEventListener('pointercancel', finish, true)
            }
          }
        }
      })
  )

  return [selectionPlugin, pointerRangePlugin]
}
