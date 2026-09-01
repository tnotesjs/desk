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

let decorationCache: {
  key: string
  doc: EditorState['doc'] | null
  set: DecorationSet | null | undefined
} = { key: '', doc: null, set: undefined }

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
  direction: RawBlockArrowDirection,
  options: { skipEmptyTextblocks?: boolean } = {}
): number | null {
  const skipEmpty = options.skipEmptyTextblocks === true
  let pos = boundary
  for (let guard = 0; guard < 32; guard += 1) {
    const resolved = state.doc.resolve(Math.max(0, Math.min(pos, state.doc.content.size)))
    const neighbor = direction === 'down' ? resolved.nodeAfter : resolved.nodeBefore
    if (!neighbor) return null
    if (isSelectableBlockNode(neighbor)) {
      return direction === 'down' ? pos : pos - neighbor.nodeSize
    }
    // Only skip empty paragraphs when chaining from an already-selected block
    // (code→code). From a normal caret, an empty line must receive the arrow
    // first — otherwise "哈哈哈"↓ jumps over the blank into the fence below.
    if (skipEmpty && neighbor.isTextblock && neighbor.content.size === 0) {
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
 *
 * Empty paragraphs between the caret and a block are NOT skipped — ProseMirror
 * should move into the blank line first.
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
  const codeWhole = codeBlockWholeSelectKey.getState(state)
  const cacheKey = [
    selection.from,
    selection.to,
    selection.empty ? 1 : 0,
    selection instanceof NodeSelection ? 1 : 0,
    keyboardRange ? `${keyboardRange.from}:${keyboardRange.to}` : '',
    codeWhole ?? ''
  ].join('|')
  if (
    cacheKey === decorationCache.key &&
    decorationCache.doc === state.doc &&
    decorationCache.set !== undefined
  ) {
    return decorationCache.set
  }
  if (range) {
    state.doc.nodesBetween(range.from, range.to, (node, position) => {
      if (range.from >= position + node.nodeSize || range.to <= position) return
      if (needsRangeSelectionSurface(node)) {
        decorations.push(
          Decoration.node(position, position + node.nodeSize, {
            class: 'desk-raw-block--range-selected'
          })
        )
      }
      if (isCodeBlock(node)) {
        decorations.push(
          Decoration.node(position, position + node.nodeSize, {
            class: 'desk-code-block--whole-selected'
          })
        )
      }
    })
  }

  const codeNode = codeWhole != null ? state.doc.nodeAt(codeWhole) : null
  if (codeWhole != null && codeNode && isCodeBlock(codeNode)) {
    decorations.push(
      Decoration.node(codeWhole, codeWhole + codeNode.nodeSize, {
        class: 'desk-code-block--whole-selected'
      })
    )
  }

  const next = decorations.length ? DecorationSet.create(state.doc, decorations) : null
  decorationCache = { key: cacheKey, doc: state.doc, set: next }
  return next
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

/**
 * Turn a keyboard-range meta selection into a real TextSelection covering the
 * text anchor through the included raw atoms, then clear the meta so later
 * Shift+arrows use native ProseMirror expansion (mouse-drag parity).
 */
function materializeKeyboardRangeAsTextSelection(
  view: EditorView,
  range: RawBlockKeyboardRange
): void {
  const lastPos = range.positions.at(-1) ?? range.headPosition
  const lastNode = view.state.doc.nodeAt(lastPos)
  if (!lastNode) {
    restoreKeyboardRangeAnchor(view)
    return
  }
  const blockFrom = Math.min(...range.positions)
  const blockTo = lastPos + lastNode.nodeSize
  let from = blockFrom
  let to = blockTo
  if (range.anchor.kind === 'text') {
    from = Math.min(range.anchor.position, blockFrom)
    to = Math.max(range.anchor.position, blockTo)
  }
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, from, to))
      .setMeta(rawBlockKeyboardRangeKey, null)
      .setMeta(codeBlockWholeSelectKey, null)
      .scrollIntoView()
  )
}

/**
 * Expand a text caret/range through an adjacent Crepe `code_block`.
 * Endpoints stay in neighboring textblocks (never inside the fence) so
 * CodeMirror cannot steal the DOM selection and drop the original range.
 */
