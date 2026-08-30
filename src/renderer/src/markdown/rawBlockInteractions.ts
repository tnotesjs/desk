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

interface RawBlockOwnedRange {
  from: number
  to: number
}

type RawBlockKeyboardAnchor =
  { kind: 'text'; position: number } | { kind: 'node'; position: number }

interface RawBlockKeyboardRange extends RawBlockOwnedRange {
  anchor: RawBlockKeyboardAnchor
  direction: RawBlockArrowDirection
  headPosition: number
  positions: number[]
}

const rawBlockBoundaryKey = new PluginKey<RawBlockBoundary | null>('tnotes-raw-block-boundary')
const rawBlockKeyboardRangeKey = new PluginKey<RawBlockKeyboardRange | null>(
  'tnotes-raw-block-keyboard-range'
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
  return isVisibleRawBlock(node)
}

/**
 * Finds the position of a raw atom immediately above/below the caret's top-level
 * block. Nested list/table carets only match when the caret is already at that
 * top-level block's outer edge, so intra-list arrow movement stays with PM.
 */
export function adjacentRawBlockSelectionPosition(
  state: EditorState,
  direction: RawBlockArrowDirection
): number | null {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const { $head } = selection
  if ($head.depth < 1 || !$head.parent.isTextblock) return null

  if (direction === 'down') {
    if ($head.parentOffset !== $head.parent.content.size) return null
    for (let depth = $head.depth; depth > 1; depth -= 1) {
      if ($head.index(depth - 1) < $head.node(depth - 1).childCount - 1) return null
    }
    const boundary = $head.after(1)
    const next = state.doc.resolve(boundary).nodeAfter
    return next && isVisibleRawBlock(next) ? boundary : null
  }

  if ($head.parentOffset !== 0) return null
  for (let depth = $head.depth; depth > 1; depth -= 1) {
    if ($head.index(depth - 1) > 0) return null
  }
  const boundary = $head.before(1)
  const previous = state.doc.resolve(boundary).nodeBefore
  return previous && isVisibleRawBlock(previous) ? boundary - previous.nodeSize : null
}

function selectedRawBlockDecorations(state: EditorState): DecorationSet | null {
  const { selection } = state
  const decorations: Decoration[] = []
  const keyboardRange = rawBlockKeyboardRangeKey.getState(state)
  const range =
    keyboardRange ??
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
    !keyboardRange &&
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
  }
  return decorations.length ? DecorationSet.create(state.doc, decorations) : null
}

function adjacentVisibleRawBlockPosition(
  state: EditorState,
  position: number,
  direction: RawBlockArrowDirection
): number | null {
  const node = state.doc.nodeAt(position)
  if (!node || !isVisibleRawBlock(node)) return null
  const boundary = direction === 'up' ? position : position + node.nodeSize
  const resolved = state.doc.resolve(boundary)
  const adjacent = direction === 'up' ? resolved.nodeBefore : resolved.nodeAfter
  if (!adjacent || !isVisibleRawBlock(adjacent)) return null
  return direction === 'up' ? boundary - adjacent.nodeSize : boundary
}

function keyboardRangeFromPositions(
  state: EditorState,
  positions: number[],
  anchor: RawBlockKeyboardAnchor,
  direction: RawBlockArrowDirection,
  headPosition: number
): RawBlockKeyboardRange | null {
  const ordered = [...new Set(positions)].sort((left, right) => left - right)
  const first = ordered[0]
  const last = ordered.at(-1)
  if (first == null || last == null) return null
  const lastNode = state.doc.nodeAt(last)
  if (
    !lastNode ||
    !ordered.every((position) => {
      const node = state.doc.nodeAt(position)
      return node ? isVisibleRawBlock(node) : false
    })
  ) {
    return null
  }
  return {
    anchor,
    direction,
    headPosition,
    positions: ordered,
    from: first,
    to: last + lastNode.nodeSize
  }
}

