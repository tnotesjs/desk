import { wrapInList } from '@milkdown/kit/prose/schema-list'
import { TextSelection, type Command } from '@milkdown/kit/prose/state'

/** Apply native GFM checkboxes without replacing the selected text or adding nested lists. */
export const wrapInTaskList: Command = (state, dispatch, view) => {
  if ((view && !view.editable) || !(state.selection instanceof TextSelection)) return false
  const { bullet_list: bulletList, list_item: listItem } = state.schema.nodes
  if (!bulletList || !listItem) return false
  let tr = state.tr
  // Wrapping plain paragraphs creates one list item per paragraph and retains the selection.
  // Within an existing list, only the checked attribute needs to change.
  const { $from } = state.selection
  const inList = Array.from({ length: $from.depth }, (_, index) => $from.node(index + 1)).some(
    (node) => node.type === listItem
  )
  if (
    !inList &&
    !wrapInList(bulletList)(state, (transaction) => {
      tr = transaction
    })
  )
    return false
  const { from, to } = tr.selection
  const items = new Set<number>()
  tr.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isTextblock) return
    const $position = tr.doc.resolve(position + 1)
    for (let depth = $position.depth - 1; depth > 0; depth -= 1) {
      if ($position.node(depth).type !== listItem) continue
      items.add($position.before(depth))
      break
    }
  })
  if (!items.size) return false
  for (const position of items) {
    const node = tr.doc.nodeAt(position)!
    if (node.attrs.checked == null) {
      tr.setNodeMarkup(position, undefined, { ...node.attrs, checked: false })
    }
  }
  dispatch?.(tr.scrollIntoView())
  return true
}
