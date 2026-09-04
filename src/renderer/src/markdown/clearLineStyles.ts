import { keymap } from '@milkdown/kit/prose/keymap'
import { TextSelection, type Command } from '@milkdown/kit/prose/state'
import { $prose } from '@milkdown/kit/utils'

/** Clear only inline styles on the logical lines touched by the selection. */
export const clearLineStyles: Command = (state, dispatch, view) => {
  if (view && !view.editable) return false
  const { selection } = state
  if (selection.empty && !(selection instanceof TextSelection)) return false
  const marks = ['strong', 'emphasis', 'strike_through']
    .map((name) => state.schema.marks[name])
    .filter(Boolean)
  const tr = state.tr
  let handled = false
  state.doc.descendants((node, pos) => {
    if (!node.isTextblock || node.type.spec.code) return
    const start = pos + 1
    const end = start + node.content.size
    if (selection.empty) {
      if (selection.from < start || selection.from > end) return false
    } else if (selection.to <= start || selection.from > end) return false

    const lines: { from: number; to: number }[] = []
    let lineStart = start
    node.forEach((child, offset) => {
      if (child.type.name === 'hardbreak' || child.type.name === 'hard_break') {
        lines.push({ from: lineStart, to: start + offset })
        lineStart = start + offset + child.nodeSize
      } else if (child.isText) {
        for (let i = 0; i < child.text!.length; i += 1) {
          if (child.text![i] !== '\n') continue
          lines.push({ from: lineStart, to: start + offset + i })
          lineStart = start + offset + i + 1
        }
      }
    })
    lines.push({ from: lineStart, to: end })
    for (const line of lines) {
      const touches = selection.empty
        ? selection.from >= line.from && selection.from <= line.to
        : selection.from <= line.to && selection.to > line.from
      if (!touches) continue
      handled = true
      for (const mark of marks) tr.removeMark(line.from, line.to, mark)
    }
    return false
  })
  if (!handled) return false
  // Do not reapply the cleared style to the next character typed at the caret.
  for (const mark of marks) tr.removeStoredMark(mark)
  dispatch?.(tr.scrollIntoView())
  return true
}

// Installed only by the note README visual editor, never by file/code editors.
export const clearLineStylesPlugin = $prose(() => keymap({ 'Mod-\\': clearLineStyles }))