function dispatchKeyboardRange(view: EditorView, range: RawBlockKeyboardRange): void {
  const transaction = view.state.tr
    .setMeta(rawBlockKeyboardRangeKey, range)
    .setMeta(rawBlockBoundaryKey, null)
  if (range.anchor.kind === 'text') {
    transaction.setSelection(TextSelection.create(view.state.doc, range.anchor.position))
  } else {
    transaction.setSelection(NodeSelection.create(view.state.doc, range.anchor.position))
  }
  view.dispatch(transaction)
}

function restoreKeyboardRangeAnchor(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(rawBlockKeyboardRangeKey, null).setMeta(rawBlockBoundaryKey, null)
  )
}

function startKeyboardRange(view: EditorView, direction: RawBlockArrowDirection): boolean {
  const { selection } = view.state
  if (selection instanceof TextSelection) {
    const anchorPos = selection.anchor
    const probe = view.state.apply(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, anchorPos))
    )
    const position = adjacentRawBlockSelectionPosition(probe, direction)
    if (position == null) return false
    const range = keyboardRangeFromPositions(
      view.state,
      [position],
      { kind: 'text', position: anchorPos },
      direction,
      position
    )
    if (!range) return false
    dispatchKeyboardRange(view, range)
    return true
  }

  if (!(selection instanceof NodeSelection) || !isVisibleRawBlock(selection.node)) return false
  const adjacent = adjacentVisibleRawBlockPosition(view.state, selection.from, direction)
  if (adjacent == null) return false
  const range = keyboardRangeFromPositions(
    view.state,
    [selection.from, adjacent],
    { kind: 'node', position: selection.from },
    direction,
    adjacent
  )
  if (!range) return false
  dispatchKeyboardRange(view, range)
  return true
}

function extendKeyboardRange(view: EditorView, direction: RawBlockArrowDirection): boolean {
  const current = rawBlockKeyboardRangeKey.getState(view.state)
  if (!current) return startKeyboardRange(view, direction)

  if (direction === current.direction) {
    const adjacent = adjacentVisibleRawBlockPosition(view.state, current.headPosition, direction)
    if (adjacent == null) return true
    const range = keyboardRangeFromPositions(
      view.state,
      [...current.positions, adjacent],
      current.anchor,
      current.direction,
      adjacent
    )
    if (!range) return true
    dispatchKeyboardRange(view, range)
    return true
  }

  const remaining = current.positions.filter((position) => position !== current.headPosition)
  const collapsedToAnchor =
    (current.anchor.kind === 'text' && remaining.length === 0) ||
    (current.anchor.kind === 'node' &&
      remaining.length === 1 &&
      remaining[0] === current.anchor.position)
  if (collapsedToAnchor) {
    restoreKeyboardRangeAnchor(view)
    return true
  }

  const nextHead = current.direction === 'up' ? remaining[0] : remaining.at(-1)
  if (nextHead == null) {
    restoreKeyboardRangeAnchor(view)
    return true
  }
  const range = keyboardRangeFromPositions(
    view.state,
    remaining,
    current.anchor,
    current.direction,
    nextHead
  )
  if (range) dispatchKeyboardRange(view, range)
  return true
}

function isKeyboardRangeEvent(event: KeyboardEvent): boolean {
  const target = event.target as Element | null
  return (
    event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    !target?.closest('.cm-editor')
  )
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
      .setMeta(rawBlockKeyboardRangeKey, null)
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
  const transaction = view.state.tr
    .setMeta(rawBlockBoundaryKey, null)
    .setMeta(rawBlockKeyboardRangeKey, null)
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
      .setMeta(rawBlockKeyboardRangeKey, null)
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

function isBoundaryArrowEvent(event: KeyboardEvent): boolean {
  const target = event.target as Element | null
  return (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key) &&
    !target?.closest('.cm-editor')
  )
}

function handleRawBlockRangeDeletion(view: EditorView, event: KeyboardEvent): boolean {
  if (event.key !== 'Delete' && event.key !== 'Backspace') return false
  const range = rawBlockKeyboardRangeKey.getState(view.state)
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
      .setMeta(rawBlockKeyboardRangeKey, null)
      .setMeta(rawBlockBoundaryKey, null)
      .scrollIntoView()
  )
  return true
}