function extendSelectionThroughAdjacentCode(
  view: EditorView,
  direction: RawBlockArrowDirection
): boolean {
  const { selection } = view.state
  if (!(selection instanceof TextSelection)) return false

  const anchor = selection.anchor
  const head = selection.head
  const edge = selection.empty
    ? head
    : direction === 'down'
      ? Math.max(anchor, head)
      : Math.min(anchor, head)
  const $edge = view.state.doc.resolve(edge)
  if ($edge.depth < 1 || !$edge.parent.isTextblock) return false
  if (isCodeBlock($edge.parent)) return false

  if (direction === 'down') {
    if (!isOnLastLineOfTextblock($edge)) return false
    for (let depth = $edge.depth; depth > 1; depth -= 1) {
      if ($edge.index(depth - 1) < $edge.node(depth - 1).childCount - 1) return false
    }
  } else {
    if (!isOnFirstLineOfTextblock($edge)) return false
    for (let depth = $edge.depth; depth > 1; depth -= 1) {
      if ($edge.index(depth - 1) > 0) return false
    }
  }

  const boundary = direction === 'down' ? $edge.after(1) : $edge.before(1)
  const codePos = neighborSelectableBlockPosition(view.state, boundary, direction)
  if (codePos == null) return false
  const codeNode = view.state.doc.nodeAt(codePos)
  if (!codeNode || !isCodeBlock(codeNode)) return false

  // Park the moving head in the textblock on the far side of the fence.
  // If there is no far textblock, park on the doc position just outside the fence
  // (still not inside code_block content) so CodeMirror cannot take the selection.
  let headOutside: number
  if (direction === 'down') {
    const after = codePos + codeNode.nodeSize
    const next = view.state.doc.resolve(Math.min(after, view.state.doc.content.size)).nodeAfter
    headOutside = next?.isTextblock ? after + 1 : after
  } else {
    const prev = view.state.doc.resolve(codePos).nodeBefore
    headOutside = prev?.isTextblock
      ? codePos - prev.nodeSize + 1 + prev.content.size
      : codePos
  }
  const newAnchor = selection.empty ? head : anchor
  const newHead = headOutside
  view.dispatch(
    view.state.tr
      .setSelection(TextSelection.create(view.state.doc, newAnchor, newHead))
      .setMeta(rawBlockKeyboardRangeKey, null)
      .setMeta(codeBlockWholeSelectKey, null)
      .scrollIntoView()
  )
  return true
}

function startKeyboardRange(view: EditorView, direction: RawBlockArrowDirection): boolean {
  const { selection } = view.state
  if (selection instanceof TextSelection) {
    // Non-empty ranges: try code-block bridge first, else native Shift+arrow.
    if (!selection.empty) {
      return extendSelectionThroughAdjacentCode(view, direction)
    }
    const anchorPos = selection.anchor
    const probe = view.state.apply(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, anchorPos))
    )
    const position = adjacentRawBlockSelectionPosition(probe, direction)
    if (position == null) return false
    const node = view.state.doc.nodeAt(position)
    if (!node) return false
    // Code fences: expand a real TextSelection through the block (Crepe CM
    // prevents reliable native Shift+arrow across the nodeView).
    if (isCodeBlock(node)) {
      return extendSelectionThroughAdjacentCode(view, direction)
    }
    if (!isVisibleRawBlock(node)) return false
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
    if (adjacent == null) {
      // Hand off to a real TextSelection through the included atoms. Returning
      // true consumes this Shift+arrow; the next one sees a non-empty selection
      // and falls through to native ProseMirror expansion.
      materializeKeyboardRangeAsTextSelection(view, current)
      return true
    }
    const range = keyboardRangeFromPositions(
      view.state,
      [...current.positions, adjacent],
      current.anchor,
      current.direction,
      adjacent
    )
    if (!range) {
      materializeKeyboardRangeAsTextSelection(view, current)
      return true
    }
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

/** Keep ProseMirror focused after Crepe's code nodeView.selectNode() focuses CM. */
function reclaimFocusFromCodeMirror(view: EditorView, position: number): void {
  view.focus()
  queueMicrotask(() => {
    if (codeBlockWholeSelectKey.getState(view.state) !== position) return
    if (!(view.state.selection instanceof NodeSelection)) return
    view.focus()
  })
}

