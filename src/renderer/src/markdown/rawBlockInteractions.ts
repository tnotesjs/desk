import type { MilkdownPlugin } from '@milkdown/kit/ctx'
import { GapCursor } from '@milkdown/kit/prose/gapcursor'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import type { EditorState } from '@milkdown/kit/prose/state'
import type { EditorView } from '@milkdown/kit/prose/view'
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view'
import { $prose } from '@milkdown/kit/utils'

export type RawBlockArrowDirection = 'up' | 'down'

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

/**
 * Whole-block selection for Crepe `code_block` (not NodeSelection).
 * Crepe's code nodeView.selectNode() focuses CodeMirror, so NodeSelection cannot
 * express "highlight whole fence without editing".
 */
const codeBlockWholeSelectKey = new PluginKey<number | null>('tnotes-code-block-whole-select')
const rawBlockKeyboardRangeKey = new PluginKey<RawBlockKeyboardRange | null>(
  'tnotes-raw-block-keyboard-range'
)

function isVisibleRawBlock(node: {
  type: { name: string }
  attrs: Record<string, unknown>
}): boolean {
  return node.type.name === 'deskRawBlock' && node.attrs.hidden !== true
}

function isCodeBlock(node: { type: { name: string } }): boolean {
  return node.type.name === 'code_block'
}

/** Whole-block NodeSelection targets: visible raw atoms and Crepe code blocks. */
export function isSelectableBlockNode(node: {
  type: { name: string }
  attrs?: Record<string, unknown>
}): boolean {
  if (isCodeBlock(node)) return true
  return isVisibleRawBlock({
    type: node.type,
    attrs: (node.attrs ?? {}) as Record<string, unknown>
  })
}

function needsRangeSelectionSurface(node: {
  type: { name: string }
  attrs: Record<string, unknown>
}): boolean {
  return isVisibleRawBlock(node)
}

/** Position of a decoration-backed whole-selected code_block, if any. */
export function codeBlockWholeSelectPosition(state: EditorState): number | null {
  return codeBlockWholeSelectKey.getState(state) ?? null
}

function textBetweenInParent(
  $head: EditorState['selection']['$head'],
  from: number,
  to: number
): string {
  return $head.parent.textBetween(from, to, '\n', '\n')
}

/** True when the caret is on the last visual line of its textblock (ArrowDown leaves the block). */
function isOnLastLineOfTextblock($head: EditorState['selection']['$head']): boolean {
  return !textBetweenInParent($head, $head.parentOffset, $head.parent.content.size).includes('\n')
}

/** True when the caret is on the first visual line of its textblock (ArrowUp leaves the block). */
function isOnFirstLineOfTextblock($head: EditorState['selection']['$head']): boolean {
  return !textBetweenInParent($head, 0, $head.parentOffset).includes('\n')
}

function neighborSelectableBlockPosition(
  state: EditorState,
  boundary: number,
  direction: RawBlockArrowDirection
): number | null {
  let pos = boundary
  // Skip empty paragraphs between fences so selected→Arrow chains to the next code.
  for (let guard = 0; guard < 32; guard += 1) {
    const resolved = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))
    const neighbor = direction === 'down' ? resolved.nodeAfter : resolved.nodeBefore
    if (!neighbor) return null
    if (isSelectableBlockNode(neighbor)) {
      return direction === 'down' ? pos : pos - neighbor.nodeSize
    }
    if (neighbor.isTextblock && neighbor.content.size === 0) {
      pos = direction === 'down' ? pos + neighbor.nodeSize : pos - neighbor.nodeSize
      continue
    }
    return null
  }
  return null
}

/**
 * Finds the position of a selectable block immediately above/below the caret's
 * top-level block. Nested list/table carets only match when the caret is already
 * at that top-level block's outer edge, so intra-list arrow movement stays with PM.
 *
 * ArrowDown/Up match the last/first visual line (not only absolute offset 0/end),
 * so a mid-line caret on a single-line paragraph still whole-selects the next code.
 */