/** Keyboard and visual selection semantics for selectable raw block atoms. */
export function createRawBlockSelectionPlugin(): MilkdownPlugin[] {
  // Capture-phase and ProseMirror handleKeyDown can both see the same Shift+arrow
  // event. Claiming it once prevents 1→2 range jumps on the first keypress.
  let claimedKeyboardEvent: KeyboardEvent | null = null

  const claimKeyboardRange = (
    view: EditorView,
    event: KeyboardEvent,
    direction: RawBlockArrowDirection
  ): boolean => {
    if (claimedKeyboardEvent === event) return true
    if (!extendKeyboardRange(view, direction)) return false
    claimedKeyboardEvent = event
    return true
  }

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
              (handleRawBlockRangeDeletion(view, event) || handleActiveBoundary(view, event))
            ) {
              return true
            }

            if (isBoundaryArrowEvent(event)) {
              const down = event.key === 'ArrowDown' || event.key === 'ArrowRight'
              const position = adjacentRawBlockSelectionPosition(view.state, down ? 'down' : 'up')
              if (position != null) {
                return setRawBlockBoundary(view, position, down ? 'before' : 'after')
              }
            }

            if (!isKeyboardRangeEvent(event)) return false
            return claimKeyboardRange(view, event, event.key === 'ArrowDown' ? 'down' : 'up')
          }
        },
        view: (view) => {
          const keydown = (event: KeyboardEvent): void => {
            if (!view.editable) return
            const eventTarget = event.target
            if (
              !(eventTarget instanceof Node) ||
              (!view.dom.contains(eventTarget) && eventTarget !== view.dom)
            ) {
              return
            }
            if (!isKeyboardRangeEvent(event)) return
            if (!claimKeyboardRange(view, event, event.key === 'ArrowDown' ? 'down' : 'up')) {
              return
            }
            event.preventDefault()
            event.stopImmediatePropagation()
          }
          view.dom.ownerDocument.addEventListener('keydown', keydown, true)
          return {
            destroy: () => view.dom.ownerDocument.removeEventListener('keydown', keydown, true)
          }
        }
      })
  )

  const keyboardRangePlugin = $prose(
    () =>
      new Plugin<RawBlockKeyboardRange | null>({
        key: rawBlockKeyboardRangeKey,
        state: {
          init: () => null,
          apply: (transaction, value) => {
            const meta = transaction.getMeta(rawBlockKeyboardRangeKey) as
              RawBlockKeyboardRange | null | undefined
            if (meta !== undefined) return meta
            if (transaction.docChanged) return null
            if (!transaction.selectionSet) return value
            if (!value) return null
            const selection = transaction.selection
            if (
              value.anchor.kind === 'text' &&
              selection instanceof TextSelection &&
              selection.empty &&
              selection.head === value.anchor.position
            ) {
              return value
            }
            if (
              value.anchor.kind === 'node' &&
              selection instanceof NodeSelection &&
              selection.from === value.anchor.position
            ) {
              return value
            }
            return null
          }
        },
        appendTransaction: (_transactions, _oldState, newState) => {
          const range = rawBlockKeyboardRangeKey.getState(newState)
          if (!range) return null
          const { selection } = newState
          if (range.anchor.kind === 'text') {
            if (
              selection instanceof TextSelection &&
              selection.empty &&
              selection.head === range.anchor.position
            ) {
              return null
            }
            return newState.tr
              .setSelection(TextSelection.create(newState.doc, range.anchor.position))
              .setMeta(rawBlockKeyboardRangeKey, range)
          }
          if (selection instanceof NodeSelection && selection.from === range.anchor.position) {
            return null
          }
          return newState.tr
            .setSelection(NodeSelection.create(newState.doc, range.anchor.position))
            .setMeta(rawBlockKeyboardRangeKey, range)
        }
      })
  )

  return [selectionPlugin, keyboardRangePlugin]
}