function selectSelectableBlock(view: EditorView, position: number): boolean {
  const node = view.state.doc.nodeAt(position)
  if (!node || !isSelectableBlockNode(node)) return false
  // Use NodeSelection for both raw atoms and code fences so the caret leaves the
  // previous line (same UX as deskRawBlock). Crepe's selectNode() will focus CM —
  // reclaim PM focus and keep a decoration marker for styling / key routing.
  const isCode = isCodeBlock(node)
  view.dispatch(
    view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, position))
      .setMeta(codeBlockWholeSelectKey, isCode ? position : null)
      .setMeta(rawBlockKeyboardRangeKey, null)
      .scrollIntoView()
  )
  if (isCode) reclaimFocusFromCodeMirror(view, position)
  else view.focus()
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
  if (selection instanceof NodeSelection && isSelectableBlockNode(selection.node)) {
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
  // Crepe's block handle lives outside view.dom; reclaim focus so the next
  // ArrowDown is not dropped by the capture-listener's contains() check.
  view.focus()
}

/**
 * True when every sibling between `boundary` and the next selectable block is an
 * empty textblock (so code→code chaining across blanks is safe).
 */
function onlyEmptyTextblocksUntilSelectable(
  state: EditorState,
  boundary: number,
  direction: RawBlockArrowDirection
): boolean {
  let probe = boundary
  for (let guard = 0; guard < 32; guard += 1) {
    const $pos = state.doc.resolve(Math.max(0, Math.min(probe, state.doc.content.size)))
    const node = direction === 'down' ? $pos.nodeAfter : $pos.nodeBefore
    if (!node) return false
    if (isSelectableBlockNode(node)) return true
    if (!(node.isTextblock && node.content.size === 0)) return false
    probe = direction === 'down' ? probe + node.nodeSize : probe - node.nodeSize
  }
  return false
}