export function adjacentRawBlockSelectionPosition(
  state: EditorState,
  direction: RawBlockArrowDirection
): number | null {
  const { selection } = state

  if (selection instanceof GapCursor) {
    const $pos = selection.$head
    if (direction === 'down') {
      const next = $pos.nodeAfter
      return next && isSelectableBlockNode(next) ? $pos.pos : null
    }
    const previous = $pos.nodeBefore
    return previous && isSelectableBlockNode(previous) ? $pos.pos - previous.nodeSize : null
  }

  if (!(selection instanceof TextSelection) || !selection.empty) return null
  const { $head } = selection
  if ($head.depth < 1 || !$head.parent.isTextblock) return null
  // Caret already inside a code fence: leaving is handled by Crepe CM / whole-select.
  if (isCodeBlock($head.parent)) return null

  if (direction === 'down') {
    if (!isOnLastLineOfTextblock($head)) return null
    for (let depth = $head.depth; depth > 1; depth -= 1) {
      if ($head.index(depth - 1) < $head.node(depth - 1).childCount - 1) return null
    }
    return neighborSelectableBlockPosition(state, $head.after(1), 'down')
  }

  if (!isOnFirstLineOfTextblock($head)) return null
  for (let depth = $head.depth; depth > 1; depth -= 1) {
    if ($head.index(depth - 1) > 0) return null
  }
  return neighborSelectableBlockPosition(state, $head.before(1), 'up')
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

  const codeWhole = codeBlockWholeSelectKey.getState(state)
  const codeNode = codeWhole != null ? state.doc.nodeAt(codeWhole) : null
  if (codeNode && isCodeBlock(codeNode)) {
    decorations.push(
      Decoration.node(codeWhole, codeWhole + codeNode.nodeSize, {
        class: 'desk-code-block--whole-selected'
      })
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
    .setMeta(codeBlockWholeSelectKey, null)
  if (range.anchor.kind === 'text') {
    transaction.setSelection(TextSelection.create(view.state.doc, range.anchor.position))
  } else {
    transaction.setSelection(NodeSelection.create(view.state.doc, range.anchor.position))
  }
  view.dispatch(transaction)
}

function restoreKeyboardRangeAnchor(view: EditorView): void {
  view.dispatch(
    view.state.tr.setMeta(rawBlockKeyboardRangeKey, null).setMeta(codeBlockWholeSelectKey, null)
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
    const node = view.state.doc.nodeAt(position)
    // Shift+range stays raw-atom only; code_block uses whole-node select instead.
    if (!node || !isVisibleRawBlock(node)) return false
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

function selectSelectableBlock(view: EditorView, position: number): boolean {
  const node = view.state.doc.nodeAt(position)
  if (!node || !isSelectableBlockNode(node)) return false
  // Crepe code_block NodeSelection focuses CodeMirror via selectNode(); use a
  // decoration-backed whole-select instead so Arrow/Del stay in ProseMirror.
  if (isCodeBlock(node)) {
    const transaction = view.state.tr
      .setMeta(codeBlockWholeSelectKey, position)
      .setMeta(rawBlockKeyboardRangeKey, null)
    const { selection } = view.state
    const parkedOutside =
      selection instanceof TextSelection &&
      selection.empty &&
      !isCodeBlock(selection.$head.parent)
    if (!parkedOutside) {
      // Drop NodeSelection / in-code caret so Crepe cannot focus CM; prefer a gap
      // before the fence when valid, else the nearest surrounding text.
      try {
        transaction.setSelection(new GapCursor(view.state.doc.resolve(position)))
      } catch {
        transaction.setSelection(
          TextSelection.near(view.state.doc.resolve(position), -1)
        )
      }
    }
    view.dispatch(transaction.scrollIntoView())
    view.focus()
    return true
  }
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .setMeta(codeBlockWholeSelectKey, null)
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

/** Adds slim mouse hit areas that select the whole atom (same as body click). */
export function attachRawBlockBoundaryControls(
  options: RawBlockBoundaryControlsOptions
): () => void {
  const controls = (['before', 'after'] as const).map((side) => {
    const control = document.createElement('span')
    control.className = 'desk-raw-block__boundary-hit'
    control.dataset.side = side
    control.contentEditable = 'false'
    control.setAttribute('aria-label', '选中块')
    const select = (event: PointerEvent): void => {
      if (!options.view.editable) return
      const position = options.getPos()
      if (position == null) return
      event.preventDefault()
      event.stopPropagation()
      selectSelectableBlock(options.view, position)
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

/** Clears block selection state when the editor crosses into readonly mode. */
export function clearRawBlockSelectionState(view: EditorView): void {
  const { selection } = view.state
  const transaction = view.state.tr
    .setMeta(codeBlockWholeSelectKey, null)
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

function exitSelectableBlock(view: EditorView, position: number, bias: number): void {
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.near(view.state.doc.resolve(position), bias))
      .setMeta(codeBlockWholeSelectKey, null)
      .setMeta(rawBlockKeyboardRangeKey, null)
      .scrollIntoView()
  )
}

/** Leave a selected block: chain into the next selectable neighbor, else park in text. */
function moveFromSelectableBlock(
  view: EditorView,
  position: number,
  nodeSize: number,
  direction: RawBlockArrowDirection
): boolean {
  const boundary = direction === 'down' ? position + nodeSize : position
  const neighborPos = neighborSelectableBlockPosition(view.state, boundary, direction)
  if (neighborPos != null) {
    return selectSelectableBlock(view, neighborPos)
  }
  exitSelectableBlock(view, boundary, direction === 'down' ? 1 : -1)
  return true
}

function handleCodeBlockWholeSelect(view: EditorView, event: KeyboardEvent): boolean {
  const position = codeBlockWholeSelectKey.getState(view.state)
  if (position == null) return false
  const node = view.state.doc.nodeAt(position)
  if (!node || !isCodeBlock(node)) return false
  const end = position + node.nodeSize

  if (event.key === 'Delete' || event.key === 'Backspace') {
    const tr = view.state.tr.delete(position, end)
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(position, tr.doc.content.size)),
        event.key === 'Backspace' ? -1 : 1
      )
    )
    view.dispatch(
      tr.setMeta(codeBlockWholeSelectKey, null).setMeta(rawBlockKeyboardRangeKey, null).scrollIntoView()
    )
    return true
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    return moveFromSelectableBlock(view, position, node.nodeSize, 'down')
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    return moveFromSelectableBlock(view, position, node.nodeSize, 'up')
  }
  return false
}

function handleSelectedSelectableBlock(view: EditorView, event: KeyboardEvent): boolean {
  const { selection } = view.state
  if (!(selection instanceof NodeSelection) || !isVisibleRawBlock(selection.node)) {
    return false
  }
  const position = selection.from
  const end = position + selection.node.nodeSize

  if (event.key === 'Delete' || event.key === 'Backspace') {
    const tr = view.state.tr.delete(position, end)
    tr.setSelection(
      TextSelection.near(
        tr.doc.resolve(Math.min(position, tr.doc.content.size)),
        event.key === 'Backspace' ? -1 : 1
      )
    )
    view.dispatch(
      tr.setMeta(codeBlockWholeSelectKey, null).setMeta(rawBlockKeyboardRangeKey, null).scrollIntoView()
    )
    return true
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    return moveFromSelectableBlock(view, position, selection.node.nodeSize, 'down')
  }
  if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    return moveFromSelectableBlock(view, position, selection.node.nodeSize, 'up')
  }
  return false
}

function isBlockArrowEvent(event: KeyboardEvent): boolean {
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
      .setMeta(codeBlockWholeSelectKey, null)
      .scrollIntoView()
  )
  return true
}

/** Keyboard and visual selection semantics for selectable block nodes. */
export function createRawBlockSelectionPlugin(): MilkdownPlugin[] {
  // Capture-phase and ProseMirror handleKeyDown can both see the same key
  // event. Claiming it once prevents double-steps (e.g. code1→code3).
  let claimedKeyboardEvent: KeyboardEvent | null = null

  const claimEvent = (event: KeyboardEvent): void => {
    claimedKeyboardEvent = event
  }

  const claimKeyboardRange = (
    view: EditorView,
    event: KeyboardEvent,
    direction: RawBlockArrowDirection
  ): boolean => {
    if (claimedKeyboardEvent === event) return true
    if (!extendKeyboardRange(view, direction)) return false
    claimEvent(event)
    return true
  }

  const selectionPlugin = $prose(
    () =>
      new Plugin<number | null>({
        key: codeBlockWholeSelectKey,
        state: {
          init: () => null,
          apply: (transaction, value) => {
            const meta = transaction.getMeta(codeBlockWholeSelectKey) as
              number | null | undefined
            if (meta !== undefined) return meta
            if (transaction.docChanged || transaction.selectionSet) return null
            return value
          }
        },
        props: {
          decorations: selectedRawBlockDecorations,
          handleKeyDown: (view, event) => {
            if (!view.editable) return false
            if (claimedKeyboardEvent === event) return true
            const target = event.target as Element | null
            if (target?.closest('.cm-editor')) return false
            if (
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.isComposing &&
              (handleRawBlockRangeDeletion(view, event) ||
                handleCodeBlockWholeSelect(view, event) ||
                handleSelectedSelectableBlock(view, event))
            ) {
              claimEvent(event)
              return true
            }

            if (isBlockArrowEvent(event)) {
              const down = event.key === 'ArrowDown' || event.key === 'ArrowRight'
              const position = adjacentRawBlockSelectionPosition(view.state, down ? 'down' : 'up')
              if (position != null && selectSelectableBlock(view, position)) {
                claimEvent(event)
                return true
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
            if ((eventTarget as Element).closest?.('.cm-editor')) return
            if (claimedKeyboardEvent === event) return

            if (
              !event.shiftKey &&
              !event.altKey &&
              !event.ctrlKey &&
              !event.metaKey &&
              !event.isComposing &&
              (event.key === 'Delete' || event.key === 'Backspace') &&
              (handleRawBlockRangeDeletion(view, event) ||
                handleCodeBlockWholeSelect(view, event) ||
                handleSelectedSelectableBlock(view, event))
            ) {
              claimEvent(event)
              event.preventDefault()
              event.stopImmediatePropagation()
              return
            }

            if (isBlockArrowEvent(event)) {
              if (
                handleCodeBlockWholeSelect(view, event) ||
                handleSelectedSelectableBlock(view, event)
              ) {
                claimEvent(event)
                event.preventDefault()
                event.stopImmediatePropagation()
                return
              }
              const down = event.key === 'ArrowDown' || event.key === 'ArrowRight'
              const position = adjacentRawBlockSelectionPosition(view.state, down ? 'down' : 'up')
              if (position != null && selectSelectableBlock(view, position)) {
                claimEvent(event)
                event.preventDefault()
                event.stopImmediatePropagation()
                return
              }
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