/** Leave a selected block: chain into the next selectable neighbor, else park in text. */
function moveFromSelectableBlock(
  view: EditorView,
  position: number,
  nodeSize: number,
  direction: RawBlockArrowDirection
): boolean {
  const boundary = direction === 'down' ? position + nodeSize : position
  const immediatePos = neighborSelectableBlockPosition(view.state, boundary, direction)
  if (immediatePos != null) {
    return selectSelectableBlock(view, immediatePos)
  }
  // Chain across empty paragraphs only when nothing but blanks separate two
  // selectable blocks (code→code). If real text follows a blank after an info
  // atom, land on the blank instead of jumping the caret over it.
  const chainedPos = neighborSelectableBlockPosition(view.state, boundary, direction, {
    skipEmptyTextblocks: true
  })
  if (
    chainedPos != null &&
    onlyEmptyTextblocksUntilSelectable(view.state, boundary, direction)
  ) {
    return selectSelectableBlock(view, chainedPos)
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
  if (!(selection instanceof NodeSelection) || !isSelectableBlockNode(selection.node)) {
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

/** True when arrow/delete should stay on the whole-select path even if CM has focus. */
function isWholeSelectKeyEvent(event: KeyboardEvent): boolean {
  return (
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.isComposing &&
    ['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft', 'Delete', 'Backspace'].includes(
      event.key
    )
  )
}

/**
 * Editable mindmap islands nest under ProseMirror and briefly take NodeSelection
 * so the body caret disappears. Arrow/Delete must stay on the canvas (node focus
 * navigation), not exit/delete the whole fence — same idea as leaving CM alone.
 */
function isMindmapIslandKeyboardOwner(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const block = target.closest('.desk-raw-block--mindmap')
  if (!block) return false
  if (block.classList.contains('is-mindmap-island-active')) return true
  return Boolean(
    target.closest(
      [
        '.mm-editor',
        '.mindmap-preview',
        '.outline-view',
        '.markdown-view',
        '.mm-edit-input',
        '.rich-inline-editor',
        '.md-textarea',
        '[contenteditable="true"]'
      ].join(', ')
    )
  )
}

/** True when PM NodeSelection is on a mindmap fence whose interaction island is live. */
function isActiveMindmapIslandSelection(view: EditorView): boolean {
  const { selection } = view.state
  if (!(selection instanceof NodeSelection) || !isSelectableBlockNode(selection.node)) {
    return false
  }
  const nodeDom = view.nodeDOM(selection.from)
  if (!(nodeDom instanceof Element)) return false
  const block =
    nodeDom.closest('.desk-raw-block--mindmap') ??
    (nodeDom.classList.contains('desk-raw-block--mindmap') ? nodeDom : null)
  return Boolean(block?.classList.contains('is-mindmap-island-active'))
}

function handleWholeSelectKeys(view: EditorView, event: KeyboardEvent): boolean {
  if (!isWholeSelectKeyEvent(event)) return false
  if (isMindmapIslandKeyboardOwner(event.target) || isActiveMindmapIslandSelection(view)) {
    return false
  }
  return (
    handleRawBlockRangeDeletion(view, event) ||
    handleCodeBlockWholeSelect(view, event) ||
    handleSelectedSelectableBlock(view, event)
  )
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
  const evaluatedKeydowns = new WeakSet<KeyboardEvent>()

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
            // Document capture already evaluated this event; only honor claims.
            if (evaluatedKeydowns.has(event)) return claimedKeyboardEvent === event
            if (claimedKeyboardEvent === event) return true
            const target = event.target as Element | null
            // Nested mindmap canvas / outline owns arrows while the island is active.
            if (isMindmapIslandKeyboardOwner(target) || isActiveMindmapIslandSelection(view)) {
              return false
            }
            // Whole-select must win even when Crepe's selectNode() left focus in CM.
            if (handleWholeSelectKeys(view, event)) {
              claimEvent(event)
              return true
            }
            if (target?.closest('.cm-editor')) return false

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
          let wasWholeSelect = false
          const hasWholeSelectSelection = (): boolean => {
            if (codeBlockWholeSelectKey.getState(view.state) != null) return true
            const { selection } = view.state
            return (
              selection instanceof NodeSelection && isSelectableBlockNode(selection.node)
            )
          }

          /** True when the event target is an outside field we must not hijack. */
          const isForeignTextField = (eventTarget: EventTarget | null): boolean => {
            if (!(eventTarget instanceof HTMLElement)) return false
            if (view.dom.contains(eventTarget)) return false
            const milkdownRoot = view.dom.parentElement
            if (milkdownRoot?.contains(eventTarget)) return false
            if (eventTarget.isContentEditable) return true
            const tag = eventTarget.tagName
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
          }

          const keydown = (event: KeyboardEvent): void => {
            evaluatedKeydowns.add(event)
            if (!view.editable) return
            if (claimedKeyboardEvent === event) return

            const eventTarget = event.target
            // Mindmap island: do not steal Arrow/Delete from .mm-editor (capture runs first).
            if (
              isMindmapIslandKeyboardOwner(eventTarget) ||
              (isActiveMindmapIslandSelection(view) && isWholeSelectKeyEvent(event))
            ) {
              return
            }

            const inProseMirror =
              eventTarget instanceof Node &&
              (eventTarget === view.dom || view.dom.contains(eventTarget))

            // Whole-select must win even when focus left .ProseMirror (Crepe block
            // handle, body after atom NodeSelection, etc.). Gating on
            // contains(target) made ↓ appear stuck on the first INFO atom.
            if (hasWholeSelectSelection() && !isForeignTextField(eventTarget)) {
              if (handleWholeSelectKeys(view, event)) {
                claimEvent(event)
                event.preventDefault()
                event.stopImmediatePropagation()
                view.focus()
                return
              }
            }

            if (!inProseMirror) return
            const inCodeMirror = Boolean((eventTarget as Element).closest?.('.cm-editor'))
            if (handleWholeSelectKeys(view, event)) {
              claimEvent(event)
              event.preventDefault()
              event.stopImmediatePropagation()
              return
            }
            if (inCodeMirror) return

            if (isBlockArrowEvent(event)) {
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
            update: () => {
              const whole = hasWholeSelectSelection()
              const entering = whole && !wasWholeSelect
              wasWholeSelect = whole
              if (!whole) return
              if (view.hasFocus()) return
              const active = view.dom.ownerDocument.activeElement
              // Inline raw-source CM and other real fields keep focus.
              if (active instanceof Element && active.closest('.desk-raw-block__editor-cm')) {
                return
              }
              // Mindmap canvas / outline keep focus while the interaction island is live.
              if (isMindmapIslandKeyboardOwner(active)) return
              if (isForeignTextField(active)) return
              // Reclaim when entering whole-select, or when focus left PM while still whole-selected.
              const focusOutsidePm =
                !(active instanceof Node) ||
                (active !== view.dom && !view.dom.contains(active))
              if (!entering && !focusOutsidePm) return
              view.focus()
            },
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
